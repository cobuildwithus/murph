import { describe, expect, it } from "vitest";

import {
  MURPH_COMPUTER_ACT_TOOL,
  MURPH_COMPUTER_FINISH_RUN_TOOL,
  MURPH_COMPUTER_OPEN_TOOL,
  MURPH_COMPUTER_OS_CONTROL_TOOL,
  MURPH_COMPUTER_PAUSE_FOR_USER_TOOL,
  MURPH_FAMILY_PLAN_TOOL,
  MURPH_GROUP_CHAT_TOOL,
  MURPH_GROUP_CONSULT_TOOL,
  MURPH_GROUP_DATA_TOOL,
  MURPH_GROUP_EMAIL_TOOL,
  MURPH_GROUP_MEMBERSHIP_TOOL,
  MURPH_GROUP_SHARED_READ_PERMISSION_OFFER_TOOL,
  MURPH_GROUP_SHARED_READ_TOOL,
  MURPH_GROUP_USAGE_TOOL,
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

const CALL_CONTRACT_TOOLS = [
  ["send_progress_update", MURPH_SEND_PROGRESS_UPDATE_TOOL],
  ["group send_progress_update", groupProgressTool],
  ["family_plan", MURPH_FAMILY_PLAN_TOOL],
  ["plan_usage", MURPH_PLAN_USAGE_TOOL],
  ["imessage_contact", MURPH_IMESSAGE_CONTACT_TOOL],
  ["subscription", MURPH_SUBSCRIPTION_TOOL],
  ["group shared read", MURPH_GROUP_SHARED_READ_TOOL],
  [
    "group shared read and permission offer",
    MURPH_GROUP_SHARED_READ_PERMISSION_OFFER_TOOL,
  ],
  ["group_consult", MURPH_GROUP_CONSULT_TOOL],
  ["group_data", MURPH_GROUP_DATA_TOOL],
  ["group_membership", MURPH_GROUP_MEMBERSHIP_TOOL],
  ["group_usage", MURPH_GROUP_USAGE_TOOL],
  ["group_chat", MURPH_GROUP_CHAT_TOOL],
  ["group_email", MURPH_GROUP_EMAIL_TOOL],
  ["computer_open", MURPH_COMPUTER_OPEN_TOOL],
  ["computer_act", MURPH_COMPUTER_ACT_TOOL],
  ["computer_os_control", MURPH_COMPUTER_OS_CONTROL_TOOL],
  ["computer_pause_for_user", MURPH_COMPUTER_PAUSE_FOR_USER_TOOL],
  ["computer_finish_run", MURPH_COMPUTER_FINISH_RUN_TOOL],
  ["connected_apps_manage", MURPH_CONNECTED_APPS_MANAGE_TOOL],
  ["connected_apps_search", MURPH_CONNECTED_APPS_SEARCH_TOOL],
  ["connected_apps_execute", MURPH_CONNECTED_APPS_EXECUTE_TOOL],
] as const;

// Sizes live in test/support/instruction-budgets.json, for every tool.
describe("assistant tool description call contracts", () => {
  it.each(CALL_CONTRACT_TOOLS)(
    "keeps %s a single-line call contract with no skill path or URL",
    (_label, tool) => {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.description).not.toContain("\n");
      expect(tool.description).not.toContain("SKILL.md");
      expect(tool.description).not.toMatch(/https?:\/\//u);
    },
  );
});
