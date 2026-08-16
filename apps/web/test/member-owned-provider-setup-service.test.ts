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
const CREDENTIALS_URL = "https://provider.example.test/settings/api";
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
      "Use ordinary computer-use browsing to create the private application.",
      "Confirm the registered credential elements are present without reading their values, then use trusted capture.",
    ],
    trustedAuthority: {
      clientIdSelector: "[data-client-id]",
      clientSecretSelector: "[data-client-secret]",
      credentialsPageUrl: CREDENTIALS_URL,
      revealSecretSelector: "button.reveal-secret",
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

  async beginDeletion(
    expected: MemberOwnedProviderSetupRecord,
  ): Promise<{
    kind: "connection_conflict" | "ready";
    setup: MemberOwnedProviderSetupRecord;
  }> {
    expect(expected).toEqual(this.setup);
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
      ...(input.browserRunId === undefined ? {} : { browserRunId: input.browserRunId }),
      ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
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
      || this.setup.status !== "browser_setup"
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
    status: "completed" as Awaited<
      ReturnType<ProviderSetupComputer["finishOwnedRun"]>
    >["status"],
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
      url: CREDENTIALS_URL,
    };
  });
  captureErrorOnce: Error | null = null;
  captureStarted: (() => void) | null = null;
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
    if (this.captureErrorOnce) {
      const error = this.captureErrorOnce;
      this.captureErrorOnce = null;
      throw error;
    }
    return {
      title: "Provider applications",
      url: CREDENTIALS_URL,
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
      credentialsPageUrl: CREDENTIALS_URL,
      developerPortalUrl: CUSTOM_REGISTRATION.browser.developerPortalUrl,
      guidance: CUSTOM_REGISTRATION.browser.guidance,
      providerName: "Fixture provider",
    });
    expect(first.contract.application.callbackUrl).toBe(
      "https://web.example.test/api/device-sync/oauth/strava/callback",
    );
    expect(first.contract.application).not.toHaveProperty("name");
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

  it("accepts only the exact authorized continuation or its browser progression", async () => {
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

  it("keeps browser cleanup reconciliation out of presentation reads", async () => {
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
          expectedSetupVersion: store.setup.version,
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
    expect(computer.captureCodes).toHaveLength(1);
    expect(computer.captureCodes[0]).toContain(CREDENTIALS_URL);
    expect(computer.captureCodes[0]).toContain("[data-client-id]");
    expect(computer.captureCodes[0]).toContain("[data-client-secret]");
    expect(computer.captureCodes[0]).toContain("button.reveal-secret");
    expect(computer.captureCodes[0]).not.toContain("data-application-name");
    expect(computer.captureCodes[0]).not.toContain("create-application");
    expect(computer.finishOwnedRun).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "completed",
      runId: RUN_ID,
    }));
  });

  it("keeps capture read-only and retryable after an ambiguous browser failure", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      browserRunId: RUN_ID,
      status: "browser_setup",
      version: 3,
    });
    const computer = new FakeProviderComputer();
    computer.captureErrorOnce = new Error("synthetic capture interruption");
    const service = createService({ computer, store });

    await expect(service.captureAndSeal(MEMBER_ID, captureRequest())).rejects.toThrow(
      "synthetic capture interruption",
    );
    expect(store.setup).toMatchObject({
      browserRunId: RUN_ID,
      providerApplicationId: null,
      status: "browser_setup",
      version: 3,
    });

    await expect(service.captureAndSeal(MEMBER_ID, captureRequest())).resolves.toMatchObject({
      applicationRevision: 3,
      status: "oauth_ready",
    });
    expect(computer.captureCodes).toHaveLength(2);
    expect(computer.captureCodes[0]).toBe(computer.captureCodes[1]);
  });

  it("lets cancellation win a concurrent capture through the existing setup version", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      browserRunId: RUN_ID,
      status: "browser_setup",
      version: 3,
    });
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
    const service = createService({ computer, store });

    const capture = service.captureAndSeal(MEMBER_ID, captureRequest());
    const captureFailure = expect(capture).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_APPLICATION_CONFLICT",
    });
    await captureStartedPromise;
    await expect(service.cancel(MEMBER_ID, SETUP_ID)).resolves.toMatchObject({
      status: "canceled",
    });
    releaseCapture();

    await captureFailure;
    expect(store.setup).toMatchObject({
      browserRunId: null,
      providerApplicationId: null,
      providerApplicationRevision: null,
      status: "canceled",
    });
  });

  it("uses the sealed client ID as exact trusted browser deletion authority", async () => {
    const store = new MemorySetupStore();
    store.setup = buildSetup({
      providerApplicationId: APPLICATION_ID,
      providerApplicationRevision: 3,
      status: "oauth_ready",
    });
    const computer = new FakeProviderComputer();
    const deleteApplication = vi.fn(async (
      input: Parameters<MemorySetupStore["deleteCapturedApplication"]>[0],
    ) => {
      store.deleteCapturedApplication(input);
    });
    const service = createService({ computer, deleteApplication, store });

    const prepared = await service.prepareDeletion(MEMBER_ID);
    const result = await service.deleteOwnedApplication(MEMBER_ID, {
      action: "delete",
      confirmSelector: "button.confirm-delete",
      deleteSelector: "button.delete-application",
      provider: "strava",
      runId: prepared.run.runId,
      setupId: prepared.setup.setupId,
    });

    const trustedCode = computer.actOwnedRun.mock.calls[0]?.[0].code ?? "";
    expect(trustedCode).toContain(CAPTURED_CREDENTIALS.clientId);
    expect(trustedCode).not.toContain(CAPTURED_CREDENTIALS.clientSecret);
    expect(trustedCode).toContain(
      "provider application client ID does not match deletion authority",
    );
    expect(trustedCode).toContain(CREDENTIALS_URL);
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
        url: CREDENTIALS_URL,
      });
    const deleteApplication = vi.fn(async (
      input: Parameters<MemorySetupStore["deleteCapturedApplication"]>[0],
    ) => {
      store.deleteCapturedApplication(input);
    });
    const service = createService({ computer, deleteApplication, store });
    const prepared = await service.prepareDeletion(MEMBER_ID);
    const request = {
      action: "delete" as const,
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
    provider: "strava",
    runId: RUN_ID,
    setupId: SETUP_ID,
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
