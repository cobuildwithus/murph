import { Buffer } from "node:buffer";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deviceSyncError } from "@murphai/device-syncd/errors";

import type { MemberOwnedProviderSetupAdapter } from "@/src/lib/device-sync/provider-setup/adapter";
import {
  MemberOwnedProviderSetupService,
} from "@/src/lib/device-sync/provider-setup/service";
import type {
  MemberOwnedProviderApplicationCreateResult,
  MemberOwnedProviderDashboardInspection,
  MemberOwnedProviderSetupConnectionDisposition,
  MemberOwnedProviderSetupRecord,
} from "@/src/lib/device-sync/provider-setup/types";
import {
  DeviceProviderApplicationError,
  type DeviceProviderApplicationView,
  type ResolvedDeviceProviderApplication,
} from "@/src/lib/device-sync/provider-applications";

const NOW = new Date("2026-08-11T12:00:00.000Z");
const MEMBER_ID = "member_synthetic";
const SETUP_ID = "dps_synthetic";
const RUN_ID = "hcr_setup_owned";
const APPLICATION: DeviceProviderApplicationView = {
  applicationId: "dpa_synthetic",
  createdAt: NOW.toISOString(),
  provider: "strava",
  revision: 3,
  updatedAt: NOW.toISOString(),
};
const RESOLVED_APPLICATION: ResolvedDeviceProviderApplication = {
  applicationId: APPLICATION.applicationId,
  provider: "strava",
  providerConfigs: {
    strava: {
      clientId: "NON_CREDENTIAL_TEST_CLIENT_ID",
      clientSecret: "NON_CREDENTIAL_TEST_CLIENT_SECRET",
    },
  },
  revision: APPLICATION.revision,
};

class MemorySetupStore {
  disposition: MemberOwnedProviderSetupConnectionDisposition = { kind: "none" };
  failMarkConnected = false;
  failMarkDisconnected = false;
  failNextTransition = false;
  failReadActive = false;
  setup: MemberOwnedProviderSetupRecord | null = buildSetup();
  readonly transitionStatuses: string[] = [];

  async ensureActive(): Promise<MemberOwnedProviderSetupRecord> {
    if (!this.setup) {
      this.setup = buildSetup();
    }
    return this.setup;
  }

  async readActive(): Promise<MemberOwnedProviderSetupRecord | null> {
    if (this.failReadActive) {
      throw new Error("synthetic projection read failure");
    }
    return this.setup;
  }

  async readOwned(input: {
    memberId: string;
    provider: "strava";
    setupId: string;
  }): Promise<MemberOwnedProviderSetupRecord> {
    if (
      !this.setup
      || input.memberId !== this.setup.memberId
      || input.provider !== this.setup.provider
      || input.setupId !== this.setup.id
    ) {
      throw new Error("setup not found");
    }
    return this.setup;
  }

  async readConnectionDisposition(): Promise<MemberOwnedProviderSetupConnectionDisposition> {
    return this.disposition;
  }

  async transition(input: {
    active?: boolean;
    browserRunId?: string | null;
    completedAt?: Date | null;
    expectedVersion: number;
    lastErrorCode?: string | null;
    memberId: string;
    provider: "strava";
    providerApplicationId?: string | null;
    providerApplicationRevision?: number | null;
    providerSubmissionAt?: Date | null;
    setupId: string;
    status: MemberOwnedProviderSetupRecord["status"];
  }): Promise<MemberOwnedProviderSetupRecord> {
    if (!this.setup) {
      throw new Error("setup not found");
    }
    expect(input.expectedVersion).toBe(this.setup.version);
    expect(input.memberId).toBe(this.setup.memberId);
    expect(input.provider).toBe(this.setup.provider);
    expect(input.setupId).toBe(this.setup.id);
    this.transitionStatuses.push(input.status);
    if (this.failNextTransition) {
      this.failNextTransition = false;
      throw new Error("synthetic durable transition failure");
    }
    this.setup = {
      ...this.setup,
      ...(input.active === undefined ? {} : { active: input.active }),
      ...(input.browserRunId === undefined ? {} : { browserRunId: input.browserRunId }),
      ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
      ...(input.lastErrorCode === undefined ? {} : { lastErrorCode: input.lastErrorCode }),
      ...(input.providerApplicationId === undefined
        ? {}
        : { providerApplicationId: input.providerApplicationId }),
      ...(input.providerApplicationRevision === undefined
        ? {}
        : { providerApplicationRevision: input.providerApplicationRevision }),
      ...(input.providerSubmissionAt === undefined
        ? {}
        : { providerSubmissionAt: input.providerSubmissionAt }),
      status: input.status,
      updatedAt: new Date(this.setup.updatedAt.getTime() + 1_000),
      version: this.setup.version + 1,
    };
    return this.setup;
  }

