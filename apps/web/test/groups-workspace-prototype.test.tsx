import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GroupsWorkspacePrototype } from "@/src/components/hosted-groups/groups-workspace-prototype";

import { renderClientComponent } from "./render-client-component";

let cleanupRender: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
  vi.unstubAllGlobals();
});

describe("GroupsWorkspacePrototype", () => {
  it("keeps the owner view focused on channel, role, and three detail sections", async () => {
    const rendered = await renderClientComponent(
      createElement(GroupsWorkspacePrototype),
    );
    cleanupRender = rendered.cleanup;

    const text = rendered.container.textContent ?? "";
    expect(text).toContain("iMessage");
    expect(text).toContain("Owner");
    expect(text).toContain("Context");
    expect(text).toContain("People");
    expect(text).toContain("Usage & funding");
    expect(text.match(/6 people/gu)).toHaveLength(1);
    expect(text).not.toContain("Custom group");
    expect(text).not.toContain("Active");
    expect(text).toContain("Edit group");
  });

  it("lets a member edit shared Murph settings without owner title authority", async () => {
    const rendered = await renderClientComponent(
      createElement(GroupsWorkspacePrototype, {
        initialSelectedGroupId: "warsaw-runners",
      }),
    );
    cleanupRender = rendered.cleanup;

    const text = rendered.container.textContent ?? "";
    expect(text).toContain("Telegram");
    expect(text).toContain("Member");
    expect(text).toContain("Edit Murph");
    expect(text).toContain("Leave group");
    expect(text).not.toContain("Edit group");
  });
});
