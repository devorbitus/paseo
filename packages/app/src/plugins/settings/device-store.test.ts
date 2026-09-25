import { describe, expect, test } from "vitest";
import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { createInMemoryKeyValueStorage } from "@/hooks/use-settings/fakes";
import { DeviceSettingsStore, deviceSettingsStorageKey } from "./device-store";

const definition = defineSettings({
  id: "playback",
  scope: "device",
  version: 1,
  schema: z.object({
    rate: z.number().min(0.5).max(2).default(1),
    voice: z.string().nullable().default(null),
  }),
});
const key = deviceSettingsStorageKey("read-aloud", "playback");

function setup(initial: Record<string, string> = {}) {
  const storage = createInMemoryKeyValueStorage(initial);
  return { storage, store: new DeviceSettingsStore(storage) };
}

describe("DeviceSettingsStore", () => {
  test("reads schema defaults when nothing is stored", async () => {
    const { store } = setup();
    expect(store.getSnapshot(key)).toEqual({ status: "loading" });
    await store.load(key, definition);
    expect(store.getSnapshot(key)).toEqual({
      status: "ready",
      revision: "missing",
      values: { rate: 1, voice: null },
    });
  });

  test("saves against the current revision and rejects a stale one", async () => {
    const { storage, store } = setup();
    await store.load(key, definition);
    const saved = await store.save(key, definition, { rate: 1.5, voice: "Samantha" }, "missing");
    expect(saved).toMatchObject({ status: "saved", values: { rate: 1.5, voice: "Samantha" } });
    expect(JSON.parse(storage.entries.get(key) ?? "")).toEqual({
      version: 1,
      values: { rate: 1.5, voice: "Samantha" },
    });
    expect(store.getSnapshot(key)).toMatchObject({ status: "ready", values: { rate: 1.5 } });

    const stale = await store.save(key, definition, { rate: 2, voice: null }, "missing");
    expect(stale.status).toBe("conflict");
    expect(store.getSnapshot(key)).toMatchObject({ values: { rate: 1.5 } });
  });

  test("rejects values that fail the schema without writing", async () => {
    const { storage, store } = setup();
    await store.load(key, definition);
    const result = await store.save(key, definition, { rate: 9, voice: null }, "missing");
    expect(result.status).toBe("invalid");
    expect(storage.entries.has(key)).toBe(false);
  });

  test("notifies subscribers of the key that changed", async () => {
    const { store } = setup();
    const other = deviceSettingsStorageKey("read-aloud", "other");
    let playbackChanges = 0;
    let otherChanges = 0;
    store.subscribe(key, () => (playbackChanges += 1));
    store.subscribe(other, () => (otherChanges += 1));
    await store.load(key, definition);
    await store.save(key, definition, { rate: 0.75, voice: null }, "missing");
    expect(playbackChanges).toBe(2);
    expect(otherChanges).toBe(0);
  });

  test("keeps invalid stored data until an explicit reset", async () => {
    const raw = JSON.stringify({ version: 1, values: { rate: 50 } });
    const { storage, store } = setup({ [key]: raw });
    await store.load(key, definition);
    const snapshot = store.getSnapshot(key);
    expect(snapshot.status).toBe("invalid");
    expect(storage.entries.get(key)).toBe(raw);
    if (snapshot.status !== "invalid") throw new Error("expected invalid");

    const reset = await store.reset(key, definition, snapshot.revision);
    expect(reset).toMatchObject({ status: "saved", values: { rate: 1, voice: null } });
  });

  test("migrates an older version once and refuses a newer one", async () => {
    const v2 = defineSettings({
      ...definition,
      version: 2,
      migrate: (values) => ({ rate: (values as { speed: number }).speed, voice: null }),
    });
    const { storage, store } = setup({
      [key]: JSON.stringify({ version: 1, values: { speed: 1.25 } }),
    });
    await store.load(key, v2);
    expect(store.getSnapshot(key)).toMatchObject({ status: "ready", values: { rate: 1.25 } });
    expect(JSON.parse(storage.entries.get(key) ?? "").version).toBe(2);

    const older = setup({ [key]: storage.entries.get(key) ?? "" });
    await older.store.load(key, definition);
    expect(older.store.getSnapshot(key)).toMatchObject({
      status: "invalid",
      error: "Settings were saved by a newer plugin version",
    });
  });

  test("scopes documents by installation", () => {
    expect(deviceSettingsStorageKey("a", "playback")).not.toBe(
      deviceSettingsStorageKey("b", "playback"),
    );
  });
});
