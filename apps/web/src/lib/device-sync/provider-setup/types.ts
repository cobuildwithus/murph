import type {
  DeviceProviderApplicationBinding,
  MemberOwnedDeviceProviderApplicationProvider,
} from "../provider-applications";

export const MEMBER_OWNED_PROVIDER_SETUP_STATUSES = [
  "pending",
  "working",
  "inspection_required",
  "waiting_for_user",
  "provider_prerequisite",
  "repair_required",
  "retryable_failure",
  "oauth_ready",
  "oauth_in_progress",
  "connected",
  "disconnect_first",
  "provider_conflict",
  "deletion_pending",
  "canceled",
  "deleted",
] as const;

export type MemberOwnedProviderSetupStatus =
  (typeof MEMBER_OWNED_PROVIDER_SETUP_STATUSES)[number];

export const MEMBER_OWNED_PROVIDER_SETUP_ERROR_CODES = [
  "PROVIDER_SETUP_AMBIGUOUS_SUBMISSION",
  "PROVIDER_SETUP_DASHBOARD_UNAVAILABLE",
  "PROVIDER_SETUP_INSPECTION_REQUIRED",
  "PROVIDER_SETUP_PROVIDER_CONFLICT",
  "PROVIDER_SETUP_PROVIDER_PREREQUISITE",
  "PROVIDER_SETUP_REPAIR_REQUIRED",
] as const;

export type MemberOwnedProviderSetupErrorCode =
  (typeof MEMBER_OWNED_PROVIDER_SETUP_ERROR_CODES)[number];

export interface MemberOwnedProviderSetupRecord {
  active: boolean;
  browserRunId: string | null;
  completedAt: Date | null;
  connectSourceId: string;
  connectTarget: string;
  createdAt: Date;
  id: string;
  lastErrorCode: string | null;
  memberId: string;
  provider: MemberOwnedDeviceProviderApplicationProvider;
  providerApplicationId: string | null;
  providerApplicationRevision: number | null;
  providerSubmissionAt: Date | null;
  sourceProviderSlug: string | null;
  status: MemberOwnedProviderSetupStatus;
  updatedAt: Date;
  version: number;
}

export type MemberOwnedProviderSetupAction =
  | "start"
  | "continue_sign_in"
  | "continue_provider"
  | "retry"
  | "continue_oauth"
  | "disconnect_first"
  | "none";

type MemberOwnedProviderSetupInteractiveAction = Exclude<
  MemberOwnedProviderSetupAction,
  "none"
>;

export interface MemberOwnedProviderSetupPresentation {
  actionLabels: Readonly<Record<MemberOwnedProviderSetupInteractiveAction, string>>;
  messages: Readonly<Record<MemberOwnedProviderSetupStatus, string>>;
  provider: MemberOwnedDeviceProviderApplicationProvider;
  providerName: string;
  readOnlyAccessLabel: string;
}

export interface MemberOwnedProviderSetupView {
  action: MemberOwnedProviderSetupAction;
  applicationRevision: number | null;
  connected: boolean;
  message: string;
  provider: MemberOwnedDeviceProviderApplicationProvider;
  status: MemberOwnedProviderSetupStatus;
  updatedAt: string;
}

export interface MemberOwnedProviderSetupProjection {
  presentation: MemberOwnedProviderSetupPresentation;
  setup: MemberOwnedProviderSetupView | null;
}

export type MemberOwnedProviderSetupProjectionMap = Partial<
  Record<
    MemberOwnedDeviceProviderApplicationProvider,
    MemberOwnedProviderSetupProjection
  >
>;

export interface MemberOwnedProviderSetupAdvanceResult {
  handoffUrl?: string;
  setup: MemberOwnedProviderSetupView;
}

export interface MemberOwnedProviderSetupOAuthResult {
  authorizationUrl: string;
  callbackProofCookie: string;
  setup: MemberOwnedProviderSetupView;
}

