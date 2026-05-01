import { readFile, rm } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  normalizeLegacyCloudflareHostedLocalE2eArgs,
} from "../packages/hosted-local-harness/src/compat.ts";
import {
  resolveHostedLocalE2eScenarios,
} from "../packages/hosted-local-harness/src/e2e.ts";
import {
  applyHostedLocalProfile,
  resolveHostedLocalProfile,
} from "../packages/hosted-local-harness/src/profiles.ts";
import {
  createHostedLocalHarnessState,
} from "../packages/hosted-local-harness/src/state.ts";

describe("hosted-local harness", () => {
  test("keeps legacy Cloudflare E2E entrypoint on the no-bundle path", () => {
    expect(normalizeLegacyCloudflareHostedLocalE2eArgs([])).toEqual([
      "all",
      "--no-bundle",
    ]);
    expect(normalizeLegacyCloudflareHostedLocalE2eArgs(["linq-webhook"])).toEqual([
      "linq-webhook",
      "--no-bundle",
    ]);
    expect(normalizeLegacyCloudflareHostedLocalE2eArgs(["--bundle"])).toEqual([
      "all",
    ]);
  });

  test("keeps root hosted-local scripts canonical", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = rootPackage.scripts ?? {};

    expect(scripts["hosted-local"]).toBe(
      "pnpm exec tsx --tsconfig tsconfig.base.json scripts/hosted-local.ts",
    );
    expect(scripts["dev"]).toBe("pnpm hosted-local up");
    expect(scripts["test:e2e:hosted-local"]).toBe("pnpm hosted-local e2e");
  });

  test("keeps Cloudflare package hosted-local E2E surface generic", async () => {
    const cloudflarePackage = JSON.parse(
      await readFile("apps/cloudflare/package.json", "utf8"),
    ) as { scripts?: Record<string, string> };
    const scripts = cloudflarePackage.scripts ?? {};

    expect(scripts["test:e2e:hosted-local"]).toBe(
      "pnpm --dir ../.. hosted-local e2e",
    );

    const allowedLocalE2eScripts = new Set([
      "test:e2e:local",
      "test:e2e:hosted-local",
      "test:e2e:workers:local",
      "test:e2e:full-stack:local",
      "test:e2e:smoke:local",
      "test:e2e:runner-python:local",
    ]);

    const bespokeLocalE2eScripts = Object.keys(scripts).filter(
      (name) =>
        name.startsWith("test:e2e:") &&
        name.endsWith(":local") &&
        !allowedLocalE2eScripts.has(name),
    );

    expect(bespokeLocalE2eScripts).toEqual([]);
  });

  test("resolves scenario aliases through one registry", () => {
    expect(resolveHostedLocalE2eScenarios("telegram")[0]?.name).toBe(
      "telegram-first-contact",
    );
    expect(resolveHostedLocalE2eScenarios("linq-delivery")[0]?.name).toBe(
      "linq-first-contact",
    );
  });

  test("applies deterministic stub defaults without overwriting callers", () => {
    const result = applyHostedLocalProfile({
      env: { MURPH_DEV_CODEX_BRIDGE: "1" },
      profileName: "e2e:stub",
    });

    expect(resolveHostedLocalProfile("worker-only").mode).toBe("debug");
    expect(result.env.MURPH_HOSTED_LOCAL_PROFILE).toBe("e2e:stub");
    expect(result.env.MURPH_DEV_CODEX_BRIDGE).toBe("1");
    expect(result.env.MURPH_DEV_SKIP_STRIPE_LISTEN).toBe("1");
  });

  test("redacts identifiers, payload-like env values, and command secrets in state files", async () => {
    const { profile } = applyHostedLocalProfile({
      env: {},
      profileName: "e2e:stub",
    });
    const state = await createHostedLocalHarnessState({
      command: [
        "hosted-local",
        "run",
        "--api-key=sk_test_fixture",
        `${process.cwd()}/local-command-path`,
      ],
      env: {
        HOSTED_MEMBER_ID: "member-123",
        LINQ_CHAT_ID: "chat-123",
        MURPH_DEV_SKIP_WEB: "1",
        TELEGRAM_MESSAGE_TEXT: "hello from fixture",
      },
      profile,
      runIdSuffix: "redaction-test",
    });

    try {
      const text = await readFile(state.statePath, "utf8");
      expect(text).not.toContain("member-123");
      expect(text).not.toContain("chat-123");
      expect(text).not.toContain("hello from fixture");
      expect(text).not.toContain("sk_test_fixture");
      expect(text).not.toContain(process.cwd());
      expect(text).toContain('"HOSTED_MEMBER_ID": "[redacted]"');
      expect(text).toContain('"MURPH_DEV_SKIP_WEB": "1"');
      expect(text).toContain("<REPO_ROOT>");
    } finally {
      await rm(state.artifactDir, { force: true, recursive: true });
    }
  });
});
