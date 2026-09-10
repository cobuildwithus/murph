"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/src/components/ui/button";
import { HostedLegalConsentCard } from "@/src/components/legal/hosted-legal-consent-card";
import { SettingsStatusLine } from "@/src/components/settings/connected-account-card";
import { HOSTED_APP_HOME_PATH } from "@/src/lib/hosted-onboarding/app-routes";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import { requestHostedOnboardingJson } from "./client-api";
import { declineHostedLaunchConsent, logoutHostedAppSession, verifyHostedAppSession } from "./hosted-app-session-client";
import { HostedAuthLegalNotice } from "./hosted-auth-shared";
import { HostedContactCodeForm } from "./hosted-contact-code-form";
import { HostedTelegramProofButton } from "./hosted-telegram-proof-button";
import { navigateHostedAuthRedirect } from "./hosted-auth-navigation";

type Method = "phone" | "email" | "telegram";
export type HostedFirstPartyAuthPanelView = "auth" | "auth-active" | "consent";
export interface HostedFirstPartyAuthPanelProps {
  autoSendPastedPhoneNumber?: boolean;
  inviteCode?: string | null;
  initialEmailAddress?: string;
  methods: readonly Method[];
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
  onViewChange?: (view: HostedFirstPartyAuthPanelView) => void;
  phoneInputAutoFocus?: boolean;
  requireLaunchConsentOnCompletion?: boolean;
  showPassiveLegalNotice?: boolean;
  size?: "default" | "compact";
}

export function HostedFirstPartyAuthPanel({
  methods, inviteCode, initialEmailAddress, onCompleted, onSignOut, onViewChange,
  requireLaunchConsentOnCompletion = false, showPassiveLegalNotice = false,
  autoSendPastedPhoneNumber = false, phoneInputAutoFocus = false,
}: HostedFirstPartyAuthPanelProps) {
  const [method, setMethod] = useState<Method>(methods[0] ?? "phone");
  const [step, setStep] = useState<"entry" | "resume" | "consent">("entry");
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completion, setCompletion] = useState<HostedPrivyCompletionPayload | null>(null);
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const ending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current?.abort(); };
  }, []);
  const view = step === "consent" ? "consent" : active || step === "resume" ? "auth-active" : "auth";
  useLayoutEffect(() => { onViewChange?.(view); }, [onViewChange, view]);

  async function complete() {
    if (operation.current || ending.current || !mounted.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true); setError(null);
    try {
      const payload = await requestHostedOnboardingJson<HostedPrivyCompletionPayload>({
        url: "/api/auth/complete", method: "POST", payload: {}, signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (requireLaunchConsentOnCompletion && !payload.launchConsentGranted
        && (payload.stage === "checkout" || isHostedOnboardingAccessibleStage(payload.stage))) {
        setCompletion(payload); setStep("consent"); return;
      }
      if (onCompleted) await onCompleted(payload);
      else navigateHostedAuthRedirect(isHostedOnboardingAccessibleStage(payload.stage) ? HOSTED_APP_HOME_PATH : payload.joinUrl);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Your account could not load. Try again.");
    } finally {
      if (!controller.signal.aborted) { operation.current = null; setPending(false); }
    }
  }

  async function verify(url: "/api/auth/otp/verify" | "/api/auth/telegram/verify", payload: Record<string, unknown>, signal: AbortSignal) {
    await verifyHostedAppSession({ url, payload: { ...payload, ...signupContext(inviteCode) }, signal });
    if (signal.aborted || !mounted.current) return;
    setStep("resume"); setActive(false);
    await complete();
  }

  async function endSession(decline: boolean) {
    if (ending.current) return;
    ending.current = true;
    operation.current?.abort(); operation.current = null;
    setPending(true); setDeclining(decline); setError(null);
    try {
      if (decline) await declineHostedLaunchConsent();
      else await logoutHostedAppSession();
      if (!mounted.current) return;
      setCompletion(null); setStep("entry"); setActive(false);
      try { await onSignOut?.(); } catch { /* The server session has already ended. */ }
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : "Sign-out could not be confirmed. Try again.");
    } finally {
      ending.current = false;
      if (mounted.current) { setPending(false); setDeclining(false); }
    }
  }

  return <div className="flex flex-col gap-4">
    {step === "consent" && completion ? <HostedLegalConsentCard
      declinePending={declining} initialStatus={completion.launchConsentStatus} mode="compact"
      onAccepted={() => complete()} onDecline={() => void endSession(true)}
      onRequirementChange={(required) => { if (!required) void complete(); }}
      preferredScope="launch.legal" source="homepage-auth-dialog"
    /> : step === "resume" ? <>
      <p className="text-sm text-muted-foreground">You’re signed in. Continue to your account.</p>
      <Button type="button" disabled={pending} onClick={() => void complete()}>{pending ? "Loading your account..." : "Continue"}</Button>
      <Button type="button" variant="ghost" disabled={pending} onClick={() => void endSession(false)}>Use a different account</Button>
    </> : <>
      {method === "telegram" ? <HostedTelegramProofButton key="telegram" purpose="login"
        onProof={(idToken, signal) => verify("/api/auth/telegram/verify", { idToken }, signal)} />
        : <HostedContactCodeForm key={method} method={method} autoFocus={phoneInputAutoFocus}
          initialValue={method === "email" ? initialEmailAddress : undefined}
          autoSendPastedPhoneNumber={autoSendPastedPhoneNumber} onActiveChange={setActive}
          onSend={async (value, signal) => {
            const result = await requestHostedOnboardingJson<{ ok: true }>({ url: "/api/auth/otp/send", payload: { kind: method, value }, signal });
            if (result.ok !== true) throw new Error("The code could not be sent. Try again.");
          }}
          onVerify={(value, code, signal) => verify("/api/auth/otp/verify", { kind: method, value, code }, signal)}
        />}
      {!active ? <div className="flex flex-wrap gap-2">
        {methods.filter((entry) => entry !== method).map((entry) => <Button key={entry} type="button" variant="outline" className="flex-1" onClick={() => { setMethod(entry); setError(null); }}>
          {entry === "phone" ? "Use phone" : entry === "email" ? "Use email" : "Use Telegram"}
        </Button>)}
      </div> : null}
      {showPassiveLegalNotice ? <HostedAuthLegalNotice /> : null}
    </>}
    {error ? <SettingsStatusLine message={error} tone="destructive" /> : null}
  </div>;
}

function signupContext(inviteCode?: string | null) {
  let timeZone: string | undefined;
  try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* The server owns the fallback. */ }
  return { ...(inviteCode ? { inviteCode } : {}), ...(timeZone ? { timeZone } : {}) };
}
