import { Buffer } from "node:buffer";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deviceSyncError } from "@murphai/device-syncd/errors";

import type { MemberOwnedProviderSetupAdapter } from "@/src/lib/device-sync/provider-setup/adapter";
import {
  STRAVA_MEMBER_OWNED_PROVIDER_SETUP_COORDINATES,
  STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
  type MemberOwnedProviderSetupRegistration,
} from "@/src/lib/device-sync/provider-setup/registry";
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
  failBrowserRunClearOnce = false;
  failMarkDisconnected = false;
  failNextTransition = false;
  failReadActive = false;
  browserRunClearConflictsRemaining = 0;
  browserRunClearConflictUpdate:
    | Partial<MemberOwnedProviderSetupRecord>
    | null = null;
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
    if (input.browserRunId === null && this.browserRunClearConflictsRemaining > 0) {
      this.browserRunClearConflictsRemaining -= 1;
      if (this.browserRunClearConflictUpdate) {
        this.setup = {
          ...this.setup,
          ...this.browserRunClearConflictUpdate,
          updatedAt: new Date(this.setup.updatedAt.getTime() + 1_000),
          version: this.setup.version + 1,
        };
      }
      throw deviceSyncError({
        code: "DEVICE_PROVIDER_SETUP_CONFLICT",
        httpStatus: 409,
        message: "Synthetic setup CAS conflict.",
        retryable: true,
      });
    }
    if (input.browserRunId === null && this.failBrowserRunClearOnce) {
      this.failBrowserRunClearOnce = false;
      throw new Error("synthetic browser-run clear interruption");
    }
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
  cancelRunStatus?: "canceled" | "completed" | "failed";
  capture?: (expectedRevision: number | null) => Promise<DeviceProviderApplicationView>;
  finishRunStatuses?: Array<"canceled" | "completed" | "failed">;
  createResults?: MemberOwnedProviderApplicationCreateResult[];
  awaitingReasons?: Array<"login_needed" | "other" | null>;
  handoffUrls?: Array<string | null>;
  inspections?: MemberOwnedProviderDashboardInspection[];
  runId?: string;
  runStatuses?: string[];
} = {}) {
  const inspections = [...(input.inspections ?? [{ kind: "owned_application" as const }])];
  const createResults = [...(input.createResults ?? [{ kind: "submitted" as const }])];
  const awaitingReasons = [...(input.awaitingReasons ?? [null])];
  const handoffUrls = [...(input.handoffUrls ?? [
    "https://web.example.test/computer/handoff/synthetic-handoff",
  ])];
  const runStatuses = [...(input.runStatuses ?? ["running"])];
  const finishRunStatuses = [...(input.finishRunStatuses ?? ["completed"] as const)];
  const ensureBrowserRun = vi.fn(async (runInput: {
    expectedRunId: string | null;
    memberId: string;
    setupId: string;
  }) => {
    const status = runStatuses.shift() ?? runStatuses.at(-1) ?? "running";
    return {
      awaitingReason: awaitingReasons.shift() ?? awaitingReasons.at(-1) ?? null,
      reused: runInput.expectedRunId === (input.runId ?? RUN_ID),
      runId: input.runId ?? RUN_ID,
      status,
    };
  });
  const inspectDashboard = vi.fn(async () =>
    inspections.shift() ?? inspections.at(-1) ?? { kind: "owned_application" as const });
  const createOwnedApplication = vi.fn(async () =>
    createResults.shift() ?? { kind: "submitted" as const });
  const captureAndSealOwnedApplication = vi.fn(async (captureInput: {
    expectedRevision: number | null;
  }) => input.capture
    ? input.capture(captureInput.expectedRevision)
    : APPLICATION);
  const pauseForUser = vi.fn(async (_pauseInput: {
    memberId: string;
    reason: "challenge" | "prerequisite" | "signed_out";
    runId: string;
    setupId: string;
  }) => {
    void _pauseInput;
    return {
    handoffUrl: handoffUrls.shift() ?? handoffUrls.at(-1) ?? null,
    runId: input.runId ?? RUN_ID,
    };
  });
  const cancelBrowserRun = vi.fn(async () => input.cancelRunStatus ?? "canceled");
  const finishBrowserRun = vi.fn(async () =>
    finishRunStatuses.shift() ?? finishRunStatuses.at(-1) ?? "completed");
  const adapter: MemberOwnedProviderSetupAdapter = {
    cancelBrowserRun,
    captureAndSealOwnedApplication,
    connectSourceId: "strava",
    connectTarget: "strava",
    createOwnedApplication,
    deleteOwnedApplication: vi.fn(async () => ({ kind: "deleted" as const })),
    ensureBrowserRun,
    inspectDashboard,
    finishBrowserRun,
    pauseForUser,
    provider: "strava",
    sourceProviderSlug: null,
  };
  return {
    adapter,
    cancelBrowserRun,
    captureAndSealOwnedApplication,
    createOwnedApplication,
    ensureBrowserRun,
    finishBrowserRun,
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

  it("recovers a stale persisted working state into an explicit retry", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      status: "working",
      updatedAt: new Date(NOW.getTime() - 3 * 60 * 1_000),
    });
    const fake = createFakeAdapter();
    const service = createService({ adapter: fake.adapter, store });

    await expect(service.read(MEMBER_ID)).resolves.toMatchObject({
      action: "retry",
      status: "retryable_failure",
    });
    expect(fake.ensureBrowserRun).not.toHaveBeenCalled();
  });

  it("does not recover a fresh working state owned by an in-flight request", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({ status: "working" });
    const fake = createFakeAdapter();
    const service = createService({ adapter: fake.adapter, store });

    await expect(service.read(MEMBER_ID)).resolves.toMatchObject({
      action: "none",
      status: "working",
    });
    expect(store.transitionStatuses).toEqual([]);
  });

  it("projects durable setup state without constructing a browser adapter", async () => {
    const store = new MemorySetupStore();
    const createAdapter = vi.fn(() => {
      throw new Error("Projection must not construct a browser adapter.");
    });
    const registration: MemberOwnedProviderSetupRegistration = {
      coordinates: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_COORDINATES,
      createAdapter,
      presentation: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
    };
    const service = new MemberOwnedProviderSetupService("strava", {
      readApplicationView: async () => null,
      registration,
      store,
    });

    await expect(service.read(MEMBER_ID)).resolves.toMatchObject({
      action: "start",
      status: "pending",
    });
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it("persists a signed-out handoff and resumes the exact setup-owned run", async () => {
    const store = new MemorySetupStore();
    const fake = createFakeAdapter({
      inspections: [
        { kind: "authentication_required", reason: "signed_out" },
        { kind: "owned_application" },
      ],
      handoffUrls: [
        "https://web.example.test/computer/handoff/first",
        "https://web.example.test/computer/handoff/refreshed",
        "https://web.example.test/computer/handoff/back",
      ],
      awaitingReasons: [null, "login_needed", "login_needed", null],
      runStatuses: ["running", "awaiting_user", "awaiting_user", "running"],
    });
    const service = createService({ adapter: fake.adapter, store });

    await expect(service.advance(MEMBER_ID)).resolves.toMatchObject({
      handoffUrl: "https://web.example.test/computer/handoff/first",
      setup: { action: "continue_sign_in", status: "waiting_for_user" },
    });
    expect(store.setup?.browserRunId).toBe(RUN_ID);

    await expect(service.advance(MEMBER_ID, SETUP_ID)).resolves.toMatchObject({
      handoffUrl: "https://web.example.test/computer/handoff/refreshed",
      setup: { action: "continue_sign_in", status: "waiting_for_user" },
    });
    await expect(service.advance(MEMBER_ID, SETUP_ID)).resolves.toMatchObject({
      handoffUrl: "https://web.example.test/computer/handoff/back",
      setup: { action: "continue_sign_in", status: "waiting_for_user" },
    });
    expect(fake.inspectDashboard).toHaveBeenCalledTimes(1);
    expect(fake.createOwnedApplication).not.toHaveBeenCalled();
    expect(fake.captureAndSealOwnedApplication).not.toHaveBeenCalled();

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
    expect(fake.pauseForUser).toHaveBeenCalledTimes(3);
    expect(fake.pauseForUser.mock.calls.map(([call]) => call.reason)).toEqual([
      "signed_out",
      "signed_out",
      "signed_out",
    ]);
    expect(fake.createOwnedApplication).not.toHaveBeenCalled();
    expect(fake.finishBrowserRun).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      runId: RUN_ID,
      setupId: SETUP_ID,
    });
    expect(store.setup?.browserRunId).toBeNull();
  });

  it("surfaces a provider prerequisite as a recoverable first-party handoff", async () => {
    const store = new MemorySetupStore();
    const fake = createFakeAdapter({
      inspections: [{ kind: "prerequisite_required" }],
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

  it("cancels only a proved-unsent provider prerequisite and terminates its exact run", async () => {
    const store = new MemorySetupStore();
    const fake = createFakeAdapter({
      inspections: [{ kind: "prerequisite_required" }],
    });
    const service = createService({ adapter: fake.adapter, store });
    fake.cancelBrowserRun.mockImplementationOnce(async () => {
      expect(store.setup?.status).toBe("canceling");
      return "canceled";
    });

    await service.advance(MEMBER_ID);
    await expect(service.cancel(MEMBER_ID, SETUP_ID)).resolves.toMatchObject({
      action: "start",
      status: "canceled",
    });
    expect(fake.cancelBrowserRun).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      runId: RUN_ID,
      setupId: SETUP_ID,
    });
    expect(store.setup).toMatchObject({
      browserRunId: null,
      providerApplicationId: null,
      providerApplicationRevision: null,
      providerSubmissionAt: null,
      status: "canceled",
    });
    expect(fake.createOwnedApplication).not.toHaveBeenCalled();
    expect(fake.captureAndSealOwnedApplication).not.toHaveBeenCalled();
  });

  it("retries the exact external cancellation from its persisted fence", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      browserRunId: RUN_ID,
      lastErrorCode: "PROVIDER_SETUP_PROVIDER_PREREQUISITE",
      status: "provider_prerequisite",
    });
    const fake = createFakeAdapter();
    fake.cancelBrowserRun
      .mockRejectedValueOnce(new Error("NON_SECRET_TEST_RUN_CANCELLATION_FAILURE"))
      .mockResolvedValueOnce("canceled");
    const service = createService({ adapter: fake.adapter, store });

    await expect(service.cancel(MEMBER_ID, SETUP_ID)).rejects.toThrow(
      "NON_SECRET_TEST_RUN_CANCELLATION_FAILURE",
    );
    expect(store.setup?.status).toBe("canceling");

    await expect(service.cancel(MEMBER_ID, SETUP_ID)).resolves.toMatchObject({
      action: "start",
      status: "canceled",
    });
    expect(fake.cancelBrowserRun).toHaveBeenCalledTimes(2);
    expect(store.setup).toMatchObject({
      browserRunId: null,
      status: "canceled",
    });
  });

  it("blocks setup advancement while the persisted cancellation fence is active", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      browserRunId: RUN_ID,
      status: "canceling",
    });
    const fake = createFakeAdapter();
    const service = createService({ adapter: fake.adapter, store });

    await expect(service.advance(MEMBER_ID, SETUP_ID)).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_SETUP_CANCELLATION_IN_PROGRESS",
    });
    expect(fake.ensureBrowserRun).not.toHaveBeenCalled();
    expect(fake.inspectDashboard).not.toHaveBeenCalled();
    expect(fake.createOwnedApplication).not.toHaveBeenCalled();
  });

  it("does not let a stale cancellation target a different active setup", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      browserRunId: RUN_ID,
      lastErrorCode: "PROVIDER_SETUP_PROVIDER_PREREQUISITE",
      status: "provider_prerequisite",
    });
    const fake = createFakeAdapter();
    const service = createService({ adapter: fake.adapter, store });

    await expect(service.cancel(MEMBER_ID, "dps_stale")).rejects.toThrow(
      "setup not found",
    );
    expect(fake.cancelBrowserRun).not.toHaveBeenCalled();
    expect(store.setup?.status).toBe("provider_prerequisite");
  });

  it("fails closed when any provider connection is still bound", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      browserRunId: RUN_ID,
      lastErrorCode: "PROVIDER_SETUP_PROVIDER_PREREQUISITE",
      status: "provider_prerequisite",
    });
    store.disposition = {
      connectionId: "hdc_conflict",
      kind: "conflict",
    };
    const fake = createFakeAdapter();
    const service = createService({ adapter: fake.adapter, store });

    await expect(service.cancel(MEMBER_ID, SETUP_ID)).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_SETUP_CANCELLATION_UNSAFE",
    });
    expect(fake.cancelBrowserRun).not.toHaveBeenCalled();
    expect(store.setup?.status).toBe("provider_prerequisite");
  });

  it("fails closed instead of canceling when provider submission cannot be disproved", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      browserRunId: RUN_ID,
      lastErrorCode: "PROVIDER_SETUP_PROVIDER_PREREQUISITE",
      providerSubmissionAt: NOW,
      status: "provider_prerequisite",
    });
    const fake = createFakeAdapter();
    const service = createService({ adapter: fake.adapter, store });

    await expect(service.cancel(MEMBER_ID, SETUP_ID)).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_SETUP_CANCELLATION_UNSAFE",
    });
    expect(fake.cancelBrowserRun).not.toHaveBeenCalled();
    expect(store.setup?.status).toBe("provider_prerequisite");
  });

  it("fails closed instead of canceling when an application binding already exists", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      browserRunId: RUN_ID,
      lastErrorCode: "PROVIDER_SETUP_PROVIDER_PREREQUISITE",
      providerApplicationId: APPLICATION.applicationId,
      providerApplicationRevision: APPLICATION.revision,
      status: "provider_prerequisite",
    });
    const fake = createFakeAdapter();
    const service = createService({
      adapter: fake.adapter,
      readApplicationView: async () => APPLICATION,
      store,
    });

    await expect(service.cancel(MEMBER_ID, SETUP_ID)).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_SETUP_CANCELLATION_UNSAFE",
    });
    expect(fake.cancelBrowserRun).not.toHaveBeenCalled();
    expect(store.setup).toMatchObject({
      providerApplicationId: APPLICATION.applicationId,
      providerApplicationRevision: APPLICATION.revision,
      status: "provider_prerequisite",
    });
  });

  it("fails closed when the exact run did not reach the canceled terminal state", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      browserRunId: RUN_ID,
      lastErrorCode: "PROVIDER_SETUP_PROVIDER_PREREQUISITE",
      status: "provider_prerequisite",
    });
    const fake = createFakeAdapter({ cancelRunStatus: "completed" });
    const service = createService({ adapter: fake.adapter, store });

    await expect(service.cancel(MEMBER_ID, SETUP_ID)).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_SETUP_CANCELLATION_UNSAFE",
    });
    expect(store.setup).toMatchObject({
      browserRunId: RUN_ID,
      status: "canceling",
    });
  });

  it("keeps the setup active when exact-run cancellation cannot be confirmed", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      browserRunId: RUN_ID,
      lastErrorCode: "PROVIDER_SETUP_PROVIDER_PREREQUISITE",
      status: "provider_prerequisite",
    });
    const fake = createFakeAdapter();
    fake.cancelBrowserRun.mockRejectedValueOnce(
      new Error("NON_SECRET_TEST_RUN_CANCELLATION_FAILURE"),
    );
    const service = createService({ adapter: fake.adapter, store });

    await expect(service.cancel(MEMBER_ID, SETUP_ID)).rejects.toThrow(
      "NON_SECRET_TEST_RUN_CANCELLATION_FAILURE",
    );
    expect(store.setup).toMatchObject({
      browserRunId: RUN_ID,
      status: "canceling",
    });
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
    expect(fake.finishBrowserRun).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      runId: RUN_ID,
      setupId: SETUP_ID,
    });
    expect(store.setup?.browserRunId).toBeNull();
  });

  it("recovers a newer sealed credential revision after setup binding was interrupted", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      browserRunId: RUN_ID,
      providerApplicationId: APPLICATION.applicationId,
      providerApplicationRevision: APPLICATION.revision - 1,
      status: "oauth_ready",
    });
    const fake = createFakeAdapter();
    const service = createService({
      adapter: fake.adapter,
      readApplicationView: async () => APPLICATION,
      store,
    });

    await expect(service.read(MEMBER_ID)).resolves.toMatchObject({
      applicationRevision: APPLICATION.revision,
      status: "oauth_ready",
    });
    expect(store.setup?.providerApplicationRevision).toBe(APPLICATION.revision);
    expect(store.setup?.browserRunId).toBeNull();
    expect(fake.finishBrowserRun).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      runId: RUN_ID,
      setupId: SETUP_ID,
    });
    expect(fake.ensureBrowserRun).not.toHaveBeenCalled();
  });

  it("reports browser cleanup failure explicitly and retries the exact sealed binding safely", async () => {
    const store = new MemorySetupStore();
    let applicationVisible = false;
    const fake = createFakeAdapter({
      capture: async () => {
        applicationVisible = true;
        return APPLICATION;
      },
      finishRunStatuses: ["failed", "completed"],
      inspections: [{ kind: "owned_application" }],
    });
    const service = createService({
      adapter: fake.adapter,
      readApplicationView: async () => applicationVisible ? APPLICATION : null,
      store,
    });

    await expect(service.advance(MEMBER_ID)).resolves.toMatchObject({
      setup: { action: "retry", status: "retryable_failure" },
    });
    expect(store.setup).toMatchObject({
      browserRunId: RUN_ID,
      lastErrorCode: "PROVIDER_SETUP_BROWSER_CLEANUP_INCOMPLETE",
      providerApplicationId: APPLICATION.applicationId,
      providerApplicationRevision: APPLICATION.revision,
      status: "retryable_failure",
    });

    await expect(service.advance(MEMBER_ID, SETUP_ID)).resolves.toMatchObject({
      setup: { action: "continue_oauth", status: "oauth_ready" },
    });
    expect(fake.captureAndSealOwnedApplication).toHaveBeenCalledTimes(1);
    expect(fake.finishBrowserRun).toHaveBeenCalledTimes(2);
    expect(store.setup?.browserRunId).toBeNull();
  });

  it("recovers a finish-before-CAS-clear interruption without recapturing credentials", async () => {
    const store = new MemorySetupStore();
    store.failBrowserRunClearOnce = true;
    let applicationVisible = false;
    const fake = createFakeAdapter({
      capture: async () => {
        applicationVisible = true;
        return APPLICATION;
      },
      inspections: [{ kind: "owned_application" }],
    });
    const service = createService({
      adapter: fake.adapter,
      readApplicationView: async () => applicationVisible ? APPLICATION : null,
      store,
    });

    await expect(service.advance(MEMBER_ID)).rejects.toThrow(
      "synthetic browser-run clear interruption",
    );
    expect(store.setup).toMatchObject({
      browserRunId: RUN_ID,
      providerApplicationId: APPLICATION.applicationId,
      providerApplicationRevision: APPLICATION.revision,
      status: "oauth_ready",
    });

    await expect(service.advance(MEMBER_ID, SETUP_ID)).resolves.toMatchObject({
      setup: { action: "continue_oauth", status: "oauth_ready" },
    });
    expect(fake.captureAndSealOwnedApplication).toHaveBeenCalledTimes(1);
    expect(fake.finishBrowserRun).toHaveBeenCalledTimes(2);
    expect(store.setup?.browserRunId).toBeNull();
  });

  it("retries an exact browser-run clear CAS conflict after one completed finish", async () => {
    const store = new MemorySetupStore();
    store.browserRunClearConflictsRemaining = 1;
    const fake = createFakeAdapter({
      inspections: [{ kind: "owned_application" }],
    });
    const service = createService({ adapter: fake.adapter, store });

    await expect(service.advance(MEMBER_ID)).resolves.toMatchObject({
      setup: { action: "continue_oauth", status: "oauth_ready" },
    });
    expect(fake.finishBrowserRun).toHaveBeenCalledTimes(1);
    expect(store.setup?.browserRunId).toBeNull();
  });

  it("does not clear a browser run after account deletion wins the setup CAS", async () => {
    const store = new MemorySetupStore();
    store.browserRunClearConflictsRemaining = 1;
    store.browserRunClearConflictUpdate = { status: "deletion_pending" };
    const fake = createFakeAdapter({
      inspections: [{ kind: "owned_application" }],
    });
    const service = createService({ adapter: fake.adapter, store });

    await expect(service.advance(MEMBER_ID)).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_SETUP_DELETION_IN_PROGRESS",
    });
    expect(fake.finishBrowserRun).toHaveBeenCalledTimes(1);
    expect(store.setup).toMatchObject({
      browserRunId: RUN_ID,
      status: "deletion_pending",
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
    expect(fake.finishBrowserRun).toHaveBeenCalledTimes(1);
    expect(store.setup?.browserRunId).toBeNull();
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
