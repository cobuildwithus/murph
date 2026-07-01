import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("sync-hosted-linq-lines script", () => {
  it("writes configured env lines before attempting provider inventory sync", () => {
    const source = readFileSync(
      new URL("../scripts/sync-hosted-linq-lines.ts", import.meta.url),
      "utf8",
    );
    const mainBody = source.slice(source.indexOf("async function main"));
    const configuredWriteIndex = mainBody.indexOf("syncHostedLinqConfiguredLinesTx({");
    const configuredLogIndex = mainBody.indexOf("Configured ${environment.linqConversationPhoneNumbers.length}");
    const assignablePoolCheckIndex =
      mainBody.indexOf("assertHostedLinqAssignableHomeLinePoolReady({");
    const inventorySyncIndex = mainBody.indexOf("syncHostedLinqPhoneNumberInventory({");
    const inventorySkipIndex = mainBody.indexOf("Skipped Linq provider inventory sync.");

    expect(configuredWriteIndex).toBeGreaterThanOrEqual(0);
    expect(configuredLogIndex).toBeGreaterThan(configuredWriteIndex);
    expect(inventorySyncIndex).toBeGreaterThan(configuredLogIndex);
    expect(inventorySkipIndex).toBeGreaterThan(inventorySyncIndex);
    expect(assignablePoolCheckIndex).toBeGreaterThan(inventorySkipIndex);
  });
});
