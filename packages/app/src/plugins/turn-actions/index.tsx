import { PluginClientStateProvider } from "@getpaseo/plugin/client/host";
import type { PluginHostProps, PluginTurnActionProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import React, { memo, useMemo } from "react";
import { Platform } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { createPluginClientStateSource } from "../client-state/source";
import { useInstalledPlugins } from "../registry";
import { PluginRuntimeBoundary } from "../runtime-boundary";
import { SurfaceErrorBoundary } from "../surface-error-boundary";
import { toPluginTheme } from "../theme";
import type { InstalledPlugin, PluginTurnActionContribution } from "../types";

export interface TurnActionScope {
  serverId: string;
  agentId: string;
}

const renderNothing = () => null;
const pluginThemeMapping = (theme: Theme) => ({ theme: toPluginTheme(theme) });

function resolvePlatform(): PluginHostProps["layout"]["platform"] {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "web";
}

function PluginTurnActionsBody({
  scope,
  getContent,
  theme,
}: {
  scope: TurnActionScope;
  getContent: () => string;
  theme: PluginTheme;
}) {
  const { serverId, agentId } = scope;
  const installed = useInstalledPlugins();
  const actions = useMemo(
    () =>
      installed
        .filter((plugin) => plugin.serverId === serverId)
        .flatMap((plugin) => plugin.turnActions.map((action) => ({ plugin, action }))),
    [installed, serverId],
  );
  const client = useHostRuntimeClient(serverId);
  const compact = useIsCompactFormFactor();
  const hosts = useHosts();
  const hostLabel = hosts.find((host) => host.serverId === serverId)?.label ?? serverId;
  const host = useMemo(() => ({ id: serverId, label: hostLabel }), [hostLabel, serverId]);
  const layout = useMemo(() => ({ compact, platform: resolvePlatform() }), [compact]);
  const stateSource = useMemo(() => createPluginClientStateSource(serverId), [serverId]);

  const props = useMemo<PluginTurnActionProps>(
    () => ({ agentId, getContent, theme, host, layout }),
    [agentId, getContent, theme, host, layout],
  );

  if (!client || actions.length === 0) return null;
  return (
    <>
      {actions.map(({ plugin, action }) => (
        <PluginTurnAction
          key={`${plugin.id}/${action.id}`}
          plugin={plugin}
          action={action}
          client={client}
          stateSource={stateSource}
          props={props}
        />
      ))}
    </>
  );
}

function PluginTurnAction({
  plugin,
  action,
  client,
  stateSource,
  props,
}: {
  plugin: InstalledPlugin;
  action: PluginTurnActionContribution;
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>>;
  stateSource: ReturnType<typeof createPluginClientStateSource>;
  props: PluginTurnActionProps;
}) {
  const Component = action.Component;
  return (
    // A broken action drops out of the footer; the boundary still logs the failure.
    <SurfaceErrorBoundary
      installation={plugin}
      resetKey={action}
      Surface={Component}
      renderError={renderNothing}
    >
      <PluginRuntimeBoundary plugin={plugin} client={client}>
        <PluginClientStateProvider source={stateSource}>
          <Component {...props} />
        </PluginClientStateProvider>
      </PluginRuntimeBoundary>
    </SurfaceErrorBoundary>
  );
}

const ThemedPluginTurnActionsBody = withUnistyles(PluginTurnActionsBody);

/** Plugin turn actions for one completed assistant turn, in installation order. */
export const PluginTurnActions = memo(function PluginTurnActions(props: {
  scope: TurnActionScope;
  getContent: () => string;
}) {
  return <ThemedPluginTurnActionsBody {...props} uniProps={pluginThemeMapping} />;
});
