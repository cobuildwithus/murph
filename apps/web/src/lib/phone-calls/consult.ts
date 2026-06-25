import type { HostedPhoneCall } from "@prisma/client";
import {
  hostedPhoneCallAdviceSchema,
  hostedPhoneCallBriefSchema,
  type HostedPhoneCallAdvice,
  type HostedPhoneCallBrief,
} from "@murphai/hosted-execution/phone-calls";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
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
    findUnique(input: {
      where: {
        id: string;
      };
    }): Promise<HostedPhoneCall | null>;
  };
}

export async function getHostedPhoneCallForConsultation(input: {
  callId: string;
  providerCallId: string;
  prisma?: HostedPhoneCallConsultationStore;
}): Promise<HostedPhoneCallForConsultation> {
  const prisma = input.prisma ?? getPrisma();
  const call = await prisma.hostedPhoneCall.findUnique({
    where: {
      id: input.callId,
    },
  });

  if (!call) {
    throw hostedOnboardingError({
      code: "HOSTED_PHONE_CALL_NOT_FOUND",
      httpStatus: 404,
      message: "Murph phone call was not found.",
    });
  }

  if (
    call.provider !== "retell"
    || call.providerCallId !== input.providerCallId
    || !isHostedPhoneCallLiveForConsultation(call.status)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_PHONE_CALL_CALLBACK_NOT_ACTIVE",
      httpStatus: 409,
      message: "Retell phone call callback does not match an active Murph phone call.",
    });
  }

  return {
    brief: hostedPhoneCallBriefSchema.parse(call.briefJson),
    id: call.id,
    memberId: call.memberId,
    providerCallId: call.providerCallId,
    status: call.status,
  };
}

function isHostedPhoneCallLiveForConsultation(status: HostedPhoneCall["status"]): boolean {
  return status === "starting" || status === "calling";
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
  const approvedFactAnswer = resolveApprovedShareableFactAnswer({
    brief: input.call.brief,
    question: input.question,
  });
  if (approvedFactAnswer) {
    return hostedPhoneCallAdviceSchema.parse({
      answer: approvedFactAnswer,
      directive: "continue",
    });
  }

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

function resolveApprovedShareableFactAnswer(input: {
  brief: HostedPhoneCallBrief;
  question: string;
}): string | null {
  const normalizedQuestion = normalizeConsultQuestion(input.question);
  const entries = Object.entries(input.brief.shareableFacts)
    .map(([key, value]) => ({
      key,
      labels: buildShareableFactLabels(key),
      value,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));

  for (const entry of entries) {
    if (entry.labels.some((label) => containsNormalizedPhrase(normalizedQuestion, label))) {
      return `Use this approved call-brief fact when relevant: ${formatShareableFactKey(entry.key)}: ${entry.value}`;
    }
  }

  return null;
}

function buildShareableFactLabels(key: string): string[] {
  const normalizedKey = normalizeConsultQuestion(key);
  const spacedKey = normalizeConsultQuestion(key.replace(/[_-]+/gu, " "));
  const labels = new Set<string>([normalizedKey, spacedKey]);

  switch (spacedKey) {
    case "callback number":
      labels.add("call back number");
      labels.add("contact number");
      labels.add("phone number");
      break;
    case "date of birth":
      labels.add("birth date");
      labels.add("dob");
      break;
    case "insurance member id":
      labels.add("member id");
      labels.add("insurance id");
      break;
    case "insurance provider":
      labels.add("insurance company");
      break;
    case "patient name":
      labels.add("user name");
      break;
  }

  return [...labels].filter((label) => label.length > 0);
}

function containsNormalizedPhrase(question: string, phrase: string): boolean {
  if (phrase.length === 0) {
    return false;
  }

  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^| )${escaped}(?: |$)`, "u").test(question);
}

function formatShareableFactKey(key: string): string {
  return key.replace(/[_-]+/gu, " ");
}

function normalizeConsultQuestion(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
