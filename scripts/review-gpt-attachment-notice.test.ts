import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { buildChatOnlyAttachmentNoticeDismissalExpression } = require(
  path.resolve("node_modules/@cobuild/review-gpt/src/prepare-chatgpt-draft.js"),
) as {
  buildChatOnlyAttachmentNoticeDismissalExpression: (names: string[]) => string;
};

describe("installed ReviewGPT attachment notice", () => {
  it.each([
    ["verified attachment", "review.zip", false, "dismissed"],
    ["different attachment", "other.zip", false, "blocked"],
    ["additional decision", "review.zip", true, "blocked"],
  ] as const)("handles %s without changing storage or submitting the draft", (_, name, decision, status) => {
    const clicks: string[] = [];
    const labels = ["Manage storage", "Close dialog", ...(decision ? ["Delete files"] : [])];
    const buttons = labels.map((label) => ({
      textContent: label,
      disabled: false,
      getBoundingClientRect: () => ({ width: 30, height: 20 }),
      getAttribute: () => null,
      hasAttribute: () => false,
      click: () => clicks.push(label),
    }));
    const dialog = {
      innerText:
        "File added to chat only\n\nYou don’t have enough storage space left to save this file. Remove files to create space.\n\nreview.zip\n34 MB\nManage storage\nClose dialog",
      getBoundingClientRect: () => ({ width: 300, height: 200 }),
      querySelectorAll: () => buttons,
      querySelector: () => null,
    };

    const result = vm.runInNewContext(buildChatOnlyAttachmentNoticeDismissalExpression([name]), {
      document: { querySelectorAll: () => [dialog] },
      window: {
        getComputedStyle: () => ({ display: "block", visibility: "visible", pointerEvents: "auto" }),
      },
    });

    expect(result.status).toBe(status);
    expect(clicks).toEqual(status === "dismissed" ? ["Close dialog"] : []);
  });
});
