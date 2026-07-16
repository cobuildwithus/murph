import type { HostedPhoneCall } from "@prisma/client";

import {
  readRetellMurphPhoneCallId,
  type RetellCallPayload,
} from "./retell-payloads";

export interface RetellWebhookCallTarget {
  call: HostedPhoneCall;
  providerCallIdData: {
    providerCallId?: string;
  };
}

export interface RetellWebhookCallTargetStore {
  hostedPhoneCall: {
    findUnique(input: {
      where:
        | { id: string }
        | { providerCallId: string };
    }): Promise<HostedPhoneCall | null>;
  };
}

export async function readRetellWebhookCallTarget(input: {
  call: RetellCallPayload;
  prisma: RetellWebhookCallTargetStore;
}): Promise<RetellWebhookCallTarget | null> {
  const murphCallId = readRetellMurphPhoneCallId(input.call);
  const call = murphCallId
    ? await input.prisma.hostedPhoneCall.findUnique({
      where: { id: murphCallId },
    })
    : await input.prisma.hostedPhoneCall.findUnique({
      where: { providerCallId: input.call.call_id },
    });

  if (!call || call.provider !== "retell") {
    return null;
  }
  if (call.providerCallId && call.providerCallId !== input.call.call_id) {
    return null;
  }

  return {
    call,
    providerCallIdData: call.providerCallId
      ? {}
      : { providerCallId: input.call.call_id },
  };
}
