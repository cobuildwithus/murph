import { afterEach, describe, expect, it, vi } from "vitest";

const FUTURE_MINUTES_SCOPE = {
  projectionKind: "activity-minutes-days.v1",
  selector: { activityKind: "future-minutes-kind" },
} as const;

const LEGACY_RUNNING_MINUTES_SCOPE = {
  projectionKind: "activity-minutes-days.v1",
  selector: { activityKind: "running" },
} as const;

describe("hosted vault-share supported projection scopes", () => {
  afterEach(() => {
    vi.doUnmock("@murphai/hosted-execution/vault-share");
    vi.resetModules();
  });

  it("keeps omitted-capability fallback frozen when the live registry adds new scopes", async () => {
    vi.doMock("@murphai/hosted-execution/vault-share", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@murphai/hosted-execution/vault-share")>();

      return {
        ...actual,
        HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES: Object.freeze([
          ...actual.HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES,
          FUTURE_MINUTES_SCOPE,
        ]),
      };
    });

    const [
      supportedProjectionScopes,
      hostedVaultShare,
    ] = await Promise.all([
      import("../src/lib/hosted-vault-share/supported-projection-scopes"),
      vi.importActual<typeof import("@murphai/hosted-execution/vault-share")>(
        "@murphai/hosted-execution/vault-share",
      ),
    ]);

    const supported =
      supportedProjectionScopes.readHostedVaultShareSupportedProjectionScopeKeysFromRequest(
        new Request("https://worker.example.test/internal/vault-share/active-kinds"),
      );

    expect(supported).toContain(
      hostedVaultShare.buildHostedVaultShareProjectionScopeKey(LEGACY_RUNNING_MINUTES_SCOPE),
    );
    expect(supported).not.toContain("device-sync-status.v0");
    expect(supported).not.toContain("protein-days.v0");
    expect(supported).not.toContain("calories-days.v0");
    expect(supported).not.toContain("carbs-days.v0");
    expect(supported).not.toContain("fat-days.v0");
    expect(supported).not.toContain("fiber-days.v0");
    expect(supported).not.toContain("sleep-duration-days.v0");
    expect(supported).not.toContain("deep-sleep-days.v0");
    expect(supported).not.toContain("rem-sleep-days.v0");
    expect(supported).not.toContain("workouts.v0");
    expect(supported).not.toContain(
      hostedVaultShare.buildHostedVaultShareProjectionScopeKey(FUTURE_MINUTES_SCOPE),
    );
  });

  it("accepts an explicitly declared protein projection capability", async () => {
    const supportedProjectionScopes = await import(
      "../src/lib/hosted-vault-share/supported-projection-scopes"
    );

    const supported =
      supportedProjectionScopes.readHostedVaultShareSupportedProjectionScopeKeysFromRequest(
        new Request(
          "https://worker.example.test/internal/vault-share/active-kinds?supportedProjectionScope=protein-days.v0",
        ),
      );

    expect([...supported]).toEqual(["protein-days.v0"]);
  });

  it("requires the exact deferred-work capability version", async () => {
    const supportedProjectionScopes = await import(
      "../src/lib/hosted-vault-share/supported-projection-scopes"
    );

    expect(supportedProjectionScopes.supportsHostedVaultShareDeferredProjectionWork(
      new Request(
        "https://worker.example.test/internal/vault-share/active-kinds?deferredProjectionWork=v1",
      ),
    )).toBe(true);
    expect(supportedProjectionScopes.supportsHostedVaultShareDeferredProjectionWork(
      new Request(
        "https://worker.example.test/internal/vault-share/active-kinds?deferredProjectionWork=v2",
      ),
    )).toBe(false);
  });
});
