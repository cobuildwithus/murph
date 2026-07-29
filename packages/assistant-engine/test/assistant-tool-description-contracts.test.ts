import { describe, expect, it } from "vitest";

import {
  MURPH_COMPUTER_ACT_TOOL,
  MURPH_COMPUTER_FINISH_RUN_TOOL,
  MURPH_COMPUTER_OPEN_TOOL,
  MURPH_COMPUTER_OS_CONTROL_TOOL,
  MURPH_COMPUTER_PAUSE_FOR_USER_TOOL,
  MURPH_FAMILY_PLAN_TOOL,
  MURPH_GROUP_SHARED_READ_PERMISSION_OFFER_TOOL,
  MURPH_GROUP_SHARED_READ_TOOL,
  MURPH_GROUP_TOOL,
  MURPH_IMESSAGE_CONTACT_TOOL,
  MURPH_PLAN_USAGE_TOOL,
  MURPH_SEND_PROGRESS_UPDATE_TOOL,
  MURPH_SUBSCRIPTION_TOOL,
  resolveMurphDynamicTools,
} from "../src/assistant-codex/dynamic-tools.ts";
import {
  MURPH_CONNECTED_APPS_EXECUTE_TOOL,
  MURPH_CONNECTED_APPS_MANAGE_TOOL,
  MURPH_CONNECTED_APPS_SEARCH_TOOL,
} from "../src/assistant-codex/dynamic-tools/connected-apps.ts";

const groupProgressTool = resolveMurphDynamicTools({
  progressUpdateMode: "group",
}).find((tool) => tool.name === "send_progress_update");

if (!groupProgressTool) {
  throw new Error("Expected the group progress tool.");
}

const TARGET_TOOL_DESCRIPTION_BUDGETS = [
  ["send_progress_update", MURPH_SEND_PROGRESS_UPDATE_TOOL, 260],
  ["group send_progress_update", groupProgressTool, 240],
  ["family_plan", MURPH_FAMILY_PLAN_TOOL, 330],
  ["plan_usage", MURPH_PLAN_USAGE_TOOL, 380],
  ["imessage_contact", MURPH_IMESSAGE_CONTACT_TOOL, 160],
  ["subscription", MURPH_SUBSCRIPTION_TOOL, 520],
  ["group shared read", MURPH_GROUP_SHARED_READ_TOOL, 360],
  [
    "group shared read and permission offer",
    MURPH_GROUP_SHARED_READ_PERMISSION_OFFER_TOOL,
    350,
  ],
  ["group", MURPH_GROUP_TOOL, 800],
  ["computer_open", MURPH_COMPUTER_OPEN_TOOL, 250],
  ["computer_act", MURPH_COMPUTER_ACT_TOOL, 320],
  ["computer_os_control", MURPH_COMPUTER_OS_CONTROL_TOOL, 310],
  ["computer_pause_for_user", MURPH_COMPUTER_PAUSE_FOR_USER_TOOL, 300],
  ["computer_finish_run", MURPH_COMPUTER_FINISH_RUN_TOOL, 150],
  ["connected_apps_manage", MURPH_CONNECTED_APPS_MANAGE_TOOL, 260],
  ["connected_apps_search", MURPH_CONNECTED_APPS_SEARCH_TOOL, 200],
  ["connected_apps_execute", MURPH_CONNECTED_APPS_EXECUTE_TOOL, 330],
] as const;

describe("assistant tool description call contracts", () => {
  it.each(TARGET_TOOL_DESCRIPTION_BUDGETS)(
    "keeps %s within its call-contract budget",
    (_label, tool, maxLength) => {
      expect(tool.description.length).toBeLessThanOrEqual(maxLength);
      expect(tool.description).not.toContain("\n");
      expect(tool.description).not.toContain("SKILL.md");
      expect(tool.description).not.toMatch(/https?:\/\//u);
    },
  );

  it("keeps the route-wide target description footprint bounded", () => {
    const total = TARGET_TOOL_DESCRIPTION_BUDGETS.reduce(
      (sum, [, tool]) => sum + tool.description.length,
      0,
    );

    expect(total).toBeLessThanOrEqual(5_200);
  });
});
