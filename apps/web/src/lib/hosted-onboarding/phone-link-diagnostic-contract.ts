export const HOSTED_PHONE_LINK_DIAGNOSTIC_EVENTS = [
  "surface_loaded",
  "surface_blocked",
  "provider_started",
  "provider_succeeded",
  "provider_transfer_required",
  "provider_failed",
  "provider_cancelled",
  "provider_callback_ignored",
  "sync_started",
  "sync_succeeded",
  "sync_unchanged",
  "sync_failed",
] as const;
export const HOSTED_PHONE_LINK_DIAGNOSTIC_CLIENT_STATES = [
  "loading",
  "eligible",
  "privy_unauthenticated",
  "server_session_mismatch",
  "expected_user_missing",
  "client_user_missing",
  "provider_user_mismatch",
] as const;
export const HOSTED_PHONE_LINK_DIAGNOSTIC_DETAIL_CODES = [
  "account_transfer_required",
  "exited_link_flow",
  "exited_update_flow",
  "linked_to_another_user",
  "non_sms_callback",
  "other",
] as const;
export const HOSTED_PHONE_LINK_DIAGNOSTIC_OPERATIONS = ["link", "update"] as const;
export const HOSTED_PHONE_LINK_DIAGNOSTIC_SURFACES = ["join_invite", "settings"] as const;

export type HostedPhoneLinkDiagnosticClientState =
  (typeof HOSTED_PHONE_LINK_DIAGNOSTIC_CLIENT_STATES)[number];
export type HostedPhoneLinkDiagnosticDetailCode =
  (typeof HOSTED_PHONE_LINK_DIAGNOSTIC_DETAIL_CODES)[number];
export type HostedPhoneLinkDiagnosticEvent =
  (typeof HOSTED_PHONE_LINK_DIAGNOSTIC_EVENTS)[number];
export type HostedPhoneLinkDiagnosticOperation =
  (typeof HOSTED_PHONE_LINK_DIAGNOSTIC_OPERATIONS)[number];
export type HostedPhoneLinkDiagnosticSurface =
  (typeof HOSTED_PHONE_LINK_DIAGNOSTIC_SURFACES)[number];

export interface HostedPhoneLinkDiagnosticPayload {
  attemptId: string;
  clientState: HostedPhoneLinkDiagnosticClientState;
  detailCode?: HostedPhoneLinkDiagnosticDetailCode;
  event: HostedPhoneLinkDiagnosticEvent;
  operation: HostedPhoneLinkDiagnosticOperation;
  surface: HostedPhoneLinkDiagnosticSurface;
}

const DIAGNOSTIC_KEYS = new Set([
  "attemptId",
  "clientState",
  "detailCode",
  "event",
  "operation",
  "surface",
]);
const ATTEMPT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function parseHostedPhoneLinkDiagnosticPayload(
  value: Record<string, unknown>,
): HostedPhoneLinkDiagnosticPayload | null {
  if (
    Object.keys(value).some((key) => !DIAGNOSTIC_KEYS.has(key))
    || typeof value.attemptId !== "string"
    || !ATTEMPT_ID_PATTERN.test(value.attemptId)
    || !isAllowedString(value.clientState, HOSTED_PHONE_LINK_DIAGNOSTIC_CLIENT_STATES)
    || !isOptionalAllowedString(value.detailCode, HOSTED_PHONE_LINK_DIAGNOSTIC_DETAIL_CODES)
    || !isAllowedString(value.event, HOSTED_PHONE_LINK_DIAGNOSTIC_EVENTS)
    || !isAllowedString(value.operation, HOSTED_PHONE_LINK_DIAGNOSTIC_OPERATIONS)
    || !isAllowedString(value.surface, HOSTED_PHONE_LINK_DIAGNOSTIC_SURFACES)
  ) {
    return null;
  }

  return {
    attemptId: value.attemptId,
    clientState: value.clientState,
    ...(value.detailCode ? { detailCode: value.detailCode } : {}),
    event: value.event,
    operation: value.operation,
    surface: value.surface,
  };
}

function isAllowedString<const TValues extends readonly string[]>(
  value: unknown,
  allowed: TValues,
): value is TValues[number] {
  return typeof value === "string" && allowed.some((candidate) => candidate === value);
}

function isOptionalAllowedString<const TValues extends readonly string[]>(
  value: unknown,
  allowed: TValues,
): value is TValues[number] | undefined {
  return value === undefined || isAllowedString(value, allowed);
}
