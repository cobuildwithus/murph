import {
  LinkPagePill,
  LinkPageScreen,
  LinkPageTicket,
} from "@/src/components/link-page/link-page-shell";

export type HostedSignupReferralLandingState =
  | "available"
  | "busy"
  | "unavailable";

export function HostedSignupReferralLanding(props: {
  referralCode: string;
  state: HostedSignupReferralLandingState;
}) {
  if (props.state === "unavailable") {
    return (
      <LinkPageScreen
        detail="Ask the person who shared it to send their current Murph link."
        title="This link isn’t available."
      />
    );
  }

  if (props.state === "busy") {
    return (
      <LinkPageScreen
        actions={(
          <form
            action={buildClaimPath(props.referralCode)}
            className="w-full"
            method="post"
          >
            <LinkPagePill type="submit">Try again</LinkPagePill>
          </form>
        )}
        detail="Murph couldn’t open setup just now. Wait a moment, then try this link again."
        title="Try again soon."
      />
    );
  }

  return (
    <LinkPageScreen
      actions={(
        <form
          action={buildClaimPath(props.referralCode)}
          className="w-full"
          method="post"
        >
          <LinkPagePill
            aria-describedby="referral-attribution-note"
            type="submit"
          >
            Join Murph
          </LinkPagePill>
        </form>
      )}
      announceDetail={false}
      detail="Your personal health AI. Health is hard, don’t do it alone."
      title="Meet Murph."
    >
      <LinkPageTicket
        className="mt-0"
        kicker="You're invited"
        note="This link tells Murph who introduced you. They cannot see your conversations or health information."
        noteId="referral-attribution-note"
        size="large"
        title="Admit one"
      />
    </LinkPageScreen>
  );
}

function buildClaimPath(referralCode: string): string {
  return `/r/${encodeURIComponent(referralCode)}/claim`;
}
