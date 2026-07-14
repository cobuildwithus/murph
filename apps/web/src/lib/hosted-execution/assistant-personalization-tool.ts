import "server-only";

import {
  HOSTED_RUNTIME_ASSISTANT_PREFERENCE_CAUSAL_SEQ_ACTION,
  type HostedRuntimeAssistantPreferenceCausalSeqResponse,
  type HostedRuntimeAssistantPersonalizationToolAuthority,
  type HostedRuntimeAssistantPersonalizationSnapshot,
  type HostedRuntimeAssistantPersonalizationToolRequest,
  type HostedRuntimeAssistantPersonalizationToolResponse,
} from "@murphai/hosted-execution/assistant-personalization";
import {
  assistantPersonalityCausalWritesEnabled,
  defaultAssistantTonePreference,
  defaultAssistantVoiceOptionId,
} from "@murphai/contracts";

import { getPrisma } from "@/src/lib/prisma";
import {
  assertHostedMemberAssistantPersonalizationEligible,
  readHostedMemberAssistantModelPreference,
} from "@/src/lib/hosted-onboarding/assistant-model-preference";
import { assertActiveHostedMemberAccessAllowed } from "@/src/lib/hosted-onboarding/member-access";
import {
  readHostedMemberAssistantPreferences,
  upsertHostedMemberAssistantPreferencesTx,
} from "@/src/lib/hosted-onboarding/member-preferences";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  lockHostedMemberSponsoredAccessRows,
} from "@/src/lib/hosted-onboarding/shared";
import {
  readHostedMailboxPreferenceCausalSeqByAssistantInputIdTx,
  type HostedMailboxStoreClient,
} from "@/src/lib/hosted-mailbox/store";

type HostedRuntimeAssistantPersonalizationUpdateResponse = Extract<
  HostedRuntimeAssistantPersonalizationToolResponse,
  { action: "update" }
>;

interface HostedRuntimeAssistantPersonalizationTransactionResult {
  dispatch: { mailboxItemId: string } | null;
  response: HostedRuntimeAssistantPersonalizationUpdateResponse;
}

export async function resolveHostedRuntimeAssistantPreferenceCausalSeq(input: {
  authority: HostedRuntimeAssistantPersonalizationToolAuthority;
  memberId: string;
}): Promise<HostedRuntimeAssistantPreferenceCausalSeqResponse> {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => ({
    action: HOSTED_RUNTIME_ASSISTANT_PREFERENCE_CAUSAL_SEQ_ACTION,
    result: {
      causalSeq: await requireHostedRuntimeAssistantPreferenceCausalSeq({
        assistantInputId: input.authority.assistantInputId,
        memberId: input.memberId,
        prisma: tx,
      }),
    },
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function handleHostedRuntimeAssistantPersonalizationTool(input: {
  authority?: HostedRuntimeAssistantPersonalizationToolAuthority;
  memberId: string;
  request: HostedRuntimeAssistantPersonalizationToolRequest;
  scheduleMailboxWake?: (input: {
    expectedUserId: string;
    mailboxItemId: string;
  }) => void;
}): Promise<HostedRuntimeAssistantPersonalizationToolResponse> {
  if (input.request.action === "read") {
    await assertActiveHostedMemberAccessAllowed({
      memberId: input.memberId,
      prisma: getPrisma(),
    });
    await assertHostedMemberAssistantPersonalizationEligible({
      memberId: input.memberId,
      prisma: getPrisma(),
    });
    return {
      action: "read",
      result: await readHostedAssistantPersonalization(input.memberId),
    };
  }

  const request = input.request;
  const authority = input.authority;
  if (!authority) {
    throw new TypeError("Assistant personalization update requires assistant input authority.");
  }
  const prisma = getPrisma();
  const transactionResult = await prisma.$transaction(async (tx) => {
    const preferenceCausalSeq =
      await requireHostedRuntimeAssistantPreferenceCausalSeq({
        assistantInputId: authority.assistantInputId,
        memberId: input.memberId,
        prisma: tx,
      });
    const styleResult = request.tone !== undefined || request.voice !== undefined
      ? await upsertHostedMemberAssistantPreferencesTx({
          causalOrigin: "turn",
          mailboxPayloadMode: assistantPersonalityCausalWritesEnabled(process.env)
            ? "sparse_delta"
            : "legacy_snapshot",
          memberId: input.memberId,
          occurredAt: new Date().toISOString(),
          preferenceCausalSeq,
          preferences: {
            ...(request.tone === undefined ? {} : { tone: request.tone }),
            ...(request.voice === undefined ? {} : { voice: request.voice }),
          },
          prisma: tx,
        })
      : null;
    const model = await readHostedMemberAssistantModelPreference({
        memberId: input.memberId,
        prisma: tx,
      });
    const preferences = styleResult
      ? {
          tone: styleResult.assistantTone,
          voice: styleResult.assistantVoice,
        }
      : await readHostedMemberAssistantPreferences({
          memberId: input.memberId,
          prisma: tx,
        });
    const effectiveTone = preferences.tone ?? defaultAssistantTonePreference;
    const effectiveVoice = preferences.voice ?? defaultAssistantVoiceOptionId;
    const styleUpdated = styleResult?.updated ?? false;

    return {
      dispatch: styleResult?.dispatch ?? null,
      response: {
        action: "update" as const,
        result: {
          model: model.model,
          modelChangeAppliesNextRun: false as const,
          modelUpdated: false as const,
          solAvailable: model.solAvailable,
          status: styleUpdated ? "saved" as const : "unchanged" as const,
          tone: effectiveTone,
          voice: effectiveVoice,
        },
      },
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (transactionResult.dispatch) {
    input.scheduleMailboxWake?.({
      expectedUserId: input.memberId,
      mailboxItemId: transactionResult.dispatch.mailboxItemId,
    });
  }

  return transactionResult.response;
}

async function requireHostedRuntimeAssistantPreferenceCausalSeq(input: {
  assistantInputId: string;
  memberId: string;
  prisma: HostedMailboxStoreClient;
}): Promise<string> {
  await lockHostedMemberRow(input.prisma, input.memberId);
  await lockHostedMemberSponsoredAccessRows(input.prisma, input.memberId);
  await assertActiveHostedMemberAccessAllowed({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  await assertHostedMemberAssistantPersonalizationEligible({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const causalSeq = await readHostedMailboxPreferenceCausalSeqByAssistantInputIdTx({
    assistantInputId: input.assistantInputId,
    memberId: input.memberId,
    prisma: input.prisma,
  });
  if (causalSeq === null) {
    throw new TypeError("Assistant personalization input authority is invalid.");
  }
  return causalSeq;
}

async function readHostedAssistantPersonalization(
  memberId: string,
): Promise<HostedRuntimeAssistantPersonalizationSnapshot> {
  const prisma = getPrisma();
  const [preferences, model] = await Promise.all([
    readHostedMemberAssistantPreferences({ memberId, prisma }),
    readHostedMemberAssistantModelPreference({ memberId, prisma }),
  ]);

  return {
    model: model.model,
    solAvailable: model.solAvailable,
    tone: preferences.tone ?? defaultAssistantTonePreference,
    voice: preferences.voice ?? defaultAssistantVoiceOptionId,
  };
}
