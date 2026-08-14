"use client";

import { EmailIcon } from "@/src/components/homepage/email-icon";
import { HostedPrivyReadinessState } from "@/src/components/hosted-onboarding/hosted-auth-panel-island";
import { HostedInlineAuthButton } from "@/src/components/hosted-onboarding/hosted-inline-auth-button";
import {
  HostedCodeEntryStep,
  HostedPhoneEntryStep,
} from "@/src/components/hosted-onboarding/hosted-phone-auth-step-views";
import { HOSTED_PHONE_COUNTRY_OPTIONS } from "@/src/components/hosted-onboarding/hosted-phone-country-options";
import { HostedTelegramAuthButtonPresentation } from "@/src/components/hosted-onboarding/hosted-telegram-auth-button";

export function HomepageAuthWarmRuntimeStudy() {
  return (
    <div
      className="grid gap-5 lg:grid-cols-2"
      data-design-section="homepage-auth-warm-runtime"
      id="homepage-auth-warm-runtime"
    >
      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Idle warmup
        </p>
        <h3 className="mt-3 font-serif text-2xl font-semibold tracking-tight text-foreground">
          Ready before the click
        </h3>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          After the homepage paints, the shared Privy provider may initialize in
          the background. The dialog, authentication controls, and CAPTCHA stay
          unmounted until someone chooses Log in or Signup. Once open, the
          ordinary form stays usable even if provider initialization is still
          finishing.
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Authenticated preparation
        </p>
        <h3 className="mt-3 font-serif text-2xl font-semibold tracking-tight text-foreground">
          Prepare data, not a download
        </h3>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          After the homepage responds, the server may request a low-priority
          dashboard data refresh using current access and consent. The replica
          stays out of the homepage and browser until the member opens the
          dashboard, and preparation failure never blocks the page.
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-card p-6" inert>
        <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Provider still initializing
        </p>
        <HomepageAuthFormStudy />
      </div>
      <div className="rounded-2xl border border-border bg-card p-6" inert>
        <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Phone selected before ready
        </p>
        <HomepageAuthFormStudy phoneQueued />
      </div>
      <div
        className="scroll-mt-20 rounded-2xl border border-border bg-card p-6"
        id="homepage-auth-pasted-phone-code-sent"
        inert
      >
        <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Valid phone pasted · code sent
        </p>
        <HostedCodeEntryStep
          autoFocus={false}
          code=""
          disabled={false}
          pendingAction={null}
          secondaryActionSize="lg"
          verificationPhoneNumberHint="*** 2671"
          onCodeChange={() => {}}
          onResendCode={() => {}}
          onUseDifferentNumber={() => {}}
          onVerifyCode={() => {}}
        />
      </div>
      <div className="rounded-2xl border border-border bg-card p-6" inert>
        <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Telegram selected before ready
        </p>
        <HomepageAuthFormStudy telegramQueued />
      </div>
      <div
        className="rounded-2xl border border-border bg-card p-6 lg:col-span-2"
        inert
      >
        <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Telegram ready for its trusted click
        </p>
        <div className="grid max-w-xl grid-cols-2 gap-3">
          <HostedTelegramAuthButtonPresentation
            active
            onClick={() => {}}
            readyToContinue
          />
          <HostedInlineAuthButton
            icon={<EmailIcon className="h-5 w-5" />}
            onClick={() => {}}
          >
            Email
          </HostedInlineAuthButton>
        </div>
      </div>
    </div>
  );
}

function HomepageAuthFormStudy({
  phoneQueued = false,
  telegramQueued = false,
}: {
  phoneQueued?: boolean;
  telegramQueued?: boolean;
}) {
  const authWaiting = phoneQueued || telegramQueued;

  return (
    <div className="space-y-4">
      <HostedPhoneEntryStep
        pendingAction={phoneQueued ? "send-code" : null}
        phoneInputDisabled={telegramQueued}
        phoneCountryOptions={HOSTED_PHONE_COUNTRY_OPTIONS}
        phoneNumber="415 555 2671"
        sendCodeDisabled={authWaiting}
        selectedPhoneCountry={resolveStudyPhoneCountry()}
        onPhoneCountryChange={() => {}}
        onPhoneNumberChange={() => {}}
        onSubmitPhoneEntry={() => {}}
      />
      <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        OR
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <HostedTelegramAuthButtonPresentation
          active={telegramQueued}
          disabled={authWaiting}
          loading={telegramQueued}
          onClick={() => {}}
        />
        <HostedInlineAuthButton
          disabled={authWaiting}
          icon={<EmailIcon className="h-5 w-5" />}
          onClick={() => {}}
        >
          Email
        </HostedInlineAuthButton>
      </div>
      {authWaiting ? (
        <HostedPrivyReadinessState
          onRestart={() => {}}
          restartAvailable={false}
        />
      ) : null}
    </div>
  );
}

function resolveStudyPhoneCountry() {
  const option =
    HOSTED_PHONE_COUNTRY_OPTIONS.find((candidate) => candidate.code === "US")
    ?? HOSTED_PHONE_COUNTRY_OPTIONS[0];

  if (!option) {
    throw new Error("Phone country options are empty.");
  }

  return option;
}
