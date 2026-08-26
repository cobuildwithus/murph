import "server-only";

import {
  readPushPrimarySourceRecoveryNoticePolicy,
} from "@murphai/device-syncd/source-staleness";
import {
  isHostedEmailConversationMessageWake,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
} from "@murphai/hosted-execution";
import type {
  HostedExecutionDeviceSyncNoDataOutreachRequest,
  HostedExecutionDeviceSyncNoDataOutreachResponse,
} from "@murphai/device-syncd/hosted-runtime";

import {
  readHostedMailboxConversationInputAuthorityByAssistantInputIdTx,
  readHostedMailboxConversationWakeByAssistantInputId,
} from "../hosted-mailbox/store";
import { requireHostedRuntimeActiveAccessForUpdateTx } from "../hosted-mailbox/runtime-access";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";
import { readHostedSourceNoDataOutreachPolicy } from "./source-no-data-outreach-policy";

export async function configureHostedSourceNoDataOutreach(input: {
  memberId: string;
  request: HostedExecutionDeviceSyncNoDataOutreachRequest;
}): Promise<HostedExecutionDeviceSyncNoDataOutreachResponse> {
  const sourceProviderSlug = input.request.sourceProviderSlug.trim().toLowerCase();
  if (!readPushPrimarySourceRecoveryNoticePolicy(sourceProviderSlug)) {
    throw new TypeError("No-data outreach is unavailable for this source provider.");
  }
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, { prisma: tx });
    const authority =
      await readHostedMailboxConversationInputAuthorityByAssistantInputIdTx({
        assistantInputId: input.request.assistantInputId,
        memberId: input.memberId,
        prisma: tx,
      });
    const wake = await readHostedMailboxConversationWakeByAssistantInputId({
      assistantInputId: input.request.assistantInputId,
      memberId: input.memberId,
      prisma: tx,
    });
    if (!authority || !wake || !isDirectMemberConversationWake(wake)) {
      throw new TypeError("No-data outreach can only be changed from current private member input.");
    }
    let changed = false;
    if (input.request.mode === "default") {
      const deleted = await tx.deviceSourceNoDataOutreachPreference.deleteMany({
        where: { sourceProviderSlug, userId: input.memberId },
      });
      changed = deleted.count > 0;
    } else {
      const existing = await tx.deviceSourceNoDataOutreachPreference.findUnique({
        select: { reminderAfterDays: true },
        where: {
          userId_sourceProviderSlug: {
            sourceProviderSlug,
            userId: input.memberId,
          },
        },
      });
      const reminderAfterDays = input.request.mode === "off"
        ? null
        : input.request.afterDays;
      changed = !existing || existing.reminderAfterDays !== reminderAfterDays;
      if (changed) {
        await tx.deviceSourceNoDataOutreachPreference.upsert({
          create: {
            reminderAfterDays,
            sourceProviderSlug,
            userId: input.memberId,
          },
          update: { reminderAfterDays },
          where: {
            userId_sourceProviderSlug: {
              sourceProviderSlug,
              userId: input.memberId,
            },
          },
        });
      }
    }

    const policy = await readHostedSourceNoDataOutreachPolicy({
      memberId: input.memberId,
      prisma: tx,
      sourceProviderSlug,
    });
    if (!policy) {
      throw new TypeError("No-data outreach is unavailable for this source provider.");
    }
    return {
      action: "configure_no_data_outreach",
      effectiveAfterDays: policy.enabled ? policy.afterDays : null,
      setting: policy.setting,
      sourceProviderSlug,
      status: changed ? "saved" : "unchanged",
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

function isDirectMemberConversationWake(
  wake: Awaited<ReturnType<typeof readHostedMailboxConversationWakeByAssistantInputId>>,
): boolean {
  if (!wake) {
    return false;
  }
  if (isHostedLinqConversationMessageWake(wake)) {
    return wake.message.linqMessage.threadIsDirect === true;
  }
  if (isHostedEmailConversationMessageWake(wake)) {
    return wake.message.threadIsDirect === true
      && wake.message.assistantStyleSettingsAuthorized === true;
  }
  return isHostedTelegramConversationMessageWake(wake)
    && wake.message.telegramMessage.threadIsDirect === true;
}
