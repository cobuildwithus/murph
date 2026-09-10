"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { HostedContactCodeForm } from "@/src/components/hosted-onboarding/hosted-contact-code-form";
import { HostedTelegramProofButton } from "@/src/components/hosted-onboarding/hosted-telegram-proof-button";
import { useSensitiveActionAuthorization } from "@/src/components/sensitive-actions/use-sensitive-action-authorization";
import { Button } from "@/src/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import type { HostedCredentialChange } from "@/src/lib/better-auth/credential-change";
import type { SensitiveActionChallengeResponse } from "@/src/lib/sensitive-actions/shared";
import { SettingsStatusLine } from "./connected-account-card";
import { formatMaskedPhoneNumber } from "./hosted-settings-utils";

type Methods = Record<HostedCredentialChange["method"], string | null>;
type MethodResponse = { ok: true; methods: Methods; requiresLogin?: false } | { ok: true; requiresLogin: true };

export function HostedLoginMethodDialog({ method, operation, onOpenChange }: {
  method: HostedCredentialChange["method"];
  operation: HostedCredentialChange["operation"];
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { openAuthDialog } = useAuth();
  const approval = useSensitiveActionAuthorization();
  const [current, setCurrent] = useState<MethodResponse | null>(null);
  const [initialPasskeyNeeded, setInitialPasskeyNeeded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const [telegram, setTelegram] = useState<{ idToken: string; change: HostedCredentialChange; challenge: SensitiveActionChallengeResponse } | null>(null);
  const methods = current && !current.requiresLogin ? current.methods : null;
  const previous = methods?.[method] ?? null;
  const label = method === "telegram" ? "Telegram" : method;

  useEffect(() => {
    const controller = new AbortController();
    mounted.current = true;
    void Promise.all([
      requestHostedOnboardingJson<MethodResponse>({ url: "/api/settings/login-methods", signal: controller.signal }),
      requestHostedOnboardingJson<{ initialEnrollmentAllowed: boolean }>({ url: "/api/settings/approval-passkeys", signal: controller.signal }),
    ]).then(([state, factors]) => {
      if (controller.signal.aborted) return;
      setCurrent(state); setInitialPasskeyNeeded(factors.initialEnrollmentAllowed === true);
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Settings could not load. Try again.");
    });
    return () => { mounted.current = false; controller.abort(); };
  }, [attempt]);

  function change(value: string | null): HostedCredentialChange {
    return { method, operation, expectedIdentity: previous, value };
  }

  async function commit(selected: HostedCredentialChange, extra: Record<string, unknown>, signal?: AbortSignal) {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setError(null);
    try {
      const challenge = telegram?.challenge ?? await requestHostedOnboardingJson<SensitiveActionChallengeResponse>({
        url: "/api/settings/login-methods/challenge", payload: { change: selected }, signal,
      });
      if (signal?.aborted || !mounted.current) return;
      const authorization = await approval.signChallenge(challenge, selected);
      if (signal?.aborted || !mounted.current) return;
      const suffix = selected.operation === "remove" ? "remove" : selected.method === "telegram" ? "telegram/verify" : "otp/verify";
      try {
        const result = await requestHostedOnboardingJson<{ ok: true }>({
          url: `/api/settings/login-methods/${suffix}`, payload: { change: selected, authorization, ...extra }, signal,
        });
        if (result.ok !== true) throw new Error("The account change could not be confirmed. Refresh Settings.");
        if (mounted.current) setSaved(true);
      } finally {
        // A lost response can follow a committed change. Always refresh the
        // canonical page; never replay a destructive request automatically.
        router.refresh();
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  async function submitChange(selected: HostedCredentialChange, extra: Record<string, unknown>) {
    try { await commit(selected, extra); }
    catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : "The change could not be saved. Try again."); }
  }

  function renderContent() {
    let content;
    if (saved) content = <>
      <SettingsStatusLine message={operation === "remove" ? `${label === "Telegram" ? label : "Your " + label} was removed.` : "Your account is updated."} tone="success" />
      <Button type="button" onClick={() => onOpenChange(false)}>Done</Button>
    </>;
    else if (current?.requiresLogin) content = <>
      <p className="text-sm text-muted-foreground">Sign in to approve changes to your login methods.</p>
      <Button type="button" onClick={() => { onOpenChange(false); openAuthDialog(); }}>Sign in to continue</Button>
    </>;
    else if (initialPasskeyNeeded) content = <>
      <p className="text-sm text-muted-foreground">Set up a passkey in Security to approve account changes.</p>
      <Button type="button" onClick={() => { onOpenChange(false); window.location.hash = "security"; }}>Set up passkey</Button>
    </>;
    else if (!methods) content = error ? <Button type="button" variant="outline" onClick={() => { setError(null); setAttempt((value) => value + 1); }}>Try again</Button>
      : <p role="status" className="text-sm text-muted-foreground">Checking your login methods...</p>;
    else if (operation === "remove") content = <>
      <p className="break-words text-sm">{method === "phone" && previous ? formatMaskedPhoneNumber(previous) : method === "email" ? previous : "Your connected Telegram account"}</p>
      {Object.values(methods).filter(Boolean).length <= 1 ? <p className="text-sm text-muted-foreground">Add another login method before removing this one.</p>
        : <Button type="button" variant="destructive" disabled={pending || !previous} onClick={() => void submitChange(change(null), {})}>{pending ? "Removing..." : `Approve and remove ${label}`}</Button>}
    </>;
    else if (method === "telegram") content = telegram ? <>
      <p className="text-sm text-muted-foreground">Telegram is verified. Approve this account change with your passkey.</p>
      <Button type="button" disabled={pending} onClick={() => void submitChange(telegram.change, { idToken: telegram.idToken })}>{pending ? "Saving..." : "Approve and save"}</Button>
      <Button type="button" variant="ghost" disabled={pending} onClick={() => { setTelegram(null); setError(null); }}>Use another Telegram account</Button>
    </> : <HostedTelegramProofButton purpose="credential" onProof={async (idToken, signal) => {
      const prepared = await requestHostedOnboardingJson<{ change: HostedCredentialChange; challenge: SensitiveActionChallengeResponse }>({
        url: "/api/settings/login-methods/telegram/prepare", payload: { idToken }, signal,
      });
      if (prepared.change.method !== "telegram" || prepared.change.operation !== "set" || prepared.change.expectedIdentity !== previous) {
        throw new Error("Your Telegram connection changed. Reopen Settings and try again.");
      }
      if (!signal.aborted) setTelegram({ ...prepared, idToken });
    }} />;
    else content = <HostedContactCodeForm method={method} autoSubmit={false} verifyLabel="Approve and save"
      onSend={async (value, signal) => {
        const result = await requestHostedOnboardingJson<{ ok: true }>({ url: "/api/settings/login-methods/otp/send", payload: { change: change(value) }, signal });
        if (result.ok !== true) throw new Error("The code could not be sent. Try again.");
      }}
      onVerify={(value, code, signal) => commit(change(value), { code }, signal)}
    />;
    return content;
  }

  return <Dialog open onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{operation === "remove" ? "Remove" : previous ? "Change" : "Add"} {label}</DialogTitle>
        <DialogDescription>{operation === "remove" || previous
          ? "This changes where you can sign in and message Murph. Other sessions will be signed out; this browser stays signed in."
          : "Add a way to sign in and message Murph. Your existing sessions stay signed in."}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">{renderContent()}{error && !saved ? <SettingsStatusLine message={error} tone="destructive" /> : null}</div>
    </DialogContent>
  </Dialog>;
}
