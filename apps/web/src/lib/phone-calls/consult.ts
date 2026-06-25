import type { HostedPhoneCall } from "@prisma/client";
import {
  hostedPhoneCallAdviceSchema,
  hostedPhoneCallBriefSchema,
  type HostedPhoneCallAdvice,
  type HostedPhoneCallBrief,
} from "@murphai/hosted-execution/phone-calls";

import { getPrisma } from "../prisma";
import { resolveVerifiedMemberTransferNumber } from "./transfer";

export interface HostedPhoneCallForConsultation {
  brief: HostedPhoneCallBrief;
  id: string;
  memberId: string;
  providerCallId: string | null;
  status: HostedPhoneCall["status"];
}

interface HostedPhoneCallConsultationStore {
  hostedPhoneCall: {
    findUniqueOrThrow(input: {
      where: {
        id: string;
      };
    }): Promise<HostedPhoneCall>;
  };
}

export async function getHostedPhoneCallForConsultation(input: {
  callId: string;
  prisma?: HostedPhoneCallConsultationStore;
}): Promise<HostedPhoneCallForConsultation> {
  const prisma = input.prisma ?? getPrisma();
  const call = await prisma.hostedPhoneCall.findUniqueOrThrow({
    where: {
      id: input.callId,
    },
  });

  return {
    brief: hostedPhoneCallBriefSchema.parse(call.briefJson),
    id: call.id,
    memberId: call.memberId,
    providerCallId: call.providerCallId,
    status: call.status,
  };
}

export async function consultPhoneCall(input: {
  call: HostedPhoneCallForConsultation;
  memberId: string;
  question: string;
  transcript: string;
  transferNumberResolver?: (resolverInput: {
    memberId: string;
  }) => Promise<string | null>;
}): Promise<HostedPhoneCallAdvice> {
  const canTransfer = input.call.brief.allowTransferToUser
    && Boolean(await (input.transferNumberResolver ?? resolveVerifiedMemberTransferNumber)({
      memberId: input.memberId,
    }));

  return hostedPhoneCallAdviceSchema.parse({
    answer: canTransfer
      ? "I cannot safely answer that from Murph during the live call. Transfer the call to the user."
      : "I cannot safely answer that from Murph during the live call. End the call and report what is needed.",
    directive: canTransfer ? "transfer_to_user" : "end_call",
  });
}
