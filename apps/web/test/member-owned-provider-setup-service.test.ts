import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DeviceProviderApplicationError,
  saveDeviceProviderApplication,
  type DeviceProviderApplicationView,
  type ResolvedDeviceProviderApplication,
} from "@/src/lib/device-sync/provider-applications";
import {
  STRAVA_MEMBER_OWNED_PROVIDER_SETUP_COORDINATES,
  STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
  type MemberOwnedProviderSetupRegistration,
} from "@/src/lib/device-sync/provider-setup/registry";
import {
  MemberOwnedProviderSetupService,
} from "@/src/lib/device-sync/provider-setup/service";
import { PrismaDeviceProviderSetupStore } from "@/src/lib/device-sync/provider-setup/store";
import type {
  MemberOwnedProviderSetupConnectionDisposition,
  MemberOwnedProviderSetupRecord,
} from "@/src/lib/device-sync/provider-setup/types";

const NOW = new Date("2026-08-11T12:00:00.000Z");
const MEMBER_ID = "member_synthetic";
const SETUP_ID = "dps_synthetic";
const RUN_ID = "hcr_provider_setup";
const APPLICATION_ID = "dpa_synthetic";
const CAPTURED_CREDENTIALS = Object.freeze({
  clientId: randomUUID(),
  clientSecret: randomUUID(),
});

const APPLICATION: DeviceProviderApplicationView = {
  applicationId: APPLICATION_ID,
  createdAt: NOW.toISOString(),
  provider: "strava",
  revision: 3,
  updatedAt: NOW.toISOString(),
};
const RESOLVED_APPLICATION: ResolvedDeviceProviderApplication = {
  applicationId: APPLICATION_ID,
  provider: "strava",
  providerConfigs: {
    strava: {
      clientId: CAPTURED_CREDENTIALS.clientId,
      clientSecret: CAPTURED_CREDENTIALS.clientSecret,
      scopes: ["activity:read"],
    },
  },
  revision: 3,
};
const CUSTOM_REGISTRATION: MemberOwnedProviderSetupRegistration<"strava"> = {
  browser: {
    applicationCategory: "Fixture category",
    applicationWebsite: "https://fixture.example.test",
    developerPortalUrl: "https://provider.example.test/developer/apps",
    guidance: [
      "Reason from the live provider UI.",
      "Use trusted capture for final submission and credential sealing.",
    ],
    safeLandingUrl: "https://provider.example.test/developer/apps",
  },
  coordinates: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_COORDINATES,
  presentation: {
    ...STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
    providerName: "Fixture provider",
  },
};

type TransitionInput = Parameters<PrismaDeviceProviderSetupStore["transition"]>[0];
type SaveApplicationInput = Parameters<typeof saveDeviceProviderApplication>[0];
type ServiceOptions = NonNullable<
  ConstructorParameters<typeof MemberOwnedProviderSetupService>[1]
>;
type ProviderSetupComputer = NonNullable<ServiceOptions["computer"]>;

class MemorySetupStore {
  disposition: MemberOwnedProviderSetupConnectionDisposition = { kind: "none" };
  setup: MemberOwnedProviderSetupRecord = buildSetup();
  readonly transitions: string[] = [];

  async ensureActive(): Promise<MemberOwnedProviderSetupRecord> {
    return this.setup;
  }

  async listMemberSetups(): Promise<MemberOwnedProviderSetupRecord[]> {
    return [this.setup];
  }

  async readActive(): Promise<MemberOwnedProviderSetupRecord | null> {
    return this.setup.active ? this.setup : null;
  }

  async readOwned(input: {
    memberId: string;
    provider: "strava";
    setupId: string;
  }): Promise<MemberOwnedProviderSetupRecord> {
    expect(input).toEqual({
      memberId: this.setup.memberId,
      provider: this.setup.provider,
      setupId: this.setup.id,
    });
    return this.setup;
  }

  async readConnectionDisposition(): Promise<MemberOwnedProviderSetupConnectionDisposition> {
    return this.disposition;
  }

