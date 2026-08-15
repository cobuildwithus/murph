import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sha256Hex } from "@/src/lib/computer-use/ids";
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
    trustedAuthority: {
      applicationContainerSelector: "form[data-owned-application]",
      creationFormSelector: "form[data-owned-application]",
    },
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
    if (!this.setup.active) {
      this.setup = buildSetup({
        createdAt: new Date(this.setup.createdAt.getTime() + 1_000),
        id: `${SETUP_ID}_next`,
        updatedAt: new Date(this.setup.updatedAt.getTime() + 1_000),
      });
    }
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

  async beginDeletion(): Promise<{
    kind: "connection_conflict" | "ready";
    setup: MemberOwnedProviderSetupRecord;
  }> {
    if (this.disposition.kind !== "none") {
      return {
        kind: "connection_conflict",
        setup: await this.transition({
          expectedVersion: this.setup.version,
          memberId: this.setup.memberId,
          provider: this.setup.provider,
          setupId: this.setup.id,
          status: "disconnect_first",
        }),
      };
    }
    return {
      kind: "ready",
      setup: this.setup.status === "deletion_pending"
        ? this.setup
        : await this.transition({
            expectedVersion: this.setup.version,
            memberId: this.setup.memberId,
            provider: this.setup.provider,
            setupId: this.setup.id,
            status: "deletion_pending",
          }),
    };
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
      ...(input.applicationName === undefined
        ? {}
        : { applicationName: input.applicationName }),
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
    input: Parameters<ProviderSetupComputer["acquireOwnedRun"]>[0],
  ) => {
    if (input.expectedRunId !== RUN_ID) {
      await input.admitRun(RUN_ID);
    }
    return {
      awaitingReason: null,
      reused: false,
      runId: RUN_ID,
      status: "running",
    };
  });
  readonly finishOwnedRun = vi.fn(async (
    input: Parameters<ProviderSetupComputer["finishOwnedRun"]>[0],
  ) => ({
    ok: true as const,
    runId: input.runId,
    status: "completed",
  }));
  readonly hasOwnedRunHandoff = vi.fn(async () => false);
  readonly issueOwnedRunHandoff = vi.fn(async () => "/computer/handoff/synthetic");
  readonly reconcileOwnedBrowserProvisioningRun = vi.fn(async (
    input: Parameters<ProviderSetupComputer["reconcileOwnedBrowserProvisioningRun"]>[0],
  ): Promise<"bound" | "cleanup_pending" | "settled"> => {
    void input;
    return "bound";
  });
  readonly actOwnedRun = vi.fn(async (
    input: Parameters<ProviderSetupComputer["actOwnedRun"]>[0],
  ) => {
    void input;
    return {
      result: { kind: "deleted" },
      title: "Provider applications",
      url: CUSTOM_REGISTRATION.browser.safeLandingUrl,
    };
  });
  captureStarted: (() => void) | null = null;
  ambiguousCaptureErrorOnce: Error | null = null;
  missingApplicationCaptureOnce = false;
  releaseCapture: Promise<void> | null = null;

  readonly captureCodes: string[] = [];

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
    this.captureCodes.push(input.code);
    this.captureStarted?.();
    if (this.releaseCapture) {
      await this.releaseCapture;
    }
    if (this.ambiguousCaptureErrorOnce) {
      const error = this.ambiguousCaptureErrorOnce;
      this.ambiguousCaptureErrorOnce = null;
      throw error;
    }
    if (this.missingApplicationCaptureOnce) {
      this.missingApplicationCaptureOnce = false;
      throw Object.assign(new Error("trusted recovery proved no application"), {
        code: "HOSTED_COMPUTER_PROVIDER_CREDENTIAL_CAPTURE_NO_APPLICATION",
      });
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
        name: "Cobalt Trail 482731",
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
    expect(first.contract.application).not.toHaveProperty("marker");
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

  it("persists one exact continuation for duplicate Continue actions", async () => {
    const store = new MemorySetupStore();
    const computer = new FakeProviderComputer();
    const requestContinuation = vi.fn(async () => undefined);
    const service = createService({ computer, requestContinuation, store });

    await expect(service.authorizeAndContinue(MEMBER_ID)).resolves.toMatchObject({
      status: "authorized",
    });
    await expect(service.authorizeAndContinue(MEMBER_ID)).resolves.toMatchObject({
      status: "authorized",
    });

    expect(requestContinuation).toHaveBeenCalledTimes(2);
    expect(requestContinuation).toHaveBeenNthCalledWith(1, {
      handoffId: null,
      memberId: MEMBER_ID,
      provider: "strava",
      runId: null,
      setupId: SETUP_ID,
      setupVersion: 2,
    });
    expect(requestContinuation).toHaveBeenNthCalledWith(2, {
      handoffId: null,
      memberId: MEMBER_ID,
      provider: "strava",
      runId: null,
      setupId: SETUP_ID,
      setupVersion: 2,
    });
  });

  it("accepts only the exact authorized continuation or its own browser progression", async () => {
    const store = new MemorySetupStore();
    const computer = new FakeProviderComputer();
    const service = createService({ computer, store });

    await service.authorize(MEMBER_ID);
    const authorizedVersion = store.setup.version;

    await expect(service.validateContinuation({
      expectedSetupId: SETUP_ID,
      expectedSetupVersion: authorizedVersion,
      memberId: MEMBER_ID,
    })).resolves.toBe(true);
    await expect(service.validateContinuation({
      expectedSetupId: SETUP_ID,
      expectedSetupVersion: authorizedVersion + 1,
      memberId: MEMBER_ID,
    })).resolves.toBe(false);

    await service.beginBrowserSetup(MEMBER_ID);
    await expect(service.validateContinuation({
      expectedSetupId: SETUP_ID,
      expectedSetupVersion: authorizedVersion,
      memberId: MEMBER_ID,
    })).resolves.toBe(true);

    store.setup = {
      ...store.setup,
      status: "capturing",
      version: store.setup.version + 1,
    };
    await expect(service.validateContinuation({
      expectedSetupId: SETUP_ID,
      expectedSetupVersion: authorizedVersion,
      memberId: MEMBER_ID,
    })).resolves.toBe(true);

    store.setup = {
      ...store.setup,
      status: "canceled",
      version: store.setup.version + 1,
    };
    await expect(service.validateContinuation({
      expectedSetupId: SETUP_ID,
      expectedSetupVersion: authorizedVersion,
      memberId: MEMBER_ID,
    })).resolves.toBe(false);

    store.setup = {
      ...store.setup,
      browserRunId: null,
      status: "authorized",
      version: store.setup.version + 1,
    };
    await expect(service.validateContinuation({
      expectedSetupId: SETUP_ID,
      expectedSetupVersion: authorizedVersion,
      memberId: MEMBER_ID,
    })).resolves.toBe(false);
  });

  it("preserves the capturing fence during consent withdrawal", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      browserRunId: RUN_ID,
      status: "capturing",
      version: 4,
    });
    const computer = new FakeProviderComputer();
    const service = createService({ computer, store });

    await expect(service.reconcileConsentWithdrawal(MEMBER_ID)).resolves.toMatchObject({
      setupId: SETUP_ID,
      status: "capturing",
    });

    expect(store.setup).toMatchObject({
      browserRunId: RUN_ID,
      status: "capturing",
      version: 4,
    });
    expect(store.transitions).toEqual([]);
  });

  it("cancels an unbound browser setup during consent withdrawal", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      browserRunId: RUN_ID,
      status: "browser_setup",
      version: 3,
    });
    const computer = new FakeProviderComputer();
    const service = createService({ computer, store });

    await expect(service.reconcileConsentWithdrawal(MEMBER_ID)).resolves.toMatchObject({
      status: "canceled",
    });

    expect(computer.finishOwnedRun).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "canceled",
      runId: RUN_ID,
    }));
    expect(store.transitions).toEqual(["canceling", "canceled"]);
  });

  it("preserves canceling while consent withdrawal cleanup remains pending", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      browserRunId: RUN_ID,
      status: "canceling",
      version: 4,
    });
    const computer = new FakeProviderComputer();
    computer.finishOwnedRun.mockResolvedValueOnce({
      ok: true,
      runId: RUN_ID,
      status: "cleanup_pending",
    });
    const service = createService({ computer, store });

    await expect(service.reconcileConsentWithdrawal(MEMBER_ID)).resolves.toMatchObject({
      status: "canceling",
    });

    expect(store.setup).toMatchObject({
      browserRunId: RUN_ID,
      status: "canceling",
      version: 4,
    });
    expect(store.transitions).toEqual([]);
  });

  it("keeps browser recovery out of presentation reads", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      browserRunId: RUN_ID,
      status: "browser_setup",
      version: 4,
    });
    const computer = new FakeProviderComputer();
    computer.reconcileOwnedBrowserProvisioningRun.mockResolvedValue("settled");
    const requestContinuation = vi.fn(async () => undefined);
    const service = createService({ computer, requestContinuation, store });

    await expect(service.read(MEMBER_ID)).resolves.toMatchObject({
      status: "browser_setup",
    });

    expect(store.setup.browserRunId).toBe(RUN_ID);
    expect(store.setup.version).toBe(4);
    expect(computer.reconcileOwnedBrowserProvisioningRun).not.toHaveBeenCalled();
    expect(requestContinuation).not.toHaveBeenCalled();
  });

  it("keeps setup retryable when continuation admission is refused before authorization", async () => {
    const store = new MemorySetupStore();
    const computer = new FakeProviderComputer();
    const requestContinuation = vi.fn(async () => undefined);
    const admissionError = new Error("synthetic admission refusal");
    const service = createService({
      assertContinuationAllowed: vi.fn(async () => {
        throw admissionError;
      }),
      computer,
      requestContinuation,
      store,
    });

    await expect(service.authorizeAndContinue(MEMBER_ID)).rejects.toBe(
      admissionError,
    );
    expect(store.setup).toMatchObject({
      status: "pending",
      version: 1,
    });
    expect(requestContinuation).not.toHaveBeenCalled();
  });

  it("restores the retryable state when durable continuation append is refused", async () => {
    const store = new MemorySetupStore();
    const computer = new FakeProviderComputer();
    const appendError = new Error("synthetic mailbox append refusal");
    const service = createService({
      computer,
      requestContinuation: vi.fn(async () => {
        throw appendError;
      }),
      store,
    });

    await expect(service.authorizeAndContinue(MEMBER_ID)).rejects.toBe(
      appendError,
    );
    expect(store.setup).toMatchObject({ status: "pending" });
    expect(store.transitions).toEqual(["authorized", "pending"]);
  });

  it("projects and reissues only the exact setup-owned handoff", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({ browserRunId: RUN_ID, status: "browser_setup" });
    const computer = new FakeProviderComputer();
    computer.hasOwnedRunHandoff.mockResolvedValue(true);
    const service = createService({ computer, store });

    await expect(service.read(MEMBER_ID)).resolves.toMatchObject({
      action: "continue_handoff",
      setupId: SETUP_ID,
      status: "browser_setup",
    });
    await expect(service.issueHandoff(MEMBER_ID, SETUP_ID)).resolves.toBe(
      "/computer/handoff/synthetic",
    );
    expect(computer.hasOwnedRunHandoff).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      ownerKey: SETUP_ID,
      ownerPurpose: "member_owned_provider_setup",
      runId: RUN_ID,
    });
    expect(computer.issueOwnedRunHandoff).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      ownerKey: SETUP_ID,
      ownerPurpose: "member_owned_provider_setup",
      runId: RUN_ID,
    });

  });

  it("hands credentials directly to the sealed application owner without returning them", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      applicationName: null,
      browserRunId: RUN_ID,
      status: "browser_setup",
    });
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
      applicationName: "Cobalt Trail 482731",
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

  it("requires one friendly name and freezes it before trusted submission", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      applicationName: null,
      browserRunId: RUN_ID,
      status: "browser_setup",
    });
    const computer = new FakeProviderComputer();
    const capture = vi.spyOn(
      computer,
      "captureAndSealProviderCredentialsInOwnedRun",
    );
    const service = createService({ computer, store });

    await expect(service.captureAndSeal(MEMBER_ID, {
      ...captureRequest(),
      applicationName: null,
    })).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_SETUP_APPLICATION_NAME_REQUIRED",
    });
    expect(capture).not.toHaveBeenCalled();

    store.setup = buildSetup({
      applicationName: "Cobalt Trail 482731",
      browserRunId: RUN_ID,
      status: "browser_setup",
    });
    await expect(service.captureAndSeal(MEMBER_ID, {
      ...captureRequest(),
      applicationName: "Amber Summit 913579",
    })).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_SETUP_APPLICATION_NAME_CONFLICT",
    });
    expect(store.setup.applicationName).toBe("Cobalt Trail 482731");
    expect(capture).not.toHaveBeenCalled();
  });

  it("keeps the irreversible capture fence after submission and rejects Cancel", async () => {
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
    await expect(service.cancel(MEMBER_ID, SETUP_ID)).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_SETUP_STATE_CONFLICT",
    });
    releaseCapture();

    await expect(capture).resolves.toMatchObject({ status: "oauth_ready" });
    expect(store.setup).toMatchObject({
      browserRunId: null,
      providerApplicationId: APPLICATION_ID,
      providerApplicationRevision: 3,
      status: "oauth_ready",
    });
    expect(saveApplication).toHaveBeenCalledTimes(1);
  });

  it("recovers an ambiguous submitted capture without clicking submit twice", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({ browserRunId: RUN_ID, status: "browser_setup", version: 3 });
    const computer = new FakeProviderComputer();
    computer.ambiguousCaptureErrorOnce = new Error("browser result was ambiguous");
    const service = createService({ computer, store });

    await expect(service.captureAndSeal(MEMBER_ID, captureRequest())).rejects.toThrow(
      "browser result was ambiguous",
    );
    expect(store.setup).toMatchObject({
      browserRunId: RUN_ID,
      status: "capturing",
      version: 4,
    });
    expect(computer.captureCodes[0]).toContain("button.create-application");
    await expect(service.cancel(MEMBER_ID, SETUP_ID)).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_SETUP_STATE_CONFLICT",
    });

    const result = await service.captureAndSeal(MEMBER_ID, captureRequest());

    expect(result.status).toBe("oauth_ready");
    const code = computer.captureCodes[1] ?? "";
    expect(code).not.toContain("button.create-application");
    expect(code).toContain("provider application ownership marker mismatch");
  });

  it("rebinds an exact successor run while keeping capture recovery submit-free", async () => {
    const successorRunId = "hcr_provider_setup_successor";
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      browserRunId: RUN_ID,
      status: "capturing",
      version: 4,
    });
    const computer = new FakeProviderComputer();
    computer.acquireOwnedRun.mockImplementationOnce(async (input) => {
      await input.admitRun(successorRunId);
      return {
        awaitingReason: null,
        reused: false,
        runId: successorRunId,
        status: "running",
      };
    });
    computer.missingApplicationCaptureOnce = true;
    const service = createService({ computer, store });

    const resumed = await service.beginBrowserSetup(MEMBER_ID);

    expect(resumed.run.runId).toBe(successorRunId);
    expect(resumed.setup).toMatchObject({
      setupId: SETUP_ID,
      status: "capturing",
    });
    expect(store.setup).toMatchObject({
      browserRunId: successorRunId,
      status: "capturing",
      version: 5,
    });

    await expect(service.captureAndSeal(MEMBER_ID, {
      ...captureRequest(),
      runId: successorRunId,
    })).resolves.toMatchObject({ status: "browser_setup" });
    expect(computer.captureCodes).toHaveLength(1);
    expect(computer.captureCodes[0]).not.toContain("button.create-application");
    expect(store.setup).toMatchObject({
      browserRunId: successorRunId,
      status: "browser_setup",
      version: 6,
    });
  });

  it("requires an independent exact-name absence proof before another submit", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({ browserRunId: RUN_ID, status: "browser_setup", version: 3 });
    const computer = new FakeProviderComputer();
    computer.ambiguousCaptureErrorOnce = new Error("browser result was ambiguous");
    const service = createService({ computer, store });

    await expect(service.captureAndSeal(MEMBER_ID, captureRequest())).rejects.toThrow(
      "browser result was ambiguous",
    );
    expect(store.setup).toMatchObject({ status: "capturing", version: 4 });

    computer.missingApplicationCaptureOnce = true;
    await expect(service.captureAndSeal(MEMBER_ID, captureRequest())).resolves.toMatchObject({
      status: "browser_setup",
    });
    expect(store.setup).toMatchObject({ status: "browser_setup", version: 5 });
    expect(computer.captureCodes[1]).not.toContain("button.create-application");

    await expect(service.captureAndSeal(MEMBER_ID, captureRequest())).resolves.toMatchObject({
      status: "oauth_ready",
    });
    expect(computer.captureCodes[2]).toContain("button.create-application");
  });

  it("restores browser setup after a trusted failure proven before submit", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({ browserRunId: RUN_ID, status: "browser_setup", version: 3 });
    const computer = new FakeProviderComputer();
    computer.ambiguousCaptureErrorOnce = Object.assign(
      new Error("trusted pre-submit selector failure"),
      {
        code: "HOSTED_COMPUTER_PROVIDER_CREDENTIAL_CAPTURE_PRE_SUBMIT_FAILED",
      },
    );
    const service = createService({ computer, store });

    await expect(service.captureAndSeal(MEMBER_ID, captureRequest())).rejects.toThrow(
      "trusted pre-submit selector failure",
    );
    expect(store.setup).toMatchObject({
      applicationName: null,
      browserRunId: RUN_ID,
      status: "browser_setup",
      version: 5,
    });
    await expect(service.cancel(MEMBER_ID, SETUP_ID)).resolves.toMatchObject({
      status: "canceled",
    });
  });

  it("uses the sealed client ID as trusted browser authority before exact deletion", async () => {
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
      clientIdSelector: "[data-client-id]",
      confirmSelector: "button.confirm-delete",
      deleteSelector: "button.delete-application",
      provider: "strava",
      runId: prepared.run.runId,
      setupId: prepared.setup.setupId,
    });

    const trustedCode = computer.actOwnedRun.mock.calls[0]?.[0].code ?? "";
    expect(trustedCode).toContain(sha256Hex(CAPTURED_CREDENTIALS.clientId));
    expect(trustedCode).not.toContain(CAPTURED_CREDENTIALS.clientId);
    expect(trustedCode).toContain("provider application stable authority mismatch");
    expect(trustedCode).toContain("[data-client-id]");
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
      active: false,
      browserRunId: null,
      providerApplicationId: null,
      providerApplicationRevision: null,
      status: "deleted",
    });
    await expect(service.ensure(MEMBER_ID)).resolves.toMatchObject({
      active: true,
      id: `${SETUP_ID}_next`,
      status: "pending",
    });
  });

  it("keeps the deleted setup active until terminal run release can finish", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      providerApplicationId: APPLICATION_ID,
      providerApplicationRevision: 3,
      status: "oauth_ready",
    });
    const computer = new FakeProviderComputer();
    computer.finishOwnedRun.mockRejectedValueOnce(
      new Error("synthetic terminal run release interruption"),
    );
    const deleteApplication = vi.fn(async (
      input: Parameters<MemorySetupStore["deleteCapturedApplication"]>[0],
    ) => {
      store.deleteCapturedApplication(input);
    });
    const service = createService({ computer, deleteApplication, store });
    const prepared = await service.prepareDeletion(MEMBER_ID);

    await expect(service.deleteOwnedApplication(MEMBER_ID, {
      action: "delete",
      clientIdSelector: "[data-client-id]",
      confirmSelector: "button.confirm-delete",
      deleteSelector: "button.delete-application",
      provider: "strava",
      runId: prepared.run.runId,
      setupId: prepared.setup.setupId,
    })).rejects.toThrow("synthetic terminal run release interruption");
    expect(store.setup).toMatchObject({
      active: true,
      browserRunId: RUN_ID,
      status: "deleted",
    });

    await expect(service.ensure(MEMBER_ID)).resolves.toMatchObject({
      active: true,
      id: `${SETUP_ID}_next`,
      status: "pending",
    });
    expect(computer.finishOwnedRun).toHaveBeenCalledTimes(2);
    expect(deleteApplication).toHaveBeenCalledTimes(1);
  });

  it("converges deletion after the provider succeeded but its result was lost", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      providerApplicationId: APPLICATION_ID,
      providerApplicationRevision: 3,
      status: "oauth_ready",
    });
    const computer = new FakeProviderComputer();
    computer.actOwnedRun
      .mockRejectedValueOnce(new Error("synthetic post-delete transport loss"))
      .mockResolvedValueOnce({
        result: { kind: "already_deleted" },
        title: "Provider applications",
        url: CUSTOM_REGISTRATION.browser.safeLandingUrl,
      });
    const deleteApplication = vi.fn(async (input: Parameters<MemorySetupStore["deleteCapturedApplication"]>[0]) => {
      store.deleteCapturedApplication(input);
    });
    const service = createService({ computer, deleteApplication, store });
    const prepared = await service.prepareDeletion(MEMBER_ID);
    const request = {
      action: "delete" as const,
      clientIdSelector: "[data-client-id]",
      confirmSelector: "button.confirm-delete",
      deleteSelector: "button.delete-application",
      provider: "strava" as const,
      runId: prepared.run.runId,
      setupId: prepared.setup.setupId,
    };

    await expect(service.deleteOwnedApplication(MEMBER_ID, request)).rejects.toThrow(
      "synthetic post-delete transport loss",
    );
    await expect(service.deleteOwnedApplication(MEMBER_ID, request)).resolves.toMatchObject({
      status: "deleted",
    });
    expect(computer.actOwnedRun).toHaveBeenCalledTimes(2);
    expect(deleteApplication).toHaveBeenCalledTimes(1);
  });

  it("revalidates live connection truth immediately before trusted deletion", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      browserRunId: RUN_ID,
      providerApplicationId: APPLICATION_ID,
      providerApplicationRevision: 3,
      status: "deletion_pending",
      version: 4,
    });
    store.disposition = {
      binding: { applicationId: APPLICATION_ID, provider: "strava", revision: 3 },
      connectionId: "dsc_callback_won",
      kind: "exact",
      status: "active",
    };
    const computer = new FakeProviderComputer();
    const service = createService({ computer, store });

    await expect(service.deleteOwnedApplication(MEMBER_ID, {
      action: "delete",
      clientIdSelector: "[data-client-id]",
      confirmSelector: "button.confirm-delete",
      deleteSelector: "button.delete-application",
      provider: "strava",
      runId: RUN_ID,
      setupId: SETUP_ID,
    })).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_SETUP_DISCONNECT_FIRST",
    });
    expect(computer.actOwnedRun).not.toHaveBeenCalled();
    expect(store.setup.status).toBe("disconnect_first");
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

  it("does not let a stale OAuth action cross the deletion fence", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      browserRunId: RUN_ID,
      providerApplicationId: APPLICATION_ID,
      providerApplicationRevision: 3,
      status: "deletion_pending",
      version: 4,
    });
    const startConnectionWithProviderApplication = vi.fn();
    const service = createService({
      computer: new FakeProviderComputer(),
      createIngress: () => ({ startConnectionWithProviderApplication }),
      store,
    });

    await expect(service.startOAuth({
      memberId: MEMBER_ID,
      request: new Request("https://web.example.test/connect"),
      returnTo: "/connect?connected=strava",
      sessionId: "session_synthetic",
      setupId: SETUP_ID,
    })).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_SETUP_STATE_CONFLICT",
    });
    expect(startConnectionWithProviderApplication).not.toHaveBeenCalled();
    expect(store.setup).toMatchObject({ status: "deletion_pending", version: 4 });
  });
});

