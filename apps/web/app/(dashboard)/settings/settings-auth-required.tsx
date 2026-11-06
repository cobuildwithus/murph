"use client";

import { LinkPageCover, LinkPageSurface } from "@/src/components/link-page/link-page-shell";
import { LinkPageSignInScreen } from "@/src/components/link-page/link-page-sign-in";

const ACCOUNT_COPY = {
  detail: "Sign in to manage your account and health data consent.",
  title: "Continue to Settings.",
};

const ADD_USAGE_COPY = {
  detail: "We’ll check this link against your account.",
  title: "Sign in to add usage.",
};

const BILLING_RETURN_COPY = {
  detail: "Sign in to verify and finish your billing update.",
  title: "One more step.",
};

const USAGE_RECOVERY_COPY = {
  detail: "Sign in to review the recovery options available for your account.",
  title: "Continue in Settings.",
};

const FAMILY_RECOVERY_COPY = {
  detail: "Sign in to continue to Family Settings.",
  title: "Continue to Family Settings.",
};

type SettingsSignInCopy = typeof ACCOUNT_COPY;

function SettingsSignIn({ copy }: { copy: SettingsSignInCopy }) {
  return (
    <LinkPageSignInScreen
      detail={copy.detail}
      requireLaunchConsent={false}
      title={copy.title}
    />
  );
}

// The payment link Murph sends over text can open in a browser that has never
// held a Murph session, so this screen is a normal return state, not an error.
//
// The copy stays neutral because nothing is verified yet: the signature is
// bound to a member id absent from the URL, so anyone could put these
// parameters in a link. Murph must not vouch for an unchecked payment.
export function SettingsAuthRequired(props: {
  addUsage?: boolean;
  billingReturn?: boolean;
  familyRecovery?: boolean;
  usageRecovery?: boolean;
}) {
  const copy = props.familyRecovery
    ? FAMILY_RECOVERY_COPY
    : props.usageRecovery
      ? USAGE_RECOVERY_COPY
      : props.billingReturn
        ? BILLING_RETURN_COPY
        : props.addUsage
          ? ADD_USAGE_COPY
          : ACCOUNT_COPY;

  return (
    <LinkPageCover>
      <SettingsSignIn copy={copy} />
    </LinkPageCover>
  );
}

function SettingsSignInStudy({ copy }: { copy: SettingsSignInCopy }) {
  return (
    <div className="flex min-h-[46rem] flex-col rounded-[2rem] bg-[#1C1915]">
      <LinkPageSurface>
        <SettingsSignIn copy={copy} />
      </LinkPageSurface>
    </div>
  );
}

// One source of copy for the live screen and its design study, so the catalog
// cannot drift from what a member returning from Stripe actually reads.
export function SettingsAuthRequiredView() {
  return <SettingsSignInStudy copy={BILLING_RETURN_COPY} />;
}

export function SettingsFamilyRecoveryAuthRequiredView() {
  return <SettingsSignInStudy copy={FAMILY_RECOVERY_COPY} />;
}

export function SettingsAccountAuthRequiredView() {
  return <SettingsSignInStudy copy={ACCOUNT_COPY} />;
}
