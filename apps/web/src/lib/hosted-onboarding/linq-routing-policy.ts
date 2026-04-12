import { normalizePhoneNumber } from "./phone";

export type HostedLinqActiveRouteDecision =
  | {
      kind: "bind_home";
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

export function resolveHostedLinqActiveRouteDecision(input: {
  homeChatId: string | null;
  homeRecipientPhone: string | null;
  incomingChatId: string;
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
