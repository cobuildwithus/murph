import type {
  HostedExecutionContainerNamespaceLike,
  HostedExecutionContainerStubLike,
} from "./runner-container.js";

export const HOSTED_STANDBY_REGION = "ENAM" as const;
export const HOSTED_STANDBY_LOCATION_HINT = "enam" as const;
export const HOSTED_STANDBY_CLAIM_TIMEOUT_MS = 250;
export const HOSTED_STANDBY_READY_TIMEOUT_MS = 75_000;
export const HOSTED_STANDBY_ORPHAN_GRACE_MS = 2 * 60_000;
export const HOSTED_STANDBY_RETRY_MS = 30_000;

export type HostedStandbyMode = "allocate" | "off" | "shadow";

export interface HostedStandbyClaimRequest {
  claimId: string;
  deadlineAtEpochMs: number;
  releaseId: string;
  region: typeof HOSTED_STANDBY_REGION;
}

export type HostedStandbyClaimResult =
  | {
      outcome: "claimed";
      slotName: string;
    }
  | {
      outcome: "deadline_expired" | "disabled" | "no_ready_slot" | "stale_release";
    };

export interface HostedStandbyCoordinatorState {
  provisioningSlotName: string | null;
  readySlotName: string | null;
  releaseId: string | null;
  region: typeof HOSTED_STANDBY_REGION;
}

export interface HostedStandbyCoordinatorStubLike {
  claimReadyStandby(input: HostedStandbyClaimRequest): Promise<HostedStandbyClaimResult>;
  ensureReadyStandby(input: {
    releaseId: string;
    region: typeof HOSTED_STANDBY_REGION;
  }): Promise<{ accepted: true }>;
  readStandbyCoordinatorState?(): Promise<HostedStandbyCoordinatorState>;
}

interface HostedStandbyNamespaceLocationOptions {
  locationHint?: typeof HOSTED_STANDBY_LOCATION_HINT;
}

export interface HostedStandbyCoordinatorNamespaceLike {
  getByName(
    name: string,
    options?: HostedStandbyNamespaceLocationOptions,
  ): HostedStandbyCoordinatorStubLike;
}

export interface HostedStandbyRunnerContainerStubLike
  extends HostedExecutionContainerStubLike {
  bindStandbySlot(input: {
    claimId: string;
    releaseId: string;
    region: typeof HOSTED_STANDBY_REGION;
    slotName: string;
    userId: string;
  }): Promise<{
    bound: true;
    claimId: string;
    releaseId: string;
    region: typeof HOSTED_STANDBY_REGION;
    slotName: string;
    userId: string;
  }>;
  prepareStandbySlot(input: {
    releaseId: string;
    region: typeof HOSTED_STANDBY_REGION;
    slotName: string;
    timeoutMs: number;
  }): Promise<{
    prepared: true;
    releaseId: string;
    region: typeof HOSTED_STANDBY_REGION;
    slotName: string;
  }>;
  readStandbySlotCoordinatorState(): Promise<HostedStandbySlotCoordinatorState>;
  readStandbySlotBinding(): Promise<HostedStandbySlotBinding>;
  /** Proves exact warm retention or settles the existing one-way retirement. */
  resolveRetainedStandbySlot(input: {
    currentReleaseId: string;
    region: typeof HOSTED_STANDBY_REGION;
    slotName: string;
    userId: string;
  }): Promise<HostedStandbySlotBinding>;
  retireStandbySlot(input: {
    claimId?: string;
  }): Promise<{ retired: true }>;
}

export interface HostedStandbySlotCoordinatorState {
  coordinatorOwned: boolean;
  releaseId: string;
  slotName: string;
  state: HostedStandbySlotBinding["state"];
}

export interface HostedStandbyRunnerContainerNamespaceLike {
  getByName(
    name: string,
    options?: HostedStandbyNamespaceLocationOptions,
  ): HostedStandbyRunnerContainerStubLike;
}

export type HostedStandbySlotBinding =
  | {
      claimId: null;
      releaseId: string;
      region: typeof HOSTED_STANDBY_REGION;
      slotName: string;
      state: "unbound";
      userId: null;
    }
  | {
      claimId: string;
      releaseId: string;
      region: typeof HOSTED_STANDBY_REGION;
      slotName: string;
      state: "bound";
      userId: string;
    }
  | {
      claimId: string | null;
      releaseId: string;
      region: typeof HOSTED_STANDBY_REGION;
      slotName: string;
      state: "retiring";
      userId: string | null;
    }
  | {
      claimId: null;
      releaseId: string;
      region: typeof HOSTED_STANDBY_REGION;
      slotName: string;
      state: "retired";
      userId: null;
    };

export function readHostedStandbyMode(
  source: Readonly<Record<string, unknown>>,
): HostedStandbyMode {
  const raw = source.HOSTED_EXECUTION_STANDBY_MODE;
  if (raw === undefined || raw === null || raw === "" || raw === "off") {
    return "off";
  }
  if (raw === "shadow" || raw === "allocate") {
    return raw;
  }
  throw new TypeError(
    "HOSTED_EXECUTION_STANDBY_MODE must be off, shadow, or allocate.",
  );
}

export function readHostedStandbyReleaseId(
  source: Readonly<Record<string, unknown>>,
): string | null {
  const releaseId = (source.CF_VERSION_METADATA as { id?: unknown } | undefined)?.id;
  return typeof releaseId === "string" && isHostedStandbyReleaseId(releaseId)
    ? releaseId
    : null;
}

export function resolveHostedStandbyCoordinatorName(input: {
  releaseId: string;
  region: typeof HOSTED_STANDBY_REGION;
}): string {
  return `standby-coordinator--v-${requireReleaseId(input.releaseId)}--r-${input.region.toLowerCase()}`;
}

export function createHostedStandbySlotName(releaseId: string): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("Hosted standby slot generation requires Web Crypto.");
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const randomId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `standby--v-${requireReleaseId(releaseId)}--${randomId}`;
}

export function createHostedStandbyClaimId(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("Hosted standby claim generation requires Web Crypto.");
  }
  return `standby-claim-${crypto.randomUUID()}`;
}

export function isHostedStandbyClaimId(value: unknown): value is string {
  return typeof value === "string"
    && /^standby-claim-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

export function isHostedStandbySlotName(value: unknown): boolean {
  return typeof value === "string"
    && /^standby--v-[A-Za-z0-9_-]{1,128}--[a-f0-9]{32}$/u.test(value);
}

export function readHostedStandbySlotReleaseId(value: string): string | null {
  const match = /^standby--v-([A-Za-z0-9_-]{1,128})--[a-f0-9]{32}$/u.exec(value);
  return match?.[1] ?? null;
}

export function createHostedRunnerContainerNamespaceRouter(input: {
  exactUser: HostedExecutionContainerNamespaceLike | null;
  standby: HostedStandbyRunnerContainerNamespaceLike | null;
}): HostedExecutionContainerNamespaceLike | null {
  if (!input.exactUser) {
    return null;
  }

  return {
    getByName(name: string) {
      if (isHostedStandbySlotName(name)) {
        if (!input.standby) {
          throw new Error("Hosted standby runner container binding is unavailable.");
        }
        return input.standby.getByName(name, {
          locationHint: HOSTED_STANDBY_LOCATION_HINT,
        });
      }
      return input.exactUser!.getByName(name);
    },
  };
}

function isHostedStandbyReleaseId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

function requireReleaseId(value: string): string {
  if (!isHostedStandbyReleaseId(value)) {
    throw new TypeError("Hosted standby release id is invalid.");
  }
  return value;
}
