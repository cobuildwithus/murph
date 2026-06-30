import { normalizePhoneNumber } from "./phone";
import type { HostedLinqAssignableHomeLine } from "./linq-line-store";

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

export function normalizeHostedLinqConversationRecipientPhones(
  values: readonly string[],
): string[] {
  return values
    .map((value) => normalizePhoneNumber(value))
    .filter((value, index, array): value is string => {
      return value !== null && array.indexOf(value) === index;
    });
}

export function chooseHostedLinqConversationRecipientPhone(input: {
  activeMembersByRecipientPhone: ReadonlyMap<string, number>;
  maxActiveMembersPerPhoneNumber: number | null;
  preferredRecipientPhone: string | null;
  recipientPhones: readonly string[];
}): string | null {
  const preferredRecipientPhone = normalizePhoneNumber(input.preferredRecipientPhone);
  const recipientPhones = normalizeHostedLinqConversationRecipientPhones(input.recipientPhones);

  if (recipientPhones.length === 0) {
    return preferredRecipientPhone;
  }

  if (
    preferredRecipientPhone
    && recipientPhones.includes(preferredRecipientPhone)
    && !isHostedLinqConversationRecipientPhoneAtCapacity({
      activeMembersByRecipientPhone: input.activeMembersByRecipientPhone,
      maxActiveMembersPerPhoneNumber: input.maxActiveMembersPerPhoneNumber,
      recipientPhone: preferredRecipientPhone,
    })
  ) {
    return preferredRecipientPhone;
  }

  const underCapacityRecipientPhone = recipientPhones.find((recipientPhone) => {
    return !isHostedLinqConversationRecipientPhoneAtCapacity({
      activeMembersByRecipientPhone: input.activeMembersByRecipientPhone,
      maxActiveMembersPerPhoneNumber: input.maxActiveMembersPerPhoneNumber,
      recipientPhone,
    });
  });

  if (underCapacityRecipientPhone) {
    return underCapacityRecipientPhone;
  }

  if (preferredRecipientPhone && recipientPhones.includes(preferredRecipientPhone)) {
    return preferredRecipientPhone;
  }

  return recipientPhones[0] ?? preferredRecipientPhone;
}

export function chooseHostedLinqHomeLine(input: {
  activeMembersByRecipientPhone: ReadonlyMap<string, number>;
  lines: readonly HostedLinqAssignableHomeLine[];
  newAssignmentsByRecipientPhone: ReadonlyMap<string, number>;
  preferredRecipientPhone: string | null;
}): HostedLinqAssignableHomeLine | null {
  const preferredRecipientPhone = normalizePhoneNumber(input.preferredRecipientPhone);
  const candidates = input.lines.filter((line) =>
    isHostedLinqHomeLineUnderLimits({
      activeMembersByRecipientPhone: input.activeMembersByRecipientPhone,
      line,
      newAssignmentsByRecipientPhone: input.newAssignmentsByRecipientPhone,
    }),
  );

  if (preferredRecipientPhone) {
    const preferred = candidates.find((line) => line.phoneNumber === preferredRecipientPhone);
    if (preferred) {
      return preferred;
    }
  }

  return [...candidates].sort((left, right) => {
    const leftDaily = input.newAssignmentsByRecipientPhone.get(left.phoneNumber) ?? 0;
    const rightDaily = input.newAssignmentsByRecipientPhone.get(right.phoneNumber) ?? 0;
    if (leftDaily !== rightDaily) {
      return leftDaily - rightDaily;
    }

    const leftActive = input.activeMembersByRecipientPhone.get(left.phoneNumber) ?? 0;
    const rightActive = input.activeMembersByRecipientPhone.get(right.phoneNumber) ?? 0;
    if (leftActive !== rightActive) {
      return leftActive - rightActive;
    }

    if (left.assignmentWeight !== right.assignmentWeight) {
      return right.assignmentWeight - left.assignmentWeight;
    }

    return left.phoneNumberLookupKey.localeCompare(right.phoneNumberLookupKey);
  })[0] ?? null;
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
    return homeRecipientPhone ?? incomingRecipientPhone;
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

function isHostedLinqConversationRecipientPhoneAtCapacity(input: {
  activeMembersByRecipientPhone: ReadonlyMap<string, number>;
  maxActiveMembersPerPhoneNumber: number | null;
  recipientPhone: string;
}): boolean {
  if (input.maxActiveMembersPerPhoneNumber === null) {
    return false;
  }

  return (input.activeMembersByRecipientPhone.get(input.recipientPhone) ?? 0)
    >= input.maxActiveMembersPerPhoneNumber;
}

function isHostedLinqHomeLineUnderLimits(input: {
  activeMembersByRecipientPhone: ReadonlyMap<string, number>;
  line: HostedLinqAssignableHomeLine;
  newAssignmentsByRecipientPhone: ReadonlyMap<string, number>;
}): boolean {
  if (
    input.line.activeMemberLimit !== null
    && (input.activeMembersByRecipientPhone.get(input.line.phoneNumber) ?? 0)
      >= input.line.activeMemberLimit
  ) {
    return false;
  }

  if (
    input.line.maxNewConversationsPerDay !== null
    && (input.newAssignmentsByRecipientPhone.get(input.line.phoneNumber) ?? 0)
      >= input.line.maxNewConversationsPerDay
  ) {
    return false;
  }

  return true;
}
