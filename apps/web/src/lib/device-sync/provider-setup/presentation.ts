import type { MemberOwnedProviderSetupPresentation } from "./types";

export const STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION = {
  actionLabels: {
    continue_oauth: "Continue with Strava",
    continue_provider: "Continue in Strava",
    continue_sign_in: "Continue sign-in",
    disconnect_first: "Disconnect Strava first",
    retry: "Retry safely",
    start: "Set up Strava",
  },
  cancelSetupLabel: "Cancel setup",
  messages: {
    canceled: "Strava setup was canceled. You can start again.",
    canceling: "Murph is safely canceling this Strava setup. You can retry cancellation if it was interrupted.",
    connected: "Strava is connected and Murph is starting the existing sync and backfill path.",
    deletion_pending: "Murph is removing its private Strava application for account deletion.",
    deleted: "This Strava setup was deleted.",
    disconnect_first: "Disconnect the current Strava connection before Murph replaces or repairs its private application.",
    inspection_required: "Murph needs to inspect Strava before safely continuing. It will not submit another application until the previous result is known.",
    oauth_in_progress: "Strava is waiting for read-only consent. Continue to finish connecting.",
    oauth_ready: "Your private Strava application is ready. Continue to grant read-only activity access.",
    pending: "Murph can set up your private Strava connection. Strava may first require a developer subscription or provider prerequisite.",
    provider_conflict: "Strava contains an application Murph does not own. Murph will not adopt, change, or delete it.",
    provider_prerequisite: "Strava requires its current developer subscription or provider prerequisite before Murph can create the private application. Continue in Strava, then return here to resume, or cancel setup.",
    repair_required: "Murph can repair its private Strava application without asking you for credentials.",
    retryable_failure: "Strava setup was interrupted. Your progress is saved and safe to retry.",
    waiting_for_user: "Continue in Strava only for sign-in, verification, CAPTCHA, or an explicit confirmation.",
    working: "Murph is setting up Strava for you.",
  },
  provider: "strava",
  providerName: "Strava",
  readOnlyAccessLabel: "Read-only activity access",
} as const satisfies MemberOwnedProviderSetupPresentation;
