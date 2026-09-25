/**
 * @vitest-environment jsdom
 */
import appPackage from "../../../package.json";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hostClient = vi.hoisted(() => ({ invokePluginRpc: async () => null }));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => hostClient as unknown as DaemonClient,
  useHosts: () => [{ serverId: "host-1", label: "Local" }],
}));
vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
}));
vi.mock("../navigation", () => ({
  createPluginNavigation: () => ({}),
}));
vi.mock("../client-runtime", () => ({
  createPluginClientRuntime: () => ({
    paseo: {},
    dispose: () => {},
    rpc: async () => undefined,
    openSurface: () => undefined,
    openPanel: () => undefined,
    addComposerPill: () => ({ update() {}, remove() {} }),
    addHeaderButton: () => ({ update() {}, remove() {} }),
  }),
}));
vi.mock("../icons", () => ({
  Icon: () => null,
  resolvePluginIcon: () => () => null,
}));

import { pluginRegistry } from "../registry";
import { PluginTurnActions } from "./index";

const listenBundle = `(function(require) {
  const React = require("react");
  return { default: function(plugin) {
    function Listen(props) {
      return React.createElement("span", null, props.agentId + ":" + props.getContent());
    }
    plugin.addTurnAction({ id: "listen", Component: Listen });
    return function() {};
  } };
})`;

const brokenBundle = `(function() {
  return { default: function(plugin) {
    function Broken() { throw new Error("turn action exploded"); }
    plugin.addTurnAction({ id: "broken", Component: Broken });
    return function() {};
  } };
})`;

const roots: Array<ReturnType<typeof createRoot>> = [];
const containers: HTMLElement[] = [];
const daemonClient = {} as DaemonClient;
const scope = { serverId: "host-1", agentId: "agent-1" };
const otherHostScope = { serverId: "host-2", agentId: "agent-1" };
const getContent = () => "The tests pass.";

function install(entries: Array<{ id: string; clientBundle: string }>) {
  pluginRegistry.installCatalog(
    "host-1",
    entries.map((entry) => ({ ...entry, requirements: { paseo: `>=${appPackage.version}` } })),
    { client: daemonClient },
  );
}

async function render(element: React.ReactElement) {
  const container = document.createElement("div");
  containers.push(container);
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  return container;
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const container of containers.splice(0)) container.remove();
  pluginRegistry.removeHost("host-1");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PluginTurnActions", () => {
  it("renders each action with the agent and the turn content", async () => {
    install([{ id: "read-aloud", clientBundle: listenBundle }]);
    const container = await render(<PluginTurnActions scope={scope} getContent={getContent} />);
    expect(container.textContent).toBe("agent-1:The tests pass.");
  });

  it("only renders actions from the turn's host", async () => {
    install([{ id: "read-aloud", clientBundle: listenBundle }]);
    const container = await render(
      <PluginTurnActions scope={otherHostScope} getContent={getContent} />,
    );
    expect(container.textContent).toBe("");
  });

  it("drops a crashing action without disturbing the others", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    install([
      { id: "broken", clientBundle: brokenBundle },
      { id: "read-aloud", clientBundle: listenBundle },
    ]);
    const container = await render(<PluginTurnActions scope={scope} getContent={getContent} />);
    expect(container.textContent).toBe("agent-1:The tests pass.");
  });
});