export type MemberOwnedProviderSetupConnectionDisposition =
  | { kind: "none" }
  | {
      binding: DeviceProviderApplicationBinding;
      connectionId: string;
      kind: "exact";
    }
  | { connectionId: string; kind: "conflict" };

export type MemberOwnedProviderDashboardInspection =
  | { kind: "authentication_required"; reason: "challenge" | "signed_out" }
  | { kind: "prerequisite_required"; reason: "subscription_required" }
  | { kind: "ambiguous" }
  | { kind: "missing" }
  | { kind: "owned_application" }
  | { kind: "unrelated_application" };

export type MemberOwnedProviderApplicationCreateResult =
  | { kind: "submitted" }
  | { kind: "ambiguous" }
  | { kind: "known_unsent"; reason: "prerequisite" | "unavailable" };

export interface MemberOwnedProviderApplicationCaptureResult {
  applicationId: string;
  revision: number;
}

export type MemberOwnedProviderApplicationDeleteResult =
  | { kind: "deleted" }
  | { kind: "missing" }
  | { kind: "unrelated_application" }
  | { kind: "ambiguous" }
  | { kind: "authentication_required"; reason: "challenge" | "signed_out" };

export function isMemberOwnedProviderSetupStatus(
  value: string,
): value is MemberOwnedProviderSetupStatus {
  return (MEMBER_OWNED_PROVIDER_SETUP_STATUSES as readonly string[])
    .includes(value);
}

export function requireMemberOwnedProviderSetupStatus(
  value: string,
): MemberOwnedProviderSetupStatus {
  if (isMemberOwnedProviderSetupStatus(value)) {
    return value;
  }
  throw new TypeError("Member-owned provider setup status is invalid.");
}

export function readMemberOwnedProviderSetupBinding(
  setup: Pick<
    MemberOwnedProviderSetupRecord,
    "provider" | "providerApplicationId" | "providerApplicationRevision"
  >,
): DeviceProviderApplicationBinding | null {
  if (
    setup.providerApplicationId === null
    && setup.providerApplicationRevision === null
  ) {
    return null;
  }
  const revision = setup.providerApplicationRevision;
  if (
    !setup.providerApplicationId
    || typeof revision !== "number"
    || !Number.isSafeInteger(revision)
    || revision <= 0
  ) {
    throw new TypeError(
      "Member-owned provider setup application binding is incomplete.",
    );
  }
  return {
    applicationId: setup.providerApplicationId,
    provider: setup.provider,
    revision,
  };
}

export function toMemberOwnedProviderSetupView(
  setup: MemberOwnedProviderSetupRecord,
  presentation: MemberOwnedProviderSetupPresentation,
): MemberOwnedProviderSetupView {
  if (setup.provider !== presentation.provider) {
    throw new TypeError(
      "Member-owned provider setup presentation does not match its provider.",
    );
  }

  return {
    action: resolveSetupAction(setup.status),
    applicationRevision: setup.providerApplicationRevision,
    connected: setup.status === "connected",
    message: presentation.messages[setup.status],
    provider: setup.provider,
    status: setup.status,
    updatedAt: setup.updatedAt.toISOString(),
  };
}

function resolveSetupAction(
  status: MemberOwnedProviderSetupStatus,
): MemberOwnedProviderSetupAction {
  switch (status) {
    case "pending":
    case "canceled":
      return "start";
    case "waiting_for_user":
      return "continue_sign_in";
    case "provider_prerequisite":
      return "continue_provider";
    case "inspection_required":
    case "repair_required":
    case "retryable_failure":
      return "retry";
    case "oauth_ready":
    case "oauth_in_progress":
      return "continue_oauth";
    case "disconnect_first":
      return "disconnect_first";
    case "working":
    case "connected":
    case "provider_conflict":
    case "deletion_pending":
    case "deleted":
      return "none";
  }
}
