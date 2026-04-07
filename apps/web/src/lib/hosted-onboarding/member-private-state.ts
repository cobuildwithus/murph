import {
  applyHostedMemberPrivateStatePatch,
  type HostedMemberPrivateState,
  type HostedMemberPrivateStatePatch,
} from "@murphai/hosted-execution/member-private-state";

import {
  deleteHostedMemberPrivateStateFromHostedExecution,
  provisionManagedUserCryptoInHostedExecution,
  readHostedExecutionControlClientIfConfigured,
  readHostedMemberPrivateStateFromHostedExecution,
  writeHostedMemberPrivateStateToHostedExecution,
} from "../hosted-execution/control";
import { hostedOnboardingError } from "./errors";

export type { HostedMemberPrivateState, HostedMemberPrivateStatePatch };
const hostedMemberPrivateStateTestStore = new Map<string, HostedMemberPrivateState>();

export async function readHostedMemberPrivateState(input: {
  memberId: string;
}): Promise<HostedMemberPrivateState | null> {
  if (isHostedMemberPrivateStateTestMode()) {
    return hostedMemberPrivateStateTestStore.get(input.memberId) ?? null;
  }

  if (!readHostedExecutionControlClientIfConfigured()) {
    throwHostedMemberPrivateStateUnavailableError();
  }

  return readHostedMemberPrivateStateFromHostedExecution(input.memberId);
}

export async function writeHostedMemberPrivateStatePatch(input: {
  memberId: string;
  now?: string;
  patch: HostedMemberPrivateStatePatch;
}): Promise<HostedMemberPrivateState> {
  const client = readHostedExecutionControlClientIfConfigured();

  if (!client) {
    if (isHostedMemberPrivateStateTestMode()) {
      const current = hostedMemberPrivateStateTestStore.get(input.memberId) ?? null;
      const next = applyHostedMemberPrivateStatePatch({
        current,
        memberId: input.memberId,
        now: input.now,
        patch: input.patch,
      });

      if (isHostedMemberPrivateStateEmpty(next)) {
        hostedMemberPrivateStateTestStore.delete(input.memberId);
      } else {
        hostedMemberPrivateStateTestStore.set(input.memberId, next);
      }

      return next;
    }

    if (hasPersistableHostedMemberPrivateStateValues(input.patch)) {
      throwHostedMemberPrivateStateUnavailableError();
    }

    return applyHostedMemberPrivateStatePatch({
      current: null,
      memberId: input.memberId,
      now: input.now,
      patch: input.patch,
    });
  }

  await provisionManagedUserCryptoInHostedExecution(input.memberId);
  const current = await client.getMemberPrivateState(input.memberId);
  const next = applyHostedMemberPrivateStatePatch({
    current,
    memberId: input.memberId,
    now: input.now,
    patch: input.patch,
  });

  if (isHostedMemberPrivateStateEmpty(next)) {
    await deleteHostedMemberPrivateStateFromHostedExecution(input.memberId);
    return next;
  }

  return writeHostedMemberPrivateStateToHostedExecution(next);
}

function hasPersistableHostedMemberPrivateStateValues(
  patch: HostedMemberPrivateStatePatch,
): boolean {
  return Object.values(patch).some((value) => typeof value === "string" && value.trim().length > 0);
}

function isHostedMemberPrivateStateEmpty(state: HostedMemberPrivateState): boolean {
  return ![
    state.linqChatId,
    state.privyUserId,
    state.signupPhoneCodeSendAttemptId,
    state.signupPhoneCodeSendAttemptStartedAt,
    state.signupPhoneCodeSentAt,
    state.signupPhoneNumber,
    state.stripeCustomerId,
    state.stripeLatestBillingEventId,
    state.stripeLatestCheckoutSessionId,
    state.stripeSubscriptionId,
    state.walletAddress,
  ].some((value) => typeof value === "string" && value.trim().length > 0);
}

function isHostedMemberPrivateStateTestMode(): boolean {
  return process.env.NODE_ENV === "test" || typeof process.env.VITEST === "string";
}

function throwHostedMemberPrivateStateUnavailableError(): never {
  throw hostedOnboardingError({
    code: "HOSTED_MEMBER_PRIVATE_STATE_NOT_CONFIGURED",
    message: "Hosted member private state storage is not configured yet. Contact support to finish setup.",
    httpStatus: 500,
  });
}
