import "server-only";

import {
  defaultAssistantVoiceOptionId,
  isAssistantVoiceOptionId,
  type AssistantVoiceOptionId,
} from "@murphai/contracts";

import { getPrisma } from "@/src/lib/prisma";

export interface DeviceSyncVoiceMemoSources {
  garminHistoricalData: string;
  whoopSync: string;
}

// Each memo set contains one pre-generated clip per assistant voice option.
// Members without a saved voice, or whose preference cannot be read, hear the
// default Murph voice.
export async function resolveDeviceSyncVoiceMemoSources(
  memberId: string | null,
): Promise<DeviceSyncVoiceMemoSources> {
  if (!memberId) {
    return buildDeviceSyncVoiceMemoSources(defaultAssistantVoiceOptionId);
  }

  try {
    const member = await getPrisma().hostedMember.findUnique({
      where: { id: memberId },
      select: { assistantVoice: true },
    });
    const voice = member?.assistantVoice;
    return buildDeviceSyncVoiceMemoSources(
      isAssistantVoiceOptionId(voice) ? voice : defaultAssistantVoiceOptionId,
    );
  } catch {
    return buildDeviceSyncVoiceMemoSources(defaultAssistantVoiceOptionId);
  }
}

export async function resolveWhoopSyncVoiceMemoSrc(
  memberId: string | null,
): Promise<string> {
  return (await resolveDeviceSyncVoiceMemoSources(memberId)).whoopSync;
}

function buildDeviceSyncVoiceMemoSources(
  voice: AssistantVoiceOptionId,
): DeviceSyncVoiceMemoSources {
  return {
    garminHistoricalData: `/audio/garmin-historical-data-memos/${voice}.mp3`,
    whoopSync: `/audio/whoop-sync-memos/${voice}.mp3`,
  };
}