  async markConnectedForExactApplication(input: {
    applicationId: string;
    memberId: string;
    provider: "strava";
    revision: number;
  }): Promise<MemberOwnedProviderSetupRecord | null> {
    if (this.failMarkConnected) {
      throw new Error("synthetic projection write failure");
    }
    if (
      !this.setup
      || input.applicationId !== this.setup.providerApplicationId
      || input.memberId !== this.setup.memberId
      || input.provider !== this.setup.provider
      || input.revision !== this.setup.providerApplicationRevision
    ) {
      return null;
    }
    return this.transition({
      completedAt: NOW,
      expectedVersion: this.setup.version,
      memberId: this.setup.memberId,
      provider: this.setup.provider,
      setupId: this.setup.id,
      status: "connected",
    });
  }

  async markDisconnected(): Promise<MemberOwnedProviderSetupRecord | null> {
    if (this.failMarkDisconnected) {
      throw new Error("synthetic projection write failure");
    }
    if (!this.setup) {
      return null;
    }
    return this.transition({
      completedAt: null,
      expectedVersion: this.setup.version,
      memberId: this.setup.memberId,
      provider: this.setup.provider,
      setupId: this.setup.id,
      status: this.setup.providerApplicationId ? "oauth_ready" : "pending",
    });
  }
}

function createFakeAdapter(input: {
  capture?: (expectedRevision: number | null) => Promise<DeviceProviderApplicationView>;
  createResults?: MemberOwnedProviderApplicationCreateResult[];
  inspections?: MemberOwnedProviderDashboardInspection[];
  runId?: string;
} = {}) {
  const inspections = [...(input.inspections ?? [{ kind: "owned_application" as const }])];
  const createResults = [...(input.createResults ?? [{ kind: "submitted" as const }])];
  const ensureBrowserRun = vi.fn(async (runInput: {
    expectedRunId: string | null;
    memberId: string;
    setupId: string;
  }) => ({
    reused: runInput.expectedRunId === (input.runId ?? RUN_ID),
    runId: input.runId ?? RUN_ID,
    status: "running",
  }));
  const inspectDashboard = vi.fn(async () =>
    inspections.shift() ?? inspections.at(-1) ?? { kind: "owned_application" as const });
  const createOwnedApplication = vi.fn(async () =>
    createResults.shift() ?? { kind: "submitted" as const });
  const captureAndSealOwnedApplication = vi.fn(async (captureInput: {
    expectedRevision: number | null;
  }) => input.capture
    ? input.capture(captureInput.expectedRevision)
    : APPLICATION);
  const pauseForUser = vi.fn(async () => ({
    handoffUrl: "https://web.example.test/computer/handoff/synthetic-handoff",
    runId: input.runId ?? RUN_ID,
  }));
  const adapter: MemberOwnedProviderSetupAdapter = {
    captureAndSealOwnedApplication,
    connectSourceId: "strava",
    connectTarget: "strava",
    createOwnedApplication,
    deleteOwnedApplication: vi.fn(async () => ({ kind: "deleted" as const })),
    ensureBrowserRun,
    inspectDashboard,
    pauseForUser,
    provider: "strava",
    sourceProviderSlug: null,
  };
  return {
    adapter,
    captureAndSealOwnedApplication,
    createOwnedApplication,
    ensureBrowserRun,
    inspectDashboard,
    pauseForUser,
  };
}