function createService(input: {
  assertContinuationAllowed?: ServiceOptions["assertContinuationAllowed"];
  computer: FakeProviderComputer;
  createIngress?: ServiceOptions["createIngress"];
  deleteApplication?: ServiceOptions["deleteApplication"];
  resolveApplication?: ServiceOptions["resolveApplication"];
  requestContinuation?: ServiceOptions["requestContinuation"];
  saveApplication?: ServiceOptions["saveApplication"];
  store: MemorySetupStore;
}): MemberOwnedProviderSetupService {
  return new MemberOwnedProviderSetupService("strava", {
    assertContinuationAllowed: input.assertContinuationAllowed
      ?? (async () => undefined),
    computer: input.computer,
    createApplicationNameSuffix: () => "482731",
    createIngress: input.createIngress,
    deleteApplication: input.deleteApplication,
    now: () => NOW,
    registration: CUSTOM_REGISTRATION,
    requestContinuation: input.requestContinuation,
    resolveApplication: input.resolveApplication ?? (async () => RESOLVED_APPLICATION),
    saveApplication: input.saveApplication ?? (async (saveInput) =>
      input.store.bindCapturedApplication(saveInput)),
    store: input.store,
  });
}

function captureRequest() {
  return {
    action: "capture" as const,
    applicationName: "Cobalt Trail",
    applicationNameSelector: "[data-application-name]",
    clientIdSelector: "[data-client-id]",
    clientSecretSelector: "[data-client-secret]",
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
    applicationName: "Cobalt Trail 482731",
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
