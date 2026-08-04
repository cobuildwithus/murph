import type { DeviceSyncCompletionSetupGuide } from "@/src/lib/device-sync/connect-completion-types";

const MURPH_IOS_APP_STORE_URL = "https://apps.apple.com/us/app/murph-ai/id6786145859";

export function buildZeppAppleHealthSetupGuide(): DeviceSyncCompletionSetupGuide {
  return {
    actionAriaLabel: "See how to sync Zepp through Apple Health",
    actionLabel: "Set up sync",
    detail: "Zepp shares supported Amazfit data with Apple Health, and Murph reads it there.",
    downloadAction: {
      ariaLabel: "Download App to sync Zepp through Apple Health",
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
          "In the Zepp app, open its Apple Health integration and allow the health categories you want Murph to use.",
        title: "Turn on Apple Health in Zepp",
      },
    ],
    title: "Sync Zepp through Apple Health",
  };
}
