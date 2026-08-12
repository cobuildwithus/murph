import { describe, expect, it } from "vitest";

import type { MemberOwnedProviderSetupAdapter } from "@/src/lib/device-sync/provider-setup/adapter";
import {
  defineMemberOwnedProviderSetupRegistry,
  type MemberOwnedProviderSetupRegistration,
} from "@/src/lib/device-sync/provider-setup/registry";
import {
  toMemberOwnedProviderSetupView,
  type MemberOwnedProviderSetupPresentation,
  type MemberOwnedProviderSetupRecord,
  type MemberOwnedProviderSetupStatus,
} from "@/src/lib/device-sync/provider-setup/types";

const PROVIDERS = ["alpha-fixture", "beta-fixture"] as const;
type FixtureProvider = (typeof PROVIDERS)[number];

const MESSAGES = {
  canceled: "canceled",
  canceling: "canceling",
  connected: "connected",
  deleted: "deleted",
  deletion_pending: "deletion pending",
  disconnect_first: "disconnect first",
  inspection_required: "inspection required",
  oauth_in_progress: "oauth in progress",
  oauth_ready: "oauth ready",
  pending: "pending",
  provider_conflict: "provider conflict",
  provider_prerequisite: "provider prerequisite",
  repair_required: "repair required",
  retryable_failure: "retryable failure",
  waiting_for_user: "waiting for user",
  working: "working",
} satisfies Readonly<Record<MemberOwnedProviderSetupStatus, string>>;

describe("member-owned provider setup primitive", () => {
  it("indexes and constructs a synthetic second provider without changing shared logic", async () => {
    const registry = defineMemberOwnedProviderSetupRegistry(PROVIDERS, {
      "alpha-fixture": buildRegistration("alpha-fixture"),
      "beta-fixture": buildRegistration("beta-fixture"),
    });

    expect(registry.list()).toHaveLength(2);
    expect(registry.read("beta-fixture")?.coordinates).toEqual({
      connectSourceId: "beta-fixture",
      connectTarget: "beta-fixture",
      provider: "beta-fixture",
      sourceProviderSlug: null,
    });
    expect(registry.readByConnectSourceId("beta-fixture")?.coordinates.provider)
      .toBe("beta-fixture");
    expect(registry.readByConnectTarget("beta-fixture")?.coordinates.provider)
      .toBe("beta-fixture");

    const adapter = registry.read("beta-fixture")?.createAdapter();
    if (!adapter) {
      throw new TypeError("Synthetic provider registration was not indexed.");
    }
    expect(adapter.provider).toBe("beta-fixture");
    await expect(adapter.captureAndSealOwnedApplication({
      expectedRevision: null,
      memberId: "member_fixture",
      runId: "hcr_fixture",
      setupId: "dps_fixture",
    })).resolves.toMatchObject({
      provider: "beta-fixture",
      revision: 1,
    });
  });

  it("rejects duplicate source and target ownership across providers", () => {
    expect(() => defineMemberOwnedProviderSetupRegistry(PROVIDERS, {
      "alpha-fixture": buildRegistration("alpha-fixture"),
      "beta-fixture": buildRegistration("beta-fixture", {
        connectSourceId: "alpha-fixture",
      }),
    })).toThrow(/connectSourceId .* duplicated/u);

    expect(() => defineMemberOwnedProviderSetupRegistry(PROVIDERS, {
      "alpha-fixture": buildRegistration("alpha-fixture"),
      "beta-fixture": buildRegistration("beta-fixture", {
        connectTarget: "alpha-fixture",
      }),
    })).toThrow(/connectTarget .* duplicated/u);
  });

  it("projects the same lifecycle and recovery action for a synthetic provider", () => {
    const presentation = buildPresentation("beta-fixture");
    const setup = buildSetup("beta-fixture", "provider_conflict");

    expect(toMemberOwnedProviderSetupView(setup, presentation)).toMatchObject({
      action: "retry",
      connected: false,
      message: "provider conflict",
      provider: "beta-fixture",
      status: "provider_conflict",
    });
  });
});

function buildRegistration<TProvider extends FixtureProvider>(
  provider: TProvider,
  coordinates: {
    connectSourceId?: string;
    connectTarget?: string;
  } = {},
): MemberOwnedProviderSetupRegistration<TProvider> {
  return {
    coordinates: {
      connectSourceId: coordinates.connectSourceId ?? provider,
      connectTarget: coordinates.connectTarget ?? provider,
      provider,
      sourceProviderSlug: null,
    },
    createAdapter: () => buildAdapter(provider, {
      connectSourceId: coordinates.connectSourceId ?? provider,
      connectTarget: coordinates.connectTarget ?? provider,
    }),
    presentation: buildPresentation(provider),
  };
}

function buildAdapter<TProvider extends FixtureProvider>(
  provider: TProvider,
  coordinates: { connectSourceId: string; connectTarget: string },
): MemberOwnedProviderSetupAdapter<TProvider> {
  return {
    ...coordinates,
    provider,
    sourceProviderSlug: null,
    createOwnedApplication: async () => ({ kind: "submitted" }),
    captureAndSealOwnedApplication: async () => ({
      applicationId: `dpa_${provider}`,
      createdAt: "2026-08-12T00:00:00.000Z",
      provider,
      revision: 1,
      updatedAt: "2026-08-12T00:00:00.000Z",
    }),
    cancelBrowserRun: async () => "canceled",
    deleteOwnedApplication: async () => ({ kind: "missing" }),
    ensureBrowserRun: async () => ({
      awaitingReason: null,
      reused: false,
      runId: `hcr_${provider}`,
      status: "running",
    }),
    finishBrowserRun: async () => "canceled",
    inspectDashboard: async () => ({ kind: "owned_application" }),
    pauseForUser: async () => ({
      handoffUrl: "/computer/handoff/synthetic",
      runId: `hcr_${provider}`,
    }),
  };
}

function buildPresentation<TProvider extends FixtureProvider>(
  provider: TProvider,
): MemberOwnedProviderSetupPresentation<TProvider> {
  return {
    actionLabels: {
      continue_oauth: "Continue to OAuth",
      continue_provider: "Continue at provider",
      continue_sign_in: "Continue sign-in",
      disconnect_first: "Disconnect first",
      retry: "Retry",
      start: "Start",
    },
    cancelSetupLabel: "Cancel setup",
    messages: MESSAGES,
    provider,
    providerName: provider,
    readOnlyAccessLabel: "Read-only",
  };
}

function buildSetup<TProvider extends FixtureProvider>(
  provider: TProvider,
  status: MemberOwnedProviderSetupStatus,
): MemberOwnedProviderSetupRecord<TProvider> {
  const now = new Date("2026-08-12T00:00:00.000Z");
  return {
    active: true,
    browserRunId: null,
    completedAt: null,
    connectSourceId: provider,
    connectTarget: provider,
    createdAt: now,
    id: "dps_fixture",
    lastErrorCode: null,
    memberId: "member_fixture",
    provider,
    providerApplicationId: null,
    providerApplicationRevision: null,
    providerSubmissionAt: null,
    sourceProviderSlug: null,
    status,
    updatedAt: now,
    version: 1,
  };
}
