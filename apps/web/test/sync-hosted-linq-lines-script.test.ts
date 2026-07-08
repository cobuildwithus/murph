import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const TEST_KEY = Buffer.alloc(32, 7).toString("base64url");

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

  it("omits malformed configured line values from stderr", () => {
    const rawLine = "15551234567";
    const result = spawnSync(
      "pnpm",
      [
        "--dir",
        "apps/web",
        "exec",
        "tsx",
        "scripts/sync-hosted-linq-lines.ts",
        "--skip-provider-inventory",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: process.env.DATABASE_URL
            ?? "postgresql://postgres:postgres@127.0.0.1:1/murph_test",
          HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION: "v1",
          HOSTED_CONTACT_PRIVACY_KEYS: `v1:${TEST_KEY}`,
          HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS: `bad ${rawLine}`,
          NODE_ENV: "test",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS");
    expect(result.stderr).not.toContain("bad");
    expect(result.stderr).not.toContain(rawLine);
  });
});
