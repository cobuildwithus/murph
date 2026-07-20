import "server-only";

import {
  defaultAssistantVoiceOptionId,
  isAssistantVoiceOptionId,
} from "@murphai/contracts";

import { getPrisma } from "@/src/lib/prisma";

// Pre-generated memos from scripts/generate-whoop-sync-voice-memos.mjs, one
// per assistant voice option. Members without a pick hear the default voice.
export async function resolveWhoopSyncVoiceMemoSrc(
  memberId: string | null,
): Promise<string> {
  const fallback = `/audio/whoop-sync-memos/${defaultAssistantVoiceOptionId}.mp3`;
  if (!memberId) {
    return fallback;
  }

  try {
    const member = await getPrisma().hostedMember.findUnique({
      where: { id: memberId },
      select: { assistantVoice: true },
    });
    const voice = member?.assistantVoice;
    return isAssistantVoiceOptionId(voice)
      ? `/audio/whoop-sync-memos/${voice}.mp3`
      : fallback;
  } catch {
    return fallback;
  }
}
