import { describe, expect, it } from "vitest";
import { buildAgentLsFetchOptions, toListItem } from "./ls.js";

describe("buildAgentLsFetchOptions", () => {
  it("fetches active agents by default", () => {
    expect(buildAgentLsFetchOptions({})).toEqual({
      scope: "active",
    });
  });

  it("keeps label and thinking filters within the active scope", () => {
    expect(
      buildAgentLsFetchOptions({
        label: ["surface=workspace"],
        thinking: " medium ",
      }),
    ).toEqual({
      scope: "active",
      filter: {
        labels: { surface: "workspace" },
        thinkingOptionId: "medium",
      },
    });
  });

  it("fetches global non-archived agents for -g", () => {
    expect(buildAgentLsFetchOptions({ global: true })).toEqual({});
  });

  it("keeps -a within the active scope", () => {
    expect(buildAgentLsFetchOptions({ all: true })).toEqual({
      scope: "active",
      filter: {
        includeArchived: true,
      },
    });
  });

  it("fetches all global agents for -a -g", () => {
    expect(buildAgentLsFetchOptions({ all: true, global: true })).toEqual({
      filter: {
        includeArchived: true,
      },
    });
  });

  it("applies filters to global queries", () => {
    expect(
      buildAgentLsFetchOptions({
        global: true,
        label: ["surface=workspace"],
        thinking: " medium ",
      }),
    ).toEqual({
      filter: {
        labels: { surface: "workspace" },
        thinkingOptionId: "medium",
      },
    });
  });
});

describe("toListItem", () => {
  const snapshot = {
    id: "0123456789abcdef",
    provider: "claude",
    cwd: "/tmp/project",
    model: null,
    title: "Busy agent",
    status: "idle",
    createdAt: new Date().toISOString(),
    effectiveThinkingOptionId: null,
  } as unknown as Parameters<typeof toListItem>[0];

  it("reports background work still running on an idle agent", () => {
    expect(toListItem({ ...snapshot, backgroundWork: true }).backgroundWork).toBe(true);
    expect(toListItem(snapshot).backgroundWork).toBe(false);
  });
});
