import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  listHostedLocalE2eScenarios,
  resolveHostedLocalE2eScenarios,
} from "../src/e2e.ts";
import {
  listHostedLocalProfiles,
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
    expect(scripts["dev:worktree"]).toBe("pnpm hosted-local worktree up");
    expect(scripts["dev:reset"]).toBe(
      "MURPH_DEV_FORCE_RESET_LOCAL_DB=1 MURPH_DEV_TEMPORAL=managed pnpm hosted-local up",
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
    expect(resolveHostedLocalE2eScenarios("cold-start-benchmark")[0]).toEqual({
      file: "apps/cloudflare/test/hosted-local-cold-start-benchmark-e2e.test.ts",
      manualOnly: true,
      name: "cold-start-benchmark",
      testControls: true,
    });
    expect(resolveHostedLocalE2eScenarios("telegram")[0]?.name).toBe(
      "telegram-first-contact",
    );
    expect(resolveHostedLocalE2eScenarios("telegram-scheduled-reminder")[0]?.file).toBe(
      "apps/cloudflare/test/hosted-local-telegram-scheduled-reminder-e2e.test.ts",
    );
    expect(resolveHostedLocalE2eScenarios("linq-delivery")[0]?.name).toBe(
      "linq-first-contact",
    );
    expect(resolveHostedLocalE2eScenarios("linq-same-wake-batching")[0]).toEqual({
      file: "apps/cloudflare/test/hosted-local-linq-same-wake-batching-e2e.test.ts",
      name: "linq-same-wake-batching",
    });
    expect(resolveHostedLocalE2eScenarios("linq-group-route-drift")[0]?.file).toBe(
      "apps/cloudflare/test/hosted-local-linq-group-route-drift-e2e.test.ts",
    );
    expect(
      resolveHostedLocalE2eScenarios("linq-group-ios-app-download")[0],
    ).toEqual({
      file:
        "apps/cloudflare/test/hosted-local-linq-group-ios-app-download-e2e.test.ts",
      manualOnly: true,
      name: "linq-group-ios-app-download",
    });
    expect(resolveHostedLocalE2eScenarios("personalized-next-trials")[0]).toEqual({
      dedicatedVitestProcess: true,
      file: "apps/cloudflare/test/hosted-local-personalized-next-trials-e2e.test.ts",
      manualOnly: true,
      name: "personalized-next-trials",
      testControls: true,
    });
    expect(
      resolveHostedLocalE2eScenarios("linq-home-line-reroute-retry")[0]?.file,
    ).toBe(
      "apps/cloudflare/test/hosted-local-linq-home-line-reroute-retry-e2e.test.ts",
    );
    expect(
      resolveHostedLocalE2eScenarios("family-sponsored-group-roundtrip")[0]?.file,
    ).toBe(
      "apps/cloudflare/test/hosted-local-family-sponsored-group-roundtrip-e2e.test.ts",
    );
    expect(resolveHostedLocalE2eScenarios("group-email-newsletter")[0]).toEqual({
      dedicatedVitestProcess: true,
      file: "apps/cloudflare/test/hosted-local-group-email-newsletter-e2e.test.ts",
      name: "group-email-newsletter",
    });
    expect(
      resolveHostedLocalE2eScenarios("group-sleep-source-sharing")[0]?.file,
    ).toBe(
      "apps/cloudflare/test/hosted-local-group-sleep-source-sharing-e2e.test.ts",
    );
    expect(
      resolveHostedLocalE2eScenarios("linq-unknown-first-contact-fallback")[0]?.file,
    ).toBe(
      "apps/cloudflare/test/hosted-local-linq-unknown-first-contact-fallback-e2e.test.ts",
    );
    expect(resolveHostedLocalE2eScenarios("temporal-orchestration")[0]?.file).toBe(
      "apps/cloudflare/test/hosted-local-temporal-orchestration-e2e.test.ts",
    );
    expect(resolveHostedLocalE2eScenarios("timezone-injection")[0]?.file).toBe(
      "apps/cloudflare/test/hosted-local-timezone-injection-e2e.test.ts",
    );
    expect(resolveHostedLocalE2eScenarios("snapshot-publication-fallback")[0]).toEqual({
      file: "apps/cloudflare/test/hosted-local-snapshot-publication-fallback-e2e.test.ts",
      name: "snapshot-publication-fallback",
      testControls: true,
    });
    expect(resolveHostedLocalE2eScenarios("foreground-reply-priority")[0]).toEqual({
      dedicatedVitestProcess: true,
      file: "apps/cloudflare/test/hosted-local-foreground-reply-priority-e2e.test.ts",
      name: "foreground-reply-priority",
      testControls: true,
      vitestProcessTestNamePatterns: [
        "^hosted local foreground reply priority e2e",
        "^hosted local foreground checkpoint ordering e2e",
      ],
    });
    expect(resolveHostedLocalE2eScenarios("hosted-web-browser-smoke")[0]).toEqual({
      dedicatedVitestProcess: true,
      file: "apps/cloudflare/test/hosted-local-web-browser-smoke-e2e.test.ts",
      manualOnly: true,
      name: "hosted-web-browser-smoke",
    });
    for (const [name, file] of [
      ["canonical-receipt-lost-ack-recovery", "hosted-local-canonical-receipt-lost-ack-recovery"],
      ["computer-handoff-linq-roundtrip", "hosted-local-computer-handoff-linq-roundtrip"],
      ["retell-call-result-roundtrip", "hosted-local-retell-call-result-roundtrip"],
      ["retryable-outbox-foreground-restart", "hosted-local-retryable-outbox-foreground-restart"],
      ["shutdown-checkpoint-conversation-ahead", "hosted-local-shutdown-checkpoint-conversation-ahead"],
      ["usage-limit-ambiguous-send", "hosted-local-usage-limit-ambiguous-send"],
      ["vault-file-approval-resume", "hosted-local-vault-file-approval-resume"],
    ] as const) {
      expect(resolveHostedLocalE2eScenarios(name)[0]?.file).toBe(
        `apps/cloudflare/test/${file}-e2e.test.ts`,
      );
    }
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name)).toContain(
      "temporal-orchestration",
    );
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name)).toContain(
      "timezone-injection",
    );
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name))
      .not.toContain("cold-start-benchmark");
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name))
      .not.toContain("hosted-web-browser-smoke");
    expect(resolveHostedLocalE2eScenarios([
      "linq-delivery",
      "temporal-orchestration",
    ]).map((scenario) => scenario.name)).toEqual([
      "linq-first-contact",
      "temporal-orchestration",
    ]);
    expect(() => resolveHostedLocalE2eScenarios(["linq-delivery", "linq-first-contact"]))
      .toThrow("Duplicate hosted-local E2E scenario selection");
    expect(() => resolveHostedLocalE2eScenarios(["all", "telegram"]))
      .toThrow("cannot be combined");
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name)).toContain(
      "linq-group-route-drift",
    );
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name))
      .not.toContain("linq-group-ios-app-download");
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name))
      .not.toContain("personalized-next-trials");
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name)).toContain(
      "linq-home-line-reroute-retry",
    );
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name)).toContain(
      "family-sponsored-group-roundtrip",
    );
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name)).toContain(
      "linq-unknown-first-contact-fallback",
    );
    expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name)).toContain(
      "snapshot-publication-fallback",
    );
    for (const name of [
      "canonical-receipt-lost-ack-recovery",
      "computer-handoff-linq-roundtrip",
      "retell-call-result-roundtrip",
      "retryable-outbox-foreground-restart",
      "shutdown-checkpoint-conversation-ahead",
      "usage-limit-ambiguous-send",
      "vault-file-approval-resume",
    ] as const) {
      expect(resolveHostedLocalE2eScenarios("all").map((scenario) => scenario.name)).toContain(
        name,
      );
    }
  });

  test("keeps registered hosted-local E2E scenario files present", () => {
    const missingScenarios = listHostedLocalE2eScenarios()
      .filter((scenario) => !existsSync(path.join(repoRoot, scenario.file)))
      .map((scenario) => `${scenario.name}: ${scenario.file}`);

    expect(missingScenarios).toEqual([]);
  });

  test("keeps promoted hosted E2E scenarios on their required registry boundaries", () => {
    const scenarios = new Map(
      listHostedLocalE2eScenarios().map((scenario) => [scenario.name, scenario]),
    );

    expect(scenarios.get("linq-webhook-audio")).toMatchObject({
      requiresParserToolchain: true,
      testControls: true,
    });
    expect(scenarios.get("linq-lost-active-operation")).toMatchObject({
      manualOnly: true,
      testControls: true,
    });
    for (const name of [
      "canonical-receipt-lost-ack-recovery",
      "codex-image-media-delivery",
      "foreground-reply-priority",
      "retryable-outbox-foreground-restart",
      "shutdown-checkpoint-conversation-ahead",
      "snapshot-publication-fallback",
      "vault-file-approval-resume",
    ] as const) {
      expect(scenarios.get(name)).toMatchObject({
        testControls: true,
      });
    }
    for (const name of [
      "linq-onboarding-followup",
      "openai-egress-authority",
      "provider-egress-token-bridge",
      "warm-reuse-egress",
    ] as const) {
      expect(scenarios.get(name)).toMatchObject({
        dedicatedVitestProcess: true,
      });
    }
    expect(scenarios.get("timezone-injection")).toEqual({
      file: "apps/cloudflare/test/hosted-local-timezone-injection-e2e.test.ts",
      name: "timezone-injection",
    });
    expect(scenarios.get("linq-same-wake-batching")).toEqual({
      file: "apps/cloudflare/test/hosted-local-linq-same-wake-batching-e2e.test.ts",
      name: "linq-same-wake-batching",
    });
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
    expect(resolveHostedLocalE2eScenarios("device-sync-junction-wearable-direct-resource-replay")[0]?.file).toBe(
      "apps/cloudflare/test/hosted-local-device-sync-junction-wearable-direct-resource-replay-e2e.test.ts",
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
      "device-sync-junction-wearable-direct-resource-replay",
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
      "device-sync-junction-wearable-direct-resource-replay",
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
    expect(result.env.TEMPORAL_DEV_HEADLESS).toBe("1");
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

  test("keeps worktree off the public hosted-local profile list", () => {
    expect(listHostedLocalProfiles().map((profile) => profile.name)).not.toContain("worktree");
    expect(() => resolveHostedLocalProfile("worktree")).toThrow(
      "Unsupported hosted-local profile",
    );
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
    expect(result.env.TEMPORAL_DEV_HEADLESS).toBe("1");
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
        MURPH_E2E_WHOOP_OTP: "654321",
        MURPH_E2E_OURA_OTP: "765432",
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
      expect(text).not.toContain("654321");
      expect(text).not.toContain("765432");
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
