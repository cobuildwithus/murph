import {
  buildHostedExecutionMemberActivatedDispatch,
  type HostedExecutionDispatchRequest,
  type HostedExecutionMemberActivatedEvent,
} from "@murphai/hosted-execution";

export function buildHostedMemberActivationDispatch(input: {
  memberId: string;
  occurredAt: string;
  sourceEventId: string;
  sourceType: string;
}): HostedExecutionDispatchRequest {
  return buildHostedExecutionMemberActivatedDispatch({
    eventId: buildHostedMemberActivationEventId(input),
    memberId: input.memberId,
    occurredAt: input.occurredAt,
  });
}

export function buildHostedMemberActivationFirstContact(input: {
  linqChatId: string | null;
  phoneLookupKey: string | null;
}): HostedExecutionMemberActivatedEvent["firstContact"] {
  return input.linqChatId && input.phoneLookupKey
    ? {
        channel: "linq",
        identityId: input.phoneLookupKey,
        threadId: input.linqChatId,
        threadIsDirect: true,
      }
    : null;
}

function buildHostedMemberActivationEventId(input: {
  memberId: string;
  sourceEventId: string;
  sourceType: string;
}): string {
  return `member.activated:${input.sourceType}:${input.memberId}:${input.sourceEventId}`;
}
