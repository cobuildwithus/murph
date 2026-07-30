import { normalizePhoneNumber } from "./phone";
import type { HostedLinqAssignableHomeLine } from "./linq-line-store";

export const HOSTED_LINQ_PLANNING_LOAD_TARGET_MESSAGES = 5_000;
export const HOSTED_LINQ_SIGNUP_WELCOME_HARD_CAP_PER_UTC_DAY = 50;

export type HostedLinqActiveRouteDecision =
  | {
      kind: "bind_home";
    }
  | {
      kind: "ignore_unattested_direct";
    }
  | {
      kind: "ignore_unknown_home";
    }
  | {
      homeRecipientPhone: string;
      kind: "redirect_to_home";
    };

export function chooseHostedLinqHomeLine(input: {
  ignoreDailyNewConversationLimit?: boolean;
  lines: readonly HostedLinqAssignableHomeLine[];
  newAssignmentsByRecipientPhone: ReadonlyMap<string, number>;
  plannedMessagesByRecipientPhone: ReadonlyMap<string, number>;
  preferredRecipientPhone: string | null;
  recentMessageEffectsByLineLookupKey: ReadonlyMap<string, number>;
}): HostedLinqAssignableHomeLine | null {
  const preferredRecipientPhone = normalizePhoneNumber(input.preferredRecipientPhone);
  const dailyCandidates = input.lines.filter((line) =>
    isHostedLinqHomeLineUnderDailyLimit({
      ignoreDailyNewConversationLimit: input.ignoreDailyNewConversationLimit ?? false,
      line,
      newAssignmentsByRecipientPhone: input.newAssignmentsByRecipientPhone,
    }),
  );
  const candidatesUnderPlanningTarget = dailyCandidates.filter((line) =>
    (input.plannedMessagesByRecipientPhone.get(line.phoneNumber) ?? 0)
      < HOSTED_LINQ_PLANNING_LOAD_TARGET_MESSAGES
  );
  const candidates = candidatesUnderPlanningTarget.length > 0
    ? candidatesUnderPlanningTarget
    : dailyCandidates;

  // Preserve a contacted/sticky line only while it remains below the soft
  // assignment target. Once every eligible line is at or above target, the
  // contract is least-loaded fallback rather than preferred-line override.
  if (candidatesUnderPlanningTarget.length > 0 && preferredRecipientPhone) {
    const preferred = candidates.find((line) => line.phoneNumber === preferredRecipientPhone);
    if (preferred) {
      return preferred;
    }
  }

  const allCandidatesAtOrAbovePlanningTarget =
    candidatesUnderPlanningTarget.length === 0;

  return [...candidates].sort((left, right) => {
    const leftPlanned =
      input.plannedMessagesByRecipientPhone.get(left.phoneNumber) ?? 0;
    const rightPlanned =
      input.plannedMessagesByRecipientPhone.get(right.phoneNumber) ?? 0;

    // When every line is already above the advisory target, preserve the
    // weighted-planning contract by falling back to the least-planned line.
    if (
      allCandidatesAtOrAbovePlanningTarget
      && leftPlanned !== rightPlanned
    ) {
      return leftPlanned - rightPlanned;
    }

    const leftRecent =
      input.recentMessageEffectsByLineLookupKey.get(left.phoneNumberLookupKey) ?? 0;
    const rightRecent =
      input.recentMessageEffectsByLineLookupKey.get(right.phoneNumberLookupKey) ?? 0;
    if (leftRecent !== rightRecent) {
      return leftRecent - rightRecent;
    }

    if (!allCandidatesAtOrAbovePlanningTarget && leftPlanned !== rightPlanned) {
      return leftPlanned - rightPlanned;
    }

    const leftDaily = input.newAssignmentsByRecipientPhone.get(left.phoneNumber) ?? 0;
    const rightDaily = input.newAssignmentsByRecipientPhone.get(right.phoneNumber) ?? 0;
    if (leftDaily !== rightDaily) {
      return leftDaily - rightDaily;
    }

    if (left.assignmentWeight !== right.assignmentWeight) {
      return right.assignmentWeight - left.assignmentWeight;
    }

    return left.phoneNumberLookupKey.localeCompare(right.phoneNumberLookupKey);
  })[0] ?? null;
}

