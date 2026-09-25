import type { SettingsState } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import { type SettingsDefinition } from "@getpaseo/plugin";
import { settingsRpc } from "@getpaseo/plugin";
import { useReplicaQuery } from "@/data/query";
import { z, type ZodType } from "zod";
import { DeviceSettingsStore, deviceSettingsStorageKey } from "./device-store";

const deviceSettingsStore = new DeviceSettingsStore(AsyncStorage);

export const pluginSettingsKey = (id: string) => ["plugin-settings", id] as const;
function message(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.map((issue) => issue.message).join("\n");
  return error instanceof Error ? error.message : String(error);
}

/**
 * The `useSettings` a plugin bundle receives. A definition's scope is fixed, so each call site
 * always takes the same branch and the hook order stays stable across renders.
 */
export function createPluginUseSettings(installationId: string) {
  return function useSettings<Schema extends ZodType>(
    definition: SettingsDefinition<Schema>,
  ): SettingsState<Schema> {
    if (definition.scope === "device") {
      // eslint-disable-next-line react-hooks/rules-of-hooks -- scope is fixed per definition.
      return useDeviceSettings(installationId, definition);
    }
    // eslint-disable-next-line react-hooks/rules-of-hooks -- scope is fixed per definition.
    return useHostSettings(definition);
  };
}

function useDeviceSettings<Schema extends ZodType>(
  installationId: string,
  definition: SettingsDefinition<Schema>,
): SettingsState<Schema> {
  const key = deviceSettingsStorageKey(installationId, definition.id);
  const subscribe = useCallback(
    (listener: () => void) => deviceSettingsStore.subscribe(key, listener),
    [key],
  );
  const getSnapshot = useCallback(() => deviceSettingsStore.getSnapshot(key), [key]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    void deviceSettingsStore.load(key, definition);
  }, [key, definition]);

  async function commit(write: () => ReturnType<DeviceSettingsStore["save"]>) {
    setSaving(true);
    try {
      const result = await write();
      if (result.status !== "saved") {
        setSaveError(result.error);
        return false;
      }
      setSaveError(null);
      return true;
    } catch (error) {
      setSaveError(message(error));
      return false;
    } finally {
      setSaving(false);
    }
  }

  const actions = {
    saving,
    saveError,
    save: (values: z.output<Schema>, revision: string) =>
      commit(() => deviceSettingsStore.save(key, definition, values, revision)),
    reset: async () => {
      if (snapshot.status !== "ready" && snapshot.status !== "invalid") return false;
      const { revision } = snapshot;
      return commit(() => deviceSettingsStore.reset(key, definition, revision));
    },
    reload: async () => {
      setSaveError(null);
      await deviceSettingsStore.reload(key, definition);
    },
  };
  if (snapshot.status !== "ready") return { ...actions, ...snapshot };
  const parsed = definition.schema.safeParse(snapshot.values);
  if (!parsed.success)
    return {
      ...actions,
      status: "invalid",
      revision: snapshot.revision,
      error: parsed.error.message,
    };
  return { ...actions, status: "ready", revision: snapshot.revision, values: parsed.data };
}

function useHostSettings<Schema extends ZodType>(
  definition: SettingsDefinition<Schema>,
): SettingsState<Schema> {
  const rpc = useMemo(() => settingsRpc(definition.id), [definition.id]);
  const read = useRpc(rpc.read);
  const write = useRpc(rpc.write);
  const reset = useRpc(rpc.reset);
  const client = useQueryClient();
  const key = pluginSettingsKey(definition.id);
  const query = useReplicaQuery({
    queryKey: key,
    pushEvent: "plugin_settings_changed",
    queryFn: () => read({}),
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: async (
      input: { revision: string; values: z.output<Schema> } | { revision: string },
    ) => {
      const result =
        "values" in input
          ? await write({
              revision: input.revision,
              values: z.json().parse(await definition.schema.parseAsync(input.values)),
            })
          : await reset(input);
      if (result.status !== "saved") throw new Error(result.error);
      client.setQueryData(key, { ...result, status: "ready" });
    },
  });
  async function save(values: z.output<Schema>, revision: string) {
    try {
      await mutation.mutateAsync({ values, revision });
      return true;
    } catch {
      return false;
    }
  }
  async function resetValues() {
    if (!query.data) return false;
    try {
      await mutation.mutateAsync({ revision: query.data.revision });
      return true;
    } catch {
      return false;
    }
  }
  const actions = {
    saving: mutation.isPending,
    saveError: mutation.error ? message(mutation.error) : null,
    save,
    reset: resetValues,
    reload: async () => {
      mutation.reset();
      await query.refetch();
    },
  };
  if (query.isPending) return { ...actions, status: "loading" };
  if (query.isError) return { ...actions, status: "error", error: message(query.error) };
  if (query.data.status === "invalid") return { ...actions, ...query.data };
  const parsed = definition.schema.safeParse(query.data.values);
  if (!parsed.success)
    return {
      ...actions,
      status: "invalid",
      revision: query.data.revision,
      error: parsed.error.message,
    };
  return { ...actions, ...query.data, values: parsed.data };
}
