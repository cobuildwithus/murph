import type { HostedPhoneCall } from "@prisma/client";
import {
  hostedPhoneCallAdviceSchema,
  hostedPhoneCallBriefSchema,
  type HostedPhoneCallAdvice,
  type HostedPhoneCallBrief,
} from "@murphai/hosted-execution/phone-calls";

import { getPrisma } from "../prisma";

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

export async function consultPhoneCall(_input: {
  call: HostedPhoneCallForConsultation;
  memberId: string;
  question: string;
  transcript: string;
}): Promise<HostedPhoneCallAdvice> {
  return hostedPhoneCallAdviceSchema.parse({
    answer:
      "I cannot safely answer that from Murph during the live call. Transfer the call to the user if the brief allows it; otherwise end the call and report what is needed.",
    directive: "transfer_to_user",
  });
}
