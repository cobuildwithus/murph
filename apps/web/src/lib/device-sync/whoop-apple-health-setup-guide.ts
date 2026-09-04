import { defaultAssistantVoiceOptionId } from "@murphai/contracts";

import type { DeviceSyncCompletionSetupGuide } from "@/src/lib/device-sync/connect-completion-types";

const MURPH_IOS_APP_STORE_URL = "https://apps.apple.com/us/app/murph-ai/id6786145859";

export function buildWhoopAppleHealthSetupGuide(
  voiceMemoSrc?: string | null,
): DeviceSyncCompletionSetupGuide {
  return {
    actionAriaLabel: "See how to sync all of your WHOOP data",
    actionLabel: "Get full sync",
    detail: "Two quick steps and Murph sees everything WHOOP tracks.",
    downloadAction: {
      ariaLabel: "Download App to sync WHOOP through Apple Health",
      href: MURPH_IOS_APP_STORE_URL,
      label: "Download App",
      rel: "noopener noreferrer",
      target: "_blank",
    },
    steps: [
      {
        detail: "Get the Murph app on your iPhone and connect Apple Health when it asks.",
        title: "Download Murph and sign in",
      },
      {
        detail:
          "In WHOOP, go to More, App Settings, Integrations, then Apple Health. Turn on all categories and tap Allow.",
        title: "Turn on Apple Health in WHOOP",
      },
    ],
    title: "Get your full sync",
    voiceMemoSrc:
      voiceMemoSrc ?? `/audio/whoop-sync-memos/${defaultAssistantVoiceOptionId}.mp3`,
  };
}
