import type { MemberOwnedProviderSetupPresentation } from "./types";

export const STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION = {
  actionLabels: {
    authorize: "Continue",
    continue_handoff: "Continue setup",
    continue_oauth: "Continue with Strava",
    disconnect_first: "Disconnect Strava first",
  },
  cancelSetupLabel: "Cancel setup",
  developerAccessDisclosure:
    "Strava may require developer access or another provider prerequisite before setup can finish.",
  messages: {
    authorized: "Setup is authorized. Murph is continuing this exact Strava setup now.",
    browser_setup: "Murph is continuing this Strava setup in its secure browser. Progress survives sign-in, MFA, CAPTCHA, and provider prerequisites.",
    canceled: "Strava setup was canceled. You can authorize a new attempt.",
    canceling: "Murph is safely canceling this Strava setup.",
    capturing: "Murph is securely capturing and sealing the private application credentials. They are never shown to the assistant.",
    connected: "Strava is connected through your private provider application.",
    deletion_pending: "Murph is removing only the private Strava application it can prove it owns.",
    deleted: "The private Strava application and local credential binding were deleted.",
    disconnect_first: "Disconnect the current Strava connection before changing or removing its private application.",
    oauth_in_progress: "Strava is waiting for read-only consent. Continue to finish connecting.",
    oauth_ready: "Your private Strava application is ready. Continue to grant read-only activity access.",
    pending: "Murph can create and manage a private Strava application for this connection.",
  },
  provider: "strava",
  providerName: "Strava",
  readOnlyAccessLabel: "Read-only activity access",
} as const satisfies MemberOwnedProviderSetupPresentation;
