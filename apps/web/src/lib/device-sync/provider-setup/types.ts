import type {
  DeviceProviderApplicationBinding,
  MemberOwnedDeviceProviderApplicationProvider,
} from "../provider-applications";

export const MEMBER_OWNED_PROVIDER_SETUP_STATUSES = [
  "pending",
  "authorized",
  "browser_setup",
  "capturing",
  "canceling",
  "oauth_ready",
  "oauth_in_progress",
  "connected",
  "disconnect_first",
  "deletion_pending",
  "canceled",
  "deleted",
] as const;

export type MemberOwnedProviderSetupStatus =
  (typeof MEMBER_OWNED_PROVIDER_SETUP_STATUSES)[number];

export interface MemberOwnedProviderSetupRecord<
  TProvider extends string = MemberOwnedDeviceProviderApplicationProvider,
> {
  active: boolean;
  browserRunId: string | null;
  completedAt: Date | null;
  connectSourceId: string;
  connectTarget: string;
  createdAt: Date;
  id: string;
  memberId: string;
  provider: TProvider;
  providerApplicationId: string | null;
  providerApplicationRevision: number | null;
  sourceProviderSlug: string | null;
  status: MemberOwnedProviderSetupStatus;
  updatedAt: Date;
  version: number;
}

export type MemberOwnedProviderSetupAction =
  | "authorize"
  | "continue_handoff"
  | "continue_oauth"
  | "disconnect_first"
  | "none";

type MemberOwnedProviderSetupInteractiveAction = Exclude<
  MemberOwnedProviderSetupAction,
  "none"
>;

export interface MemberOwnedProviderSetupPresentation<
  TProvider extends string = MemberOwnedDeviceProviderApplicationProvider,
> {
  actionLabels: Readonly<Record<MemberOwnedProviderSetupInteractiveAction, string>>;
  cancelSetupLabel: string;
  developerAccessDisclosure: string;
  messages: Readonly<Record<MemberOwnedProviderSetupStatus, string>>;
  provider: TProvider;
  providerName: string;
  readOnlyAccessLabel: string;
}

export interface MemberOwnedProviderSetupView<
  TProvider extends string = MemberOwnedDeviceProviderApplicationProvider,
> {
  action: MemberOwnedProviderSetupAction;
  applicationRevision: number | null;
  connected: boolean;
  message: string;
  provider: TProvider;
  setupId: string;
  status: MemberOwnedProviderSetupStatus;
  updatedAt: string;
}

export interface MemberOwnedProviderSetupProjection<
  TProvider extends string = MemberOwnedDeviceProviderApplicationProvider,
> {
  presentation: MemberOwnedProviderSetupPresentation<TProvider>;
  setup: MemberOwnedProviderSetupView<TProvider> | null;
}

export type MemberOwnedProviderSetupProjectionMap = Partial<
  Record<
    MemberOwnedDeviceProviderApplicationProvider,
    MemberOwnedProviderSetupProjection
  >
>;

export interface MemberOwnedProviderSetupOAuthResult {
  authorizationUrl: string;
  callbackProofCookie: string;
  setup: MemberOwnedProviderSetupView;
}

export type MemberOwnedProviderSetupConnectionDisposition<
  TProvider extends string = MemberOwnedDeviceProviderApplicationProvider,
> =
  | { kind: "none" }
  | {
      binding: DeviceProviderApplicationBinding<TProvider>;
      connectionId: string;
      kind: "exact";
      status: "active" | "reauthorization_required";
    }
  | { connectionId: string; kind: "conflict" };

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

export function readMemberOwnedProviderSetupBinding<TProvider extends string>(
  setup: Pick<
    MemberOwnedProviderSetupRecord<TProvider>,
    "provider" | "providerApplicationId" | "providerApplicationRevision"
  >,
): DeviceProviderApplicationBinding<TProvider> | null {
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

export function toMemberOwnedProviderSetupView<TProvider extends string>(
  setup: MemberOwnedProviderSetupRecord<TProvider>,
  presentation: MemberOwnedProviderSetupPresentation<TProvider>,
  options: { handoffAvailable?: boolean } = {},
): MemberOwnedProviderSetupView<TProvider> {
  if (setup.provider !== presentation.provider) {
    throw new TypeError(
      "Member-owned provider setup presentation does not match its provider.",
    );
  }

  return {
    action: options.handoffAvailable && (
      setup.status === "authorized"
      || setup.status === "browser_setup"
      || setup.status === "capturing"
    )
      ? "continue_handoff"
      : resolveSetupAction(setup.status),
    applicationRevision: setup.providerApplicationRevision,
    connected: setup.status === "connected",
    message: presentation.messages[setup.status],
    provider: setup.provider,
    setupId: setup.id,
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
      return "authorize";
    case "oauth_ready":
    case "oauth_in_progress":
      return "continue_oauth";
    case "disconnect_first":
      return "disconnect_first";
    case "authorized":
    case "browser_setup":
    case "capturing":
    case "canceling":
    case "connected":
    case "deletion_pending":
    case "deleted":
      return "none";
  }
}
