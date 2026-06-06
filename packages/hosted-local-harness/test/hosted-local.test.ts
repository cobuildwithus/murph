import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  normalizeLegacyCloudflareHostedLocalE2eArgs,
} from "../src/compat.ts";
import {
  listHostedLocalE2eScenarios,
  resolveHostedLocalE2eScenarios,
} from "../src/e2e.ts";
import {
  applyHostedLocalProfile,
  resolveHostedLocalProfile,
} from "../src/profiles.ts";
import {
  resolveHostedLocalDevConfig,
} from "../src/dev-hosted-local/config.ts";
import {
  createHostedLocalHarnessState,
} from "../src/state.ts";
import { hostedLocalHarnessRepoRoot as repoRoot } from "../src/repo.ts";

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
    const rootPackage = JSON.parse(
      await readFile(path.join(repoRoot, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };
    const scripts = rootPackage.scripts ?? {};

    expect(scripts["hosted-local"]).toBe(
      "pnpm exec tsx --tsconfig tsconfig.base.json scripts/hosted-local.ts",
    );
    expect(scripts["dev"]).toBe("pnpm hosted-local up");
    expect(scripts["dev:reset"]).toBe(
      "MURPH_DEV_FORCE_RESET_LOCAL_DB=1 MURPH_DEV_FORCE_RESET_TEMPORAL=1 MURPH_DEV_TEMPORAL=managed pnpm hosted-local up",
    );
    expect(scripts["test:e2e:hosted-local"]).toBe("pnpm hosted-local e2e");
  });

  test("keeps Cloudflare package hosted-local E2E surface generic", async () => {
    const cloudflarePackage = JSON.parse(
      await readFile(path.join(repoRoot, "apps", "cloudflare", "package.json"), "utf8"),
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
    expect(resolveHostedLocalE2eScenarios("checkpoint-baseline")[0]?.file).toBe(
      "apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts",
    );
    expect(resolveHostedLocalE2eScenarios("telegram")[0]?.name).toBe(
      "telegram-first-contact",
    );
    expect(resolveHostedLocalE2eScenarios("linq-delivery")[0]?.name).toBe(
      "linq-first-contact",
    );
    expect(resolveHostedLocalE2eScenarios("temporal-orchestration")[0]?.file).toBe(
      "apps/cloudflare/test/hosted-local-temporal-orchestration-e2e.test.ts",
    );
    expect(resolveHostedLocalE2eScenarios("linq-typing-prewarm")[0]?.file).toBe(
      "apps/cloudflare/test/hosted-local-linq-typing-prewarm-e2e.test.ts",
    );
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name)).toContain(
      "temporal-orchestration",
    );
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name)).toContain(
      "linq-typing-prewarm",
    );
  });

  test("keeps registered hosted-local E2E scenario files present", () => {
    const missingScenarios = listHostedLocalE2eScenarios()
      .filter((scenario) => !existsSync(path.join(repoRoot, scenario.file)))
      .map((scenario) => `${scenario.name}: ${scenario.file}`);

    expect(missingScenarios).toEqual([]);
  });

  test("keeps the hosted device-sync CI workflow wired to the registered scenario", async () => {
    const workflow = await readFile(
      path.join(repoRoot, ".github", "workflows", "cloudflare-hosted-device-sync-e2e.yml"),
      "utf8",
    );
    const workflowScenarios = Array.from(
      workflow.matchAll(/pnpm hosted-local e2e ([^\s\\]+)/g),
      (match) => match[1],
    );

    expect(workflowScenarios).toEqual(["device-sync-junction-wearable-fixture"]);
    expect(resolveHostedLocalE2eScenarios("device-sync-junction-wearable-fixture")[0]?.file).toBe(
      "apps/cloudflare/test/hosted-local-device-sync-junction-wearable-fixture-e2e.test.ts",
    );
    expect(workflow).toContain(
      "HOSTED_DEVICE_ROUTING_INDEX_KEY: 0101010101010101010101010101010101010101010101010101010101010101",
    );
    expect(workflow).toContain("apps/web/app/(dashboard)/biomarkers/**");
    expect(workflow).toContain("apps/web/app/api/device-sync/**");
    expect(workflow).toContain("apps/web/app/api/internal/device-sync/**");
    expect(workflow).toContain("apps/web/app/api/settings/device-sync/**");
    expect(workflow).toContain("apps/web/app/device-sync/**");
    expect(workflow).toContain("apps/web/src/components/biomarkers/**");
    expect(workflow).toContain("apps/web/src/components/settings/hosted-device-sync-*.tsx");
    expect(workflow).toContain("apps/web/src/lib/device-sync/**");
    expect(workflow).toContain("apps/web/src/lib/health-commons/**");
    expect(workflow).toContain("apps/web/test/biomarker*");
    expect(workflow).toContain("apps/web/test/device-sync*");
    expect(workflow).toContain("apps/web/test/health-commons-biomarker*");
    expect(workflow).toContain("apps/web/test/hosted-device-sync*");
    expect(workflow).toContain("packages/contracts/**");
    expect(workflow).toContain("packages/core/**");
    expect(workflow).toContain("packages/device-syncd/**");
    expect(workflow).toContain("packages/health-commons/**");
    expect(workflow).toContain("packages/health-metrics/**");
    expect(workflow).toContain("packages/importers/**");
    expect(workflow).toContain("packages/query/**");
    expect(workflow).toContain("packages/vault-usecases/**");
    expect(workflow).toContain(".artifacts/hosted-local/**/state.json");
    expect(workflow).not.toContain("DEVICE_SYNC_ENCRYPTION_KEY");
    expect(workflow).not.toContain("DEVICE_SYNC_ENCRYPTION_KEY_VERSION");
  });

  test("keeps diagnostic hosted-local E2E scenarios opt-in", () => {
    expect(resolveHostedLocalE2eScenarios("active-turn-latency")[0]?.file).toBe(
      "apps/cloudflare/test/hosted-local-active-turn-latency-e2e.test.ts",
    );
    expect(resolveHostedLocalE2eScenarios("codex-gateway-prefix")[0]?.file).toBe(
      "apps/cloudflare/test/hosted-local-codex-gateway-prefix-e2e.test.ts",
    );
    expect(resolveHostedLocalE2eScenarios("codex-long-thread")[0]?.file).toBe(
      "apps/cloudflare/test/hosted-local-codex-long-thread-e2e.test.ts",
    );
    expect(resolveHostedLocalE2eScenarios("codex-container-continuity")[0]?.file).toBe(
      "apps/cloudflare/test/hosted-local-codex-container-continuity-e2e.test.ts",
    );
    expect(resolveHostedLocalE2eScenarios("device-sync-wake")[0]?.file).toBe(
      "apps/cloudflare/test/hosted-local-device-sync-wake-e2e.test.ts",
    );
    expect(resolveHostedLocalE2eScenarios("device-sync-junction-wearable-fixture")[0]?.file).toBe(
      "apps/cloudflare/test/hosted-local-device-sync-junction-wearable-fixture-e2e.test.ts",
    );
    expect(resolveHostedLocalE2eScenarios("stuck-invocation-recovery")[0]?.file).toBe(
      "apps/cloudflare/test/hosted-local-stuck-invocation-recovery-e2e.test.ts",
    );
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name)).not.toContain(
      "active-turn-latency",
    );
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name)).not.toContain(
      "codex-gateway-prefix",
    );
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name)).not.toContain(
      "codex-long-thread",
    );
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name)).not.toContain(
      "codex-container-continuity",
    );
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name)).not.toContain(
      "device-sync-wake",
    );
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name)).not.toContain(
      "device-sync-junction-wearable-fixture",
    );
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name)).not.toContain(
      "stuck-invocation-recovery",
    );
    expect(listHostedLocalE2eScenarios().map((scenario) => scenario.name)).toContain(
      "active-turn-latency",
    );
    expect(listHostedLocalE2eScenarios().map((scenario) => scenario.name)).toContain(
      "codex-gateway-prefix",
    );
    expect(listHostedLocalE2eScenarios().map((scenario) => scenario.name)).toContain(
      "codex-long-thread",
    );
    expect(listHostedLocalE2eScenarios().map((scenario) => scenario.name)).toContain(
      "codex-container-continuity",
    );
    expect(listHostedLocalE2eScenarios().map((scenario) => scenario.name)).toContain(
      "device-sync-wake",
    );
    expect(listHostedLocalE2eScenarios().map((scenario) => scenario.name)).toContain(
      "device-sync-junction-wearable-fixture",
    );
    expect(listHostedLocalE2eScenarios().map((scenario) => scenario.name)).toContain(
      "stuck-invocation-recovery",
    );
  });

  test("applies deterministic stub defaults without overwriting callers", () => {
    const result = applyHostedLocalProfile({
      env: { MURPH_DEV_CODEX_BRIDGE: "1" },
      profileName: "e2e:stub",
    });

    expect(resolveHostedLocalProfile("worker-only").mode).toBe("debug");
    expect(result.env.MURPH_HOSTED_LOCAL_PROFILE).toBe("e2e:stub");
    expect(result.env.HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS).toBe("250");
    expect(result.env.MURPH_DEV_CODEX_BRIDGE).toBe("1");
    expect(result.env.MURPH_DEV_SKIP_STRIPE_LISTEN).toBe("1");
    expect(result.env.MURPH_DEV_TEMPORAL).toBe("managed");
  });

  test("uses auto Temporal for the default interactive hosted-local profile", () => {
    const result = applyHostedLocalProfile({
      env: {},
      profileName: "dev",
    });

    expect(result.env.MURPH_HOSTED_LOCAL_PROFILE).toBe("dev");
    expect(result.env.MURPH_DEV_TEMPORAL).toBeUndefined();
    expect(resolveHostedLocalDevConfig(result.env).temporal.mode).toBe("auto");
  });

  test("keeps E2E profile defaults away from live tunnels and listeners", () => {
    const result = applyHostedLocalProfile({
      env: {},
      profileName: "e2e:stub",
    });

    expect(result.env.MURPH_HOSTED_LOCAL_PROFILE).toBe("e2e:stub");
    expect(result.env.MURPH_DEV_LINQ_WEBHOOK_TUNNEL).toBe("0");
    expect(result.env.MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH).toBe("1");
    expect(result.env.MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER).toBe("1");
    expect(result.env.MURPH_DEV_SKIP_STRIPE_LISTEN).toBe("1");
    expect(result.env.MURPH_DEV_SKIP_VERCEL_PULL).toBe("1");
    expect(result.env.MURPH_DEV_TEMPORAL).toBe("managed");
    expect(resolveHostedLocalDevConfig(result.env).temporal.mode).toBe("managed");
  });

  test("redacts identifiers, payload-like env values, and command secrets in state files", async () => {
    const authorizationHeaderName = "Authorization";
    const authorizationScheme = "Bearer";
    const authorizationHeaderSecret = "hosted-local-header-secret";
    const authorizationFlagSecret = "hosted-local-inline-secret";
    const { profile } = applyHostedLocalProfile({
      env: {},
      profileName: "e2e:stub",
    });
    const state = await createHostedLocalHarnessState({
      command: [
        "hosted-local",
        "run",
        "--api-key=sk_test_fixture",
        "--token",
        "split-token-fixture",
        "-H",
        `${authorizationHeaderName}: ${authorizationScheme} ${authorizationHeaderSecret}`,
        `--authorization=${authorizationScheme} ${authorizationFlagSecret}`,
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
      const text = await readFile(path.join(repoRoot, state.statePath), "utf8");
      expect(text).not.toContain("member-123");
      expect(text).not.toContain("chat-123");
      expect(text).not.toContain("hello from fixture");
      expect(text).not.toContain("sk_test_fixture");
      expect(text).not.toContain("split-token-fixture");
      expect(text).not.toContain(authorizationHeaderSecret);
      expect(text).not.toContain(authorizationFlagSecret);
      expect(text).not.toContain(process.cwd());
      expect(text).toContain('"HOSTED_MEMBER_ID": "[redacted]"');
      expect(text).toContain('"MURPH_DEV_SKIP_WEB": "1"');
      expect(text).toContain("<REPO_ROOT>");
    } finally {
      await rm(path.join(repoRoot, state.artifactDir), { force: true, recursive: true });
    }
  });
});