  async transition(input: TransitionInput): Promise<MemberOwnedProviderSetupRecord> {
    if (
      input.expectedVersion !== this.setup.version
      || input.memberId !== this.setup.memberId
      || input.provider !== this.setup.provider
      || input.setupId !== this.setup.id
      || !this.setup.active
    ) {
      throw new Error("synthetic setup CAS conflict");
    }
    this.transitions.push(input.status);
    this.setup = {
      ...this.setup,
      ...(input.active === undefined ? {} : { active: input.active }),
      ...(input.browserRunId === undefined ? {} : { browserRunId: input.browserRunId }),
      ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
      ...(input.providerApplicationId === undefined
        ? {}
        : { providerApplicationId: input.providerApplicationId }),
      ...(input.providerApplicationRevision === undefined
        ? {}
        : { providerApplicationRevision: input.providerApplicationRevision }),
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
    if (
      input.applicationId !== this.setup.providerApplicationId
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
    return this.transition({
      completedAt: null,
      expectedVersion: this.setup.version,
      memberId: this.setup.memberId,
      provider: this.setup.provider,
      setupId: this.setup.id,
      status: this.setup.providerApplicationId ? "oauth_ready" : "pending",
    });
  }

  bindCapturedApplication(input: SaveApplicationInput): DeviceProviderApplicationView {
    const fence = input.setupCapture;
    if (
      !fence
      || this.setup.status !== "capturing"
      || this.setup.version !== fence.expectedSetupVersion
      || this.setup.id !== fence.setupId
      || this.setup.browserRunId !== fence.runId
    ) {
      throw new DeviceProviderApplicationError(
        "DEVICE_PROVIDER_APPLICATION_CONFLICT",
        "Synthetic capture lost its durable setup fence.",
      );
    }
    this.setup = {
      ...this.setup,
      providerApplicationId: APPLICATION_ID,
      providerApplicationRevision: 3,
      status: "oauth_ready",
      updatedAt: new Date(this.setup.updatedAt.getTime() + 1_000),
      version: this.setup.version + 1,
    };
    return APPLICATION;
  }

  deleteCapturedApplication(input: {
    applicationId: string;
    expectedRevision: number;
    expectedSetupVersion: number;
    memberId: string;
    provider: string;
    runId: string;
    setupId: string;
  }): void {
    if (
      this.setup.status !== "deletion_pending"
      || this.setup.version !== input.expectedSetupVersion
      || this.setup.memberId !== input.memberId
      || this.setup.provider !== input.provider
      || this.setup.id !== input.setupId
      || this.setup.browserRunId !== input.runId
      || this.setup.providerApplicationId !== input.applicationId
      || this.setup.providerApplicationRevision !== input.expectedRevision
    ) {
      throw new DeviceProviderApplicationError(
        "DEVICE_PROVIDER_APPLICATION_CONFLICT",
        "Synthetic deletion lost its durable setup fence.",
      );
    }
    this.setup = {
      ...this.setup,
      completedAt: NOW,
      providerApplicationId: null,
      providerApplicationRevision: null,
      status: "deleted",
      updatedAt: new Date(this.setup.updatedAt.getTime() + 1_000),
      version: this.setup.version + 1,
    };
  }
}

class FakeProviderComputer implements ProviderSetupComputer {
  readonly acquireOwnedRun = vi.fn(async (
    _input: Parameters<ProviderSetupComputer["acquireOwnedRun"]>[0],
  ) => ({
    awaitingReason: null,
    reused: false,
    runId: RUN_ID,
    status: "running",
  }));
  readonly finishOwnedRun = vi.fn(async (
    input: Parameters<ProviderSetupComputer["finishOwnedRun"]>[0],
  ) => ({
    ok: true as const,
    runId: input.runId,
    status: "completed",
  }));
  readonly actOwnedRun = vi.fn(async (
    _input: Parameters<ProviderSetupComputer["actOwnedRun"]>[0],
  ) => ({
    result: { kind: "deleted" },
    title: "Provider applications",
    url: CUSTOM_REGISTRATION.browser.safeLandingUrl,
  }));
  captureStarted: (() => void) | null = null;
  releaseCapture: Promise<void> | null = null;

  async captureAndSealProviderCredentialsInOwnedRun<T>(input: {
    code: string;
    consume: (credentials: {
      clientId: string;
      clientSecret: string;
    }) => Promise<T>;
    memberId: string;
    ownerKey: string;
    ownerPurpose: "member_owned_provider_setup";
    runId: string;
    timeoutMs: number;
  }): Promise<{ title: string; url: string; value: T }> {
    this.captureStarted?.();
    if (this.releaseCapture) {
      await this.releaseCapture;
    }
    return {
      title: "Provider applications",
      url: CUSTOM_REGISTRATION.browser.safeLandingUrl,
      value: await input.consume(CAPTURED_CREDENTIALS),
    };
  }
}

describe("member-owned provider setup service", () => {
  beforeEach(() => {
    vi.stubEnv("HOSTED_WEB_BASE_URL", "https://web.example.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses declarative metadata and reuses the exact authorized browser run", async () => {
    const store = new MemorySetupStore();
    const computer = new FakeProviderComputer();
    const service = createService({ computer, store });

    const authorized = await service.authorize(MEMBER_ID);
    expect(authorized.status).toBe("authorized");
    expect(computer.acquireOwnedRun).not.toHaveBeenCalled();

    const first = await service.beginBrowserSetup(MEMBER_ID);
    const second = await service.beginBrowserSetup(MEMBER_ID);

    expect(first.contract).toMatchObject({
      application: {
        category: "Fixture category",
        website: "https://fixture.example.test",
      },
      developerPortalUrl: CUSTOM_REGISTRATION.browser.developerPortalUrl,
      guidance: CUSTOM_REGISTRATION.browser.guidance,
      providerName: "Fixture provider",
      safeLandingUrl: CUSTOM_REGISTRATION.browser.safeLandingUrl,
    });
    expect(first.contract.application.callbackUrl).toBe(
      "https://web.example.test/api/device-sync/oauth/strava/callback",
    );
    expect(first.contract.application.marker).toMatch(/^Murph Private Sync [a-f0-9]{12}$/u);
    expect(second.run.runId).toBe(first.run.runId);
    expect(computer.acquireOwnedRun).toHaveBeenNthCalledWith(1, expect.objectContaining({
      expectedRunId: null,
      ownerKey: SETUP_ID,
      startUrl: CUSTOM_REGISTRATION.browser.developerPortalUrl,
    }));
    expect(computer.acquireOwnedRun).toHaveBeenNthCalledWith(2, expect.objectContaining({
      expectedRunId: RUN_ID,
      ownerKey: SETUP_ID,
    }));
    expect(store.setup).toMatchObject({ browserRunId: RUN_ID, status: "browser_setup" });
  });

  it("hands credentials directly to the sealed application owner without returning them", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({ browserRunId: RUN_ID, status: "browser_setup" });
    const computer = new FakeProviderComputer();
    const saveApplication = vi.fn(async (input: SaveApplicationInput) => {
      expect(input).toMatchObject({
        clientId: CAPTURED_CREDENTIALS.clientId,
        clientSecret: CAPTURED_CREDENTIALS.clientSecret,
        expectedRevision: null,
        memberId: MEMBER_ID,
        provider: "strava",
        setupCapture: {
          runId: RUN_ID,
          setupId: SETUP_ID,
        },
      });
      return store.bindCapturedApplication(input);
    });
    const service = createService({ computer, saveApplication, store });

    const result = await service.captureAndSeal(MEMBER_ID, captureRequest());

    expect(result).toMatchObject({
      applicationRevision: 3,
      setupId: SETUP_ID,
      status: "oauth_ready",
    });
    expect(JSON.stringify(result)).not.toContain(CAPTURED_CREDENTIALS.clientId);
    expect(JSON.stringify(result)).not.toContain(CAPTURED_CREDENTIALS.clientSecret);
    expect(store.setup).toMatchObject({
      browserRunId: null,
      providerApplicationId: APPLICATION_ID,
      providerApplicationRevision: 3,
      status: "oauth_ready",
    });
    expect(computer.finishOwnedRun).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "completed",
      runId: RUN_ID,
    }));
  });

  it("lets durable cancellation win against a late credential capture", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({ browserRunId: RUN_ID, status: "browser_setup" });
    const computer = new FakeProviderComputer();
    let releaseCapture: () => void = () => undefined;
    computer.releaseCapture = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    let captureStarted: () => void = () => undefined;
    const captureStartedPromise = new Promise<void>((resolve) => {
      captureStarted = resolve;
    });
    computer.captureStarted = captureStarted;
    const saveApplication = vi.fn(async (input: SaveApplicationInput) =>
      store.bindCapturedApplication(input));
    const service = createService({ computer, saveApplication, store });

    const capture = service.captureAndSeal(MEMBER_ID, captureRequest());
    await captureStartedPromise;
    const canceled = await service.cancel(MEMBER_ID, SETUP_ID);
    releaseCapture();

    await expect(capture).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_APPLICATION_CONFLICT",
    });
    expect(canceled.status).toBe("canceled");
    expect(store.setup).toMatchObject({
      browserRunId: null,
      providerApplicationId: null,
      providerApplicationRevision: null,
      status: "canceled",
    });
    expect(saveApplication).toHaveBeenCalledTimes(1);
  });

  it("verifies the ownership marker in the trusted browser operation before exact deletion", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      providerApplicationId: APPLICATION_ID,
      providerApplicationRevision: 3,
      status: "oauth_ready",
    });
    const computer = new FakeProviderComputer();
    const deleteApplication = vi.fn(async (input: Parameters<MemorySetupStore["deleteCapturedApplication"]>[0]) => {
      store.deleteCapturedApplication(input);
    });
    const service = createService({ computer, deleteApplication, store });

    const prepared = await service.prepareDeletion(MEMBER_ID);
    const result = await service.deleteOwnedApplication(MEMBER_ID, {
      action: "delete",
      applicationRootSelector: "form[data-owned-application]",
      completionSelector: "[data-delete-complete]",
      confirmSelector: "button.confirm-delete",
      deleteSelector: "button.delete-application",
      ownershipMarkerSelector: "input[name=application_name]",
      provider: "strava",
      runId: prepared.run.runId,
      setupId: prepared.setup.setupId,
    });

    const trustedCode = computer.actOwnedRun.mock.calls[0]?.[0].code ?? "";
    expect(trustedCode).toContain(prepared.contract.application.marker);
    expect(trustedCode).toContain("provider application ownership marker mismatch");
    expect(trustedCode).toContain("button.delete-application");
    expect(deleteApplication).toHaveBeenCalledWith(expect.objectContaining({
      applicationId: APPLICATION_ID,
      expectedRevision: 3,
      memberId: MEMBER_ID,
      provider: "strava",
      runId: RUN_ID,
      setupId: SETUP_ID,
    }));
    expect(result.status).toBe("deleted");
    expect(store.setup).toMatchObject({
      browserRunId: null,
      providerApplicationId: null,
      providerApplicationRevision: null,
      status: "deleted",
    });
  });

  it("starts OAuth only for the exact sealed application binding", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      providerApplicationId: APPLICATION_ID,
      providerApplicationRevision: 3,
      status: "oauth_ready",
    });
    const computer = new FakeProviderComputer();
    const startConnectionWithProviderApplication = vi.fn(async () => ({
      authorizationUrl: "https://provider.example.test/oauth/authorize",
      state: "state_1234567890abcdef",
    }));
    const resolveApplication = vi.fn(async () => RESOLVED_APPLICATION);
    const service = createService({
      computer,
      createIngress: () => ({ startConnectionWithProviderApplication }),
      resolveApplication,
      store,
    });

    const result = await service.startOAuth({
      memberId: MEMBER_ID,
      request: new Request("https://web.example.test/connect"),
      returnTo: "/connect?connected=strava",
      sessionId: "session_synthetic",
      setupId: SETUP_ID,
    });

    expect(resolveApplication).toHaveBeenCalledWith({
      applicationId: APPLICATION_ID,
      expectedRevision: 3,
      memberId: MEMBER_ID,
      provider: "strava",
    });
    expect(startConnectionWithProviderApplication).toHaveBeenCalledWith(
      MEMBER_ID,
      { applicationId: APPLICATION_ID, provider: "strava", revision: 3 },
      "/connect?connected=strava",
      {
        connectSourceId: "strava",
        connectTarget: "strava",
        sourceProviderSlug: null,
      },
    );
    expect(result.authorizationUrl).toBe("https://provider.example.test/oauth/authorize");
    expect(result.callbackProofCookie).toMatch(/^murph-device-sync-strava=/u);
    expect(result.setup.status).toBe("oauth_in_progress");
  });
});

