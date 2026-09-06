import type {
  HostedExecutionContainerNamespaceLike,
  HostedExecutionContainerStubLike,
} from "./runner-container.js";

export const HOSTED_RUNNER_REGION = "GLOBAL" as const;
// Only persisted legacy standby identities use a geographic region.
export const HOSTED_STANDBY_REGION = "ENAM" as const;
export type HostedRunnerRegion = typeof HOSTED_RUNNER_REGION | typeof HOSTED_STANDBY_REGION;
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
  region: HostedRunnerRegion;
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
  provisioningSlotNames: string[];
  readySlotNames: string[];
  releaseId: string | null;
  region: HostedRunnerRegion;
}

export interface HostedStandbyCoordinatorStubLike {
  claimReadyStandby(input: HostedStandbyClaimRequest): Promise<HostedStandbyClaimResult>;
  ensureReadyStandby(input: {
    releaseId: string;
    region: HostedRunnerRegion;
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

export interface HostedRunnerSlotLifecycle {
  bindStandbySlot(input: {
    claimId: string;
    releaseId: string;
    region: HostedRunnerRegion;
    slotName: string;
    userId: string;
  }): Promise<{
    bound: true;
    claimId: string;
    releaseId: string;
    region: HostedRunnerRegion;
    slotName: string;
    userId: string;
  }>;
  prepareStandbySlot(input: {
    releaseId: string;
    region: HostedRunnerRegion;
    slotName: string;
    timeoutMs: number;
  }): Promise<{
    prepared: true;
    releaseId: string;
    region: HostedRunnerRegion;
    slotName: string;
  }>;
  readStandbySlotCoordinatorState(): Promise<HostedStandbySlotCoordinatorState>;
  readStandbySlotBinding(): Promise<HostedStandbySlotBinding>;
  /** Proves exact warm retention or settles the existing one-way retirement. */
  resolveRetainedStandbySlot(input: {
    currentReleaseId: string;
    region: HostedRunnerRegion;
    slotName: string;
    userId: string;
  }): Promise<HostedStandbySlotBinding>;
  retireStandbySlot(input: {
    claimId?: string;
    /** Exact member stop, including a reserved target whose bind never arrived. */
    target?: { slotName: string; userId: string };
  }): Promise<{ retired: true }>;
}

export type HostedStandbyRunnerContainerStubLike =
  HostedExecutionContainerStubLike & HostedRunnerSlotLifecycle;

/** Keep calls on the original RPC receiver; never cast a namespace to another class. */
export function hasHostedRunnerSlotLifecycle(
  container: HostedExecutionContainerStubLike,
): container is HostedStandbyRunnerContainerStubLike {
  return typeof container.bindStandbySlot === "function"
    && typeof container.prepareStandbySlot === "function"
    && typeof container.readStandbySlotBinding === "function"
    && typeof container.readStandbySlotCoordinatorState === "function"
    && typeof container.resolveRetainedStandbySlot === "function"
    && typeof container.retireStandbySlot === "function";
}

export function requireHostedRunnerSlotLifecycle(
  container: HostedExecutionContainerStubLike,
): HostedRunnerSlotLifecycle {
  if (!hasHostedRunnerSlotLifecycle(container)) {
    throw new Error("Hosted runner slot lifecycle RPC is unavailable.");
  }
  return container;
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
      region: HostedRunnerRegion;
      slotName: string;
      state: "unbound";
      userId: null;
    }
  | {
      claimId: string;
      releaseId: string;
      region: HostedRunnerRegion;
      slotName: string;
      state: "bound";
      userId: string;
    }
  | {
      claimId: string | null;
      releaseId: string;
      region: HostedRunnerRegion;
      slotName: string;
      state: "retiring";
      userId: string | null;
    }
  | {
      claimId: null;
      releaseId: string;
      region: HostedRunnerRegion;
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

export function readHostedStandbyTarget(
  source: Readonly<Record<string, unknown>>,
): number {
  const raw = source.HOSTED_EXECUTION_STANDBY_TARGET;
  if (raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
    return 2;
  }
  const value = typeof raw === "string" && /^\d+$/u.test(raw.trim())
    ? Number(raw.trim())
    : raw;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 32) {
    throw new TypeError("HOSTED_EXECUTION_STANDBY_TARGET must be an integer from 0 to 32.");
  }
  return value;
}

export function readHostedStandbyReleaseId(
  source: Readonly<Record<string, unknown>>,
): string | null {
  const metadata = source.CF_VERSION_METADATA;
  const releaseId = typeof metadata === "object" && metadata !== null && "id" in metadata
    ? metadata.id : undefined;
  return typeof releaseId === "string" && isHostedStandbyReleaseId(releaseId)
    ? releaseId
    : null;
}

/**
 * Unversioned local runtimes still allocate one-time-bound opaque slots. A bad
 * deployed version is an error, not permission to reuse a member-derived name.
 */
export function resolveHostedRunnerReleaseId(
  source: Readonly<Record<string, unknown>>,
): string {
  if (source.CF_VERSION_METADATA === undefined || source.CF_VERSION_METADATA === null) {
    return "local";
  }
  const releaseId = readHostedStandbyReleaseId(source);
  if (!releaseId) {
    throw new TypeError("Hosted runner release metadata is invalid.");
  }
  return releaseId;
}

export function resolveHostedStandbyCoordinatorName(input: {
  releaseId: string;
  region: HostedRunnerRegion;
}): string {
  if (input.region !== HOSTED_RUNNER_REGION && input.region !== HOSTED_STANDBY_REGION) {
    throw new TypeError("Hosted runner coordinator region is invalid.");
  }
  return `standby-coordinator--v-${requireReleaseId(input.releaseId)}--r-${input.region.toLowerCase()}`;
}

export function createHostedRunnerSlotName(releaseId: string): string {
  return createHostedSlotName("runner", releaseId);
}

export function createHostedStandbySlotName(releaseId: string): string {
  return createHostedSlotName("standby", releaseId);
}

function createHostedSlotName(prefix: "runner" | "standby", releaseId: string): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("Hosted standby slot generation requires Web Crypto.");
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const randomId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}--v-${requireReleaseId(releaseId)}--${randomId}`;
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

export function isHostedRunnerSlotName(value: unknown): boolean {
  return typeof value === "string"
    && /^runner--v-[A-Za-z0-9_-]{1,128}--[a-f0-9]{32}$/u.test(value);
}

export function readHostedRunnerSlotReleaseId(value: string): string | null {
  const match = /^runner--v-([A-Za-z0-9_-]{1,128})--[a-f0-9]{32}$/u.exec(value);
  return match?.[1] ?? null;
}

/** Both generations are opaque ownership targets, but never interchangeable namespaces. */
export function isHostedRunnerTargetName(value: unknown): boolean {
  return isHostedRunnerSlotName(value) || isHostedStandbySlotName(value);
}

export function readHostedRunnerTargetIdentity(slotName: string): {
  releaseId: string;
  region: HostedRunnerRegion;
} | null {
  const releaseId = readHostedRunnerSlotReleaseId(slotName);
  if (releaseId !== null) {
    return { releaseId, region: HOSTED_RUNNER_REGION };
  }
  const legacyReleaseId = readHostedStandbySlotReleaseId(slotName);
  return legacyReleaseId === null
    ? null
    : { releaseId: legacyReleaseId, region: HOSTED_STANDBY_REGION };
}

export function hostedRunnerSlotBindingMatchesTarget(
  binding: unknown,
  slotName: string,
): binding is HostedStandbySlotBinding {
  const identity = readHostedRunnerTargetIdentity(slotName);
  if (identity === null || !isRunnerBindingRecord(binding)) return false;
  const hasOwner = isHostedStandbyClaimId(binding.claimId)
    && typeof binding.userId === "string"
    && binding.userId.length > 0 && binding.userId.length <= 256
    && binding.userId.trim() === binding.userId;
  const noOwner = binding.claimId === null && binding.userId === null;
  const validState = binding.state === "bound" ? hasOwner
    : binding.state === "retiring" ? hasOwner || noOwner
    : (binding.state === "unbound" || binding.state === "retired") && noOwner;
  return validState
    && binding.slotName === slotName
    && binding.releaseId === identity.releaseId
    && binding.region === identity.region;
}

function isRunnerBindingRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createHostedRunnerContainerNamespaceRouter(input: {
  exactUser: HostedExecutionContainerNamespaceLike | null;
  standby: HostedStandbyRunnerContainerNamespaceLike | null;
}): HostedExecutionContainerNamespaceLike | null {
  const runner = input.exactUser;
  if (!runner) {
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
      return runner.getByName(name);
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