function createService(input: {
  adapter: MemberOwnedProviderSetupAdapter;
  createIngress?: (request: Request) => {
    startConnectionWithProviderApplication: (
      userId: string,
      binding: { applicationId: string; provider: "strava"; revision: number },
      returnTo: string | null,
      options: {
        connectSourceId?: string | null;
        connectTarget?: string | null;
        sourceProviderSlug?: string | null;
      },
    ) => Promise<{ authorizationUrl: string; state: string }>;
  };
  readApplicationView?: () => Promise<DeviceProviderApplicationView | null>;
  resolveApplication?: () => Promise<ResolvedDeviceProviderApplication>;
  store: MemorySetupStore;
}) {
  return new MemberOwnedProviderSetupService("strava", {
    adapter: input.adapter,
    createIngress: input.createIngress ?? (() => ({
      startConnectionWithProviderApplication: vi.fn(async () => ({
        authorizationUrl: "https://www.strava.com/oauth/authorize?synthetic=1",
        state: "synthetic_state_1234567890",
      })),
    })),
    now: () => NOW,
    readApplicationView: input.readApplicationView ?? (async () => null),
    resolveApplication: input.resolveApplication ?? (async () => RESOLVED_APPLICATION),
    store: input.store,
  });
}

describe("member-owned provider setup service", () => {
  beforeEach(() => {
    vi.stubEnv(
      "HOSTED_APP_SESSION_HMAC_KEY",
      Buffer.alloc(32, 1).toString("base64url"),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("persists a signed-out handoff and resumes the exact setup-owned run", async () => {
    const store = new MemorySetupStore();
    const fake = createFakeAdapter({
      inspections: [
        { kind: "authentication_required", reason: "signed_out" },
        { kind: "owned_application" },
      ],
    });
    const service = createService({ adapter: fake.adapter, store });

    await expect(service.advance(MEMBER_ID)).resolves.toMatchObject({
      handoffUrl: "https://web.example.test/computer/handoff/synthetic-handoff",
      setup: { action: "continue_sign_in", status: "waiting_for_user" },
    });
    expect(store.setup?.browserRunId).toBe(RUN_ID);

    await expect(service.advance(MEMBER_ID, SETUP_ID)).resolves.toMatchObject({
      setup: {
        action: "continue_oauth",
        applicationRevision: APPLICATION.revision,
        status: "oauth_ready",
      },
    });
    expect(fake.ensureBrowserRun.mock.calls[1]?.[0]).toMatchObject({
      expectedRunId: RUN_ID,
      setupId: SETUP_ID,
    });
    expect(fake.pauseForUser).toHaveBeenCalledTimes(1);
  });

  it("surfaces a provider prerequisite as a recoverable first-party handoff", async () => {
    const store = new MemorySetupStore();
    const fake = createFakeAdapter({
      inspections: [{ kind: "prerequisite_required", reason: "subscription_required" }],
    });
    const service = createService({ adapter: fake.adapter, store });

    await expect(service.advance(MEMBER_ID)).resolves.toMatchObject({
      handoffUrl: expect.stringContaining("/computer/handoff/"),
      setup: { action: "continue_provider", status: "provider_prerequisite" },
    });
    expect(fake.pauseForUser).toHaveBeenCalledWith(expect.objectContaining({
      reason: "prerequisite",
      runId: RUN_ID,
      setupId: SETUP_ID,
    }));
    expect(fake.createOwnedApplication).not.toHaveBeenCalled();
  });

  it("re-inspects an ambiguous submission before a later explicit create retry", async () => {
    const store = new MemorySetupStore();
    const fake = createFakeAdapter({
      createResults: [{ kind: "ambiguous" }, { kind: "submitted" }],
      inspections: [
        { kind: "missing" },
        { kind: "missing" },
        { kind: "missing" },
        { kind: "owned_application" },
      ],
    });
    const service = createService({ adapter: fake.adapter, store });

    await expect(service.advance(MEMBER_ID)).resolves.toMatchObject({
      setup: { action: "retry", status: "inspection_required" },
    });
    expect(store.setup?.providerSubmissionAt).toEqual(NOW);
    expect(fake.createOwnedApplication).toHaveBeenCalledTimes(1);

    await expect(service.advance(MEMBER_ID, SETUP_ID)).resolves.toMatchObject({
      setup: { action: "retry", status: "inspection_required" },
    });
    expect(store.setup?.providerSubmissionAt).toBeNull();
    expect(fake.createOwnedApplication).toHaveBeenCalledTimes(1);

    await expect(service.advance(MEMBER_ID, SETUP_ID)).resolves.toMatchObject({
      setup: { action: "continue_oauth", status: "oauth_ready" },
    });
    expect(fake.createOwnedApplication).toHaveBeenCalledTimes(2);
    expect(fake.captureAndSealOwnedApplication).toHaveBeenCalledTimes(1);
  });

  it("recovers the checked-in marked application without creating a duplicate", async () => {
    const store = new MemorySetupStore();
    const fake = createFakeAdapter({
      inspections: [{ kind: "owned_application" }],
    });
    const service = createService({ adapter: fake.adapter, store });

    await expect(service.advance(MEMBER_ID)).resolves.toMatchObject({
      setup: {
        applicationRevision: APPLICATION.revision,
        status: "oauth_ready",
      },
    });
    expect(fake.createOwnedApplication).not.toHaveBeenCalled();
    expect(fake.captureAndSealOwnedApplication).toHaveBeenCalledWith({
      expectedRevision: null,
      memberId: MEMBER_ID,
      runId: RUN_ID,
      setupId: SETUP_ID,
    });
  });

  it("does not navigate before an acquired run is durably bound and safely reuses it after ambiguity", async () => {
    const store = new MemorySetupStore();
    store.failNextTransition = true;
    const fake = createFakeAdapter({
      inspections: [{ kind: "owned_application" }],
    });
    const service = createService({ adapter: fake.adapter, store });

    await expect(service.advance(MEMBER_ID)).rejects.toThrow(
      "synthetic durable transition failure",
    );
    expect(fake.inspectDashboard).not.toHaveBeenCalled();
    expect(fake.ensureBrowserRun).toHaveBeenCalledWith(expect.objectContaining({
      expectedRunId: null,
      setupId: SETUP_ID,
    }));

    await expect(service.advance(MEMBER_ID)).resolves.toMatchObject({
      setup: { status: "oauth_ready" },
    });
    expect(fake.ensureBrowserRun).toHaveBeenCalledTimes(2);
    expect(fake.inspectDashboard).toHaveBeenCalledTimes(1);
    expect(store.setup?.browserRunId).toBe(RUN_ID);
  });

  it("marks permanently malformed application state repairable but propagates transient crypto failure", async () => {
    const repairStore = new MemorySetupStore();
    repairStore.setup = buildSetup({
      providerApplicationId: APPLICATION.applicationId,
      providerApplicationRevision: APPLICATION.revision,
      status: "oauth_ready",
    });
    const repairAdapter = createFakeAdapter({
      inspections: [{ kind: "owned_application" }],
    });
    const repairService = createService({
      adapter: repairAdapter.adapter,
      resolveApplication: async () => {
        throw new DeviceProviderApplicationError(
          "DEVICE_PROVIDER_APPLICATION_INVALID",
          "Stored application cannot be decrypted.",
        );
      },
      store: repairStore,
    });

    await expect(repairService.advance(MEMBER_ID)).resolves.toMatchObject({
      setup: { status: "oauth_ready" },
    });
    expect(repairAdapter.captureAndSealOwnedApplication).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: APPLICATION.revision }),
    );

    const transientStore = new MemorySetupStore();
    transientStore.setup = buildSetup({
      providerApplicationId: APPLICATION.applicationId,
      providerApplicationRevision: APPLICATION.revision,
      status: "oauth_ready",
    });
    const transient = deviceSyncError({
      code: "DEVICE_PROVIDER_APPLICATION_KMS_UNAVAILABLE",
      httpStatus: 503,
      message: "Encryption owner unavailable.",
      retryable: true,
    });
    const transientService = createService({
      adapter: createFakeAdapter().adapter,
      resolveApplication: async () => {
        throw transient;
      },
      store: transientStore,
    });

    await expect(transientService.advance(MEMBER_ID)).rejects.toBe(transient);
    expect(transientStore.setup?.status).toBe("oauth_ready");
  });

  it("blocks application replacement while any provider connection is active", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      providerApplicationId: APPLICATION.applicationId,
      providerApplicationRevision: APPLICATION.revision,
      status: "repair_required",
    });
    store.disposition = {
      connectionId: "dsc_conflicting",
      kind: "conflict",
    };
    const service = createService({
      adapter: createFakeAdapter().adapter,
      resolveApplication: async () => {
        throw new DeviceProviderApplicationError(
          "DEVICE_PROVIDER_APPLICATION_INVALID",
          "Stored application is malformed.",
        );
      },
      store,
    });

    await expect(service.advance(MEMBER_ID)).resolves.toMatchObject({
      setup: { action: "disconnect_first", status: "disconnect_first" },
    });
  });

  it("transitions before issuing exact-revision OAuth state and leaves ambiguous ingress retryable", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      providerApplicationId: APPLICATION.applicationId,
      providerApplicationRevision: APPLICATION.revision,
      status: "oauth_ready",
    });
    const startConnection = vi.fn(async () => {
      throw new Error("synthetic ingress response lost");
    });
    const service = createService({
      adapter: createFakeAdapter().adapter,
      createIngress: () => ({ startConnectionWithProviderApplication: startConnection }),
      store,
    });

    await expect(service.startOAuth({
      memberId: MEMBER_ID,
      request: new Request("https://web.example.test/api/setup/oauth"),
      returnTo: "/connect",
      sessionId: "session_synthetic",
      setupId: SETUP_ID,
    })).rejects.toThrow("synthetic ingress response lost");
    expect(store.setup?.status).toBe("oauth_in_progress");
    expect(store.transitionStatuses).toContain("oauth_in_progress");
    expect(startConnection).toHaveBeenCalledWith(
      MEMBER_ID,
      {
        applicationId: APPLICATION.applicationId,
        provider: "strava",
        revision: APPLICATION.revision,
      },
      "/connect",
      {
        connectSourceId: "strava",
        connectTarget: "strava",
        sourceProviderSlug: null,
      },
    );
  });

  it("never issues OAuth state when the durable transition conflicts", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      providerApplicationId: APPLICATION.applicationId,
      providerApplicationRevision: APPLICATION.revision,
      status: "oauth_ready",
    });
    store.failNextTransition = true;
    const startConnection = vi.fn(async () => ({
      authorizationUrl: "https://www.strava.com/oauth/authorize?synthetic=1",
      state: "synthetic_state_1234567890",
    }));
    const service = createService({
      adapter: createFakeAdapter().adapter,
      createIngress: () => ({ startConnectionWithProviderApplication: startConnection }),
      store,
    });

    await expect(service.startOAuth({
      memberId: MEMBER_ID,
      request: new Request("https://web.example.test/api/setup/oauth"),
      returnTo: "/connect",
      sessionId: "session_synthetic",
      setupId: SETUP_ID,
    })).rejects.toThrow("synthetic durable transition failure");
    expect(startConnection).not.toHaveBeenCalled();
  });

  it("derives callback success from the exact connection even when projection writes fail", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      providerApplicationId: APPLICATION.applicationId,
      providerApplicationRevision: APPLICATION.revision,
      status: "oauth_in_progress",
    });
    store.failMarkConnected = true;
    store.disposition = {
      binding: {
        applicationId: APPLICATION.applicationId,
        provider: "strava",
        revision: APPLICATION.revision,
      },
      connectionId: "dsc_exact",
      kind: "exact",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const service = createService({ adapter: createFakeAdapter().adapter, store });

    await expect(service.markConnected({
      applicationId: APPLICATION.applicationId,
      memberId: MEMBER_ID,
      revision: APPLICATION.revision,
    })).resolves.toMatchObject({ connected: true, status: "connected" });
    expect(store.setup?.status).toBe("oauth_in_progress");
    expect(warn).toHaveBeenCalledWith(
      "Member-owned provider setup projection update failed.",
      expect.objectContaining({ operation: "oauth-callback", provider: "strava" }),
    );
  });

  it("derives successful disconnect from connection truth when projection writes fail", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      completedAt: NOW,
      providerApplicationId: APPLICATION.applicationId,
      providerApplicationRevision: APPLICATION.revision,
      status: "connected",
    });
    store.failMarkDisconnected = true;
    store.disposition = { kind: "none" };
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const service = createService({ adapter: createFakeAdapter().adapter, store });

    await expect(service.markDisconnected(MEMBER_ID)).resolves.toMatchObject({
      connected: false,
      status: "oauth_ready",
    });
    expect(store.setup?.status).toBe("connected");
  });

  it("does not turn callback success into failure when the projection read is unavailable", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      providerApplicationId: APPLICATION.applicationId,
      providerApplicationRevision: APPLICATION.revision,
      status: "oauth_in_progress",
    });
    store.failMarkConnected = true;
    store.failReadActive = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const service = createService({ adapter: createFakeAdapter().adapter, store });

    await expect(service.markConnected({
      applicationId: APPLICATION.applicationId,
      memberId: MEMBER_ID,
      revision: APPLICATION.revision,
    })).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "Member-owned provider setup projection update failed.",
      expect.objectContaining({
        operation: "oauth-callback-read",
        provider: "strava",
      }),
    );
  });

  it("does not turn disconnect success into failure when the projection read is unavailable", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      providerApplicationId: APPLICATION.applicationId,
      providerApplicationRevision: APPLICATION.revision,
      status: "connected",
    });
    store.failMarkDisconnected = true;
    store.failReadActive = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const service = createService({ adapter: createFakeAdapter().adapter, store });

    await expect(service.markDisconnected(MEMBER_ID)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "Member-owned provider setup projection update failed.",
      expect.objectContaining({
        operation: "disconnect-read",
        provider: "strava",
      }),
    );
  });

  it("rejects an adapter whose finite coordinates do not match the registry", () => {
    const fake = createFakeAdapter();
    const mismatched: MemberOwnedProviderSetupAdapter = {
      ...fake.adapter,
      connectTarget: "not-strava",
    };

    expect(() => createService({
      adapter: mismatched,
      store: new MemorySetupStore(),
    })).toThrow("does not match its registry entry");
  });
});

function buildSetup(
  overrides: Partial<MemberOwnedProviderSetupRecord> = {},
): MemberOwnedProviderSetupRecord {
  return {
    active: true,
    browserRunId: null,
    completedAt: null,
    connectSourceId: "strava",
    connectTarget: "strava",
    createdAt: NOW,
    id: SETUP_ID,
    lastErrorCode: null,
    memberId: MEMBER_ID,
    provider: "strava",
    providerApplicationId: null,
    providerApplicationRevision: null,
    providerSubmissionAt: null,
    sourceProviderSlug: null,
    status: "pending",
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
}