export function chooseHostedLinqSignupWelcomeLine(input: {
  lines: readonly HostedLinqAssignableHomeLine[];
  newAssignmentsByRecipientPhone: ReadonlyMap<string, number>;
  plannedMessagesByRecipientPhone: ReadonlyMap<string, number>;
  preferredRecipientPhone: string | null;
  recentMessageEffectsByLineLookupKey: ReadonlyMap<string, number>;
}): HostedLinqAssignableHomeLine | null {
  const selected = chooseHostedLinqHomeLine({
    ...input,
    lines: input.lines.map((line) => ({
      ...line,
      maxNewConversationsPerDay: resolveHostedLinqSignupWelcomeDailyLimit(line),
    })),
  });

  return selected
    ? input.lines.find((line) => line.phoneNumberLookupKey === selected.phoneNumberLookupKey) ?? null
    : null;
}

export function resolveHostedLinqSignupWelcomeDailyLimit(
  line: Pick<HostedLinqAssignableHomeLine, "maxNewConversationsPerDay">,
): number {
  return Math.min(
    HOSTED_LINQ_SIGNUP_WELCOME_HARD_CAP_PER_UTC_DAY,
    Math.max(
      0,
      line.maxNewConversationsPerDay
        ?? HOSTED_LINQ_SIGNUP_WELCOME_HARD_CAP_PER_UTC_DAY,
    ),
  );
}

export function resolveHostedLinqHomeBindingRecipientPhone(input: {
  homeChatId: string | null;
  homeRecipientPhone: string | null;
  incomingChatId: string;
  incomingRecipientPhone: string | null;
}): string | null {
  const incomingRecipientPhone = normalizePhoneNumber(input.incomingRecipientPhone);
  const homeRecipientPhone = normalizePhoneNumber(input.homeRecipientPhone);

  if (input.homeChatId && input.homeChatId === input.incomingChatId) {
    return homeRecipientPhone;
  }

  return incomingRecipientPhone ?? homeRecipientPhone;
}

export function resolveHostedLinqActiveRouteDecision(input: {
  homeChatId: string | null;
  homeRecipientPhone: string | null;
  incomingChatId: string;
  incomingDirectAttested: boolean;
  incomingRecipientPhone: string | null;
}): HostedLinqActiveRouteDecision {
  const incomingRecipientPhone = normalizePhoneNumber(input.incomingRecipientPhone);
  const homeRecipientPhone = normalizePhoneNumber(input.homeRecipientPhone);

  if (input.homeChatId && input.homeChatId === input.incomingChatId) {
    return {
      kind: "bind_home",
    };
  }

  if (input.homeChatId && input.homeChatId !== input.incomingChatId && !incomingRecipientPhone) {
    return {
      kind: "ignore_unknown_home",
    };
  }

  if (
    homeRecipientPhone
    && incomingRecipientPhone
    && homeRecipientPhone !== incomingRecipientPhone
  ) {
    return {
      homeRecipientPhone,
      kind: "redirect_to_home",
    };
  }

  if (input.homeChatId && !homeRecipientPhone && input.homeChatId !== input.incomingChatId) {
    return {
      kind: "ignore_unknown_home",
    };
  }

  // REBINDING a home chat to a different chat id requires the webhook payload to
  // explicitly attest the chat is direct (is_group === false). Without that attestation a
  // group message whose is_group flag went missing could silently rebind a member's home
  // 1:1 thread to the group — and route their private replies into it. Known chat ids are
  // unaffected (first branch above), and FIRST binds stay permissive: Linq 1:1 payloads
  // are not confirmed to always carry the flag, and failing closed there would break
  // signup. Rebind is the only transition where the failure is an irreversible privacy
  // leak instead of a visible, recoverable onboarding hiccup.
  if (input.homeChatId && !input.incomingDirectAttested) {
    return {
      kind: "ignore_unattested_direct",
    };
  }

  return {
    kind: "bind_home",
  };
}

function isHostedLinqHomeLineUnderDailyLimit(input: {
  ignoreDailyNewConversationLimit: boolean;
  line: HostedLinqAssignableHomeLine;
  newAssignmentsByRecipientPhone: ReadonlyMap<string, number>;
}): boolean {
  return !(
    !input.ignoreDailyNewConversationLimit
    && input.line.maxNewConversationsPerDay !== null
    && (input.newAssignmentsByRecipientPhone.get(input.line.phoneNumber) ?? 0)
      >= input.line.maxNewConversationsPerDay
  );
}
