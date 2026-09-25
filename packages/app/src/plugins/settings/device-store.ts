import type { SettingsDefinition } from "@getpaseo/plugin";
import { z, type ZodType } from "zod";
import type { KeyValueStorage } from "@/hooks/use-settings/storage";

/**
 * Device-scoped plugin settings, kept in this device's key-value storage. Mirrors the host
 * store in `packages/server/src/server/plugins/settings/index.ts`: same envelope, same
 * migration and conflict rules, so a plugin can move a document between scopes without
 * changing how it reads or saves it.
 */

export type DeviceSettingsSnapshot =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "invalid"; error: string; revision: string }
  | { status: "ready"; values: unknown; revision: string };

export type DeviceSettingsWriteResult =
  | { status: "saved"; values: unknown; revision: string }
  | { status: "conflict"; error: string }
  | { status: "invalid"; error: string };

const envelopeSchema = z.object({ version: z.number().int().positive(), values: z.json() });
const LOADING: DeviceSettingsSnapshot = { status: "loading" };
const MISSING_REVISION = "missing";

export function deviceSettingsStorageKey(installationId: string, settingsId: string): string {
  return `@paseo:plugin-device-settings:${installationId}:${settingsId}`;
}

function message(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.map((issue) => issue.message).join("\n");
  return error instanceof Error ? error.message : String(error);
}

// FNV-1a keeps revisions short and opaque; collisions only cost a spurious conflict.
function revisionOf(raw: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${raw.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

export class DeviceSettingsStore {
  private readonly snapshots = new Map<string, DeviceSettingsSnapshot>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly loads = new Map<string, Promise<void>>();

  constructor(private readonly storage: KeyValueStorage) {}

  subscribe(key: string, listener: () => void): () => void {
    let keyListeners = this.listeners.get(key);
    if (!keyListeners) {
      keyListeners = new Set();
      this.listeners.set(key, keyListeners);
    }
    keyListeners.add(listener);
    return () => {
      keyListeners.delete(listener);
    };
  }

  getSnapshot(key: string): DeviceSettingsSnapshot {
    return this.snapshots.get(key) ?? LOADING;
  }

  /** Reads the document once per key; later calls reuse the cached snapshot. */
  load(key: string, definition: SettingsDefinition<ZodType>): Promise<void> {
    const existing = this.loads.get(key);
    if (existing) return existing;
    const loading = this.serial(key, () => this.read(key, definition));
    this.loads.set(key, loading);
    return loading;
  }

  async reload(key: string, definition: SettingsDefinition<ZodType>): Promise<void> {
    this.loads.delete(key);
    await this.load(key, definition);
  }

  save(
    key: string,
    definition: SettingsDefinition<ZodType>,
    values: unknown,
    revision: string,
  ): Promise<DeviceSettingsWriteResult> {
    return this.serial(key, () => this.write(key, definition, revision, values, "save"));
  }

  reset(
    key: string,
    definition: SettingsDefinition<ZodType>,
    revision: string,
  ): Promise<DeviceSettingsWriteResult> {
    return this.serial(key, () => this.write(key, definition, revision, {}, "reset"));
  }

  private serial<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.queues.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  private publish(key: string, snapshot: DeviceSettingsSnapshot): void {
    this.snapshots.set(key, snapshot);
    for (const listener of this.listeners.get(key) ?? []) listener();
  }

  private async stored(key: string): Promise<{ raw: string | null; revision: string }> {
    const raw = await this.storage.getItem(key);
    return { raw, revision: raw === null ? MISSING_REVISION : revisionOf(raw) };
  }

  private async read(key: string, definition: SettingsDefinition<ZodType>): Promise<void> {
    let stored: { raw: string | null; revision: string };
    try {
      stored = await this.stored(key);
    } catch (error) {
      this.loads.delete(key);
      this.publish(key, { status: "error", error: message(error) });
      return;
    }
    try {
      const envelope = stored.raw === null ? null : envelopeSchema.parse(JSON.parse(stored.raw));
      let values: unknown = envelope?.values ?? {};
      if (envelope && envelope.version !== definition.version) {
        if (envelope.version > definition.version)
          throw new Error("Settings were saved by a newer plugin version");
        if (!definition.migrate)
          throw new Error(`Settings version ${envelope.version} requires a migration`);
        values = await definition.migrate(values, envelope.version);
      }
      const parsed: unknown = await definition.schema.parseAsync(values);
      z.json().parse(parsed);
      const migrated = envelope !== null && envelope.version !== definition.version;
      const revision = migrated ? await this.persist(key, definition, parsed) : stored.revision;
      this.publish(key, { status: "ready", values: parsed, revision });
    } catch (error) {
      this.publish(key, { status: "invalid", revision: stored.revision, error: message(error) });
    }
  }

  private async write(
    key: string,
    definition: SettingsDefinition<ZodType>,
    revision: string,
    values: unknown,
    intent: "save" | "reset",
  ): Promise<DeviceSettingsWriteResult> {
    const stored = await this.stored(key);
    if (stored.revision !== revision)
      return {
        status: "conflict",
        error: "Settings changed elsewhere on this device. Reload before saving again.",
      };
    let parsed: unknown;
    try {
      if (intent === "save" && stored.raw !== null) {
        const envelope = envelopeSchema.parse(JSON.parse(stored.raw));
        if (envelope.version !== definition.version)
          throw new Error("Reload or reset settings before saving a different schema version");
      }
      parsed = await definition.schema.parseAsync(values);
      z.json().parse(parsed);
    } catch (error) {
      return { status: "invalid", error: message(error) };
    }
    const nextRevision = await this.persist(key, definition, parsed);
    this.publish(key, { status: "ready", values: parsed, revision: nextRevision });
    return { status: "saved", values: parsed, revision: nextRevision };
  }

  private async persist(
    key: string,
    definition: SettingsDefinition<ZodType>,
    values: unknown,
  ): Promise<string> {
    const raw = JSON.stringify({ version: definition.version, values: z.json().parse(values) });
    await this.storage.setItem(key, raw);
    return revisionOf(raw);
  }
}