function createService(input: {
  computer: FakeProviderComputer;
  createIngress?: ServiceOptions["createIngress"];
  deleteApplication?: ServiceOptions["deleteApplication"];
  resolveApplication?: ServiceOptions["resolveApplication"];
  saveApplication?: ServiceOptions["saveApplication"];
  store: MemorySetupStore;
}): MemberOwnedProviderSetupService {
  return new MemberOwnedProviderSetupService("strava", {
    computer: input.computer,
    createIngress: input.createIngress,
    deleteApplication: input.deleteApplication,
    now: () => NOW,
    readApplicationView: async () => null,
    registration: CUSTOM_REGISTRATION,
    resolveApplication: input.resolveApplication ?? (async () => RESOLVED_APPLICATION),
    saveApplication: input.saveApplication ?? (async (saveInput) =>
      input.store.bindCapturedApplication(saveInput)),
    store: input.store,
  });
}

function captureRequest() {
  return {
    action: "capture" as const,
    applicationRootSelector: "form[data-owned-application]",
    clientIdSelector: "[data-client-id]",
    clientSecretSelector: "[data-client-secret]",
    ownershipMarkerSelector: "input[name=application_name]",
    provider: "strava",
    revealSecretSelector: "button.reveal-secret",
    runId: RUN_ID,
    setupId: SETUP_ID,
    submitSelector: "button.create-application",
  };
}

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
    memberId: MEMBER_ID,
    provider: "strava",
    providerApplicationId: null,
    providerApplicationRevision: null,
    sourceProviderSlug: null,
    status: "pending",
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
}
