import {
  buildHostedExecutionMemberActivatedDispatch,
  type HostedExecutionDispatchRequest,
} from "@murph/hosted-execution";

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

function buildHostedMemberActivationEventId(input: {
  memberId: string;
  sourceEventId: string;
  sourceType: string;
}): string {
  return `member.activated:${input.sourceType}:${input.memberId}:${input.sourceEventId}`;
}
