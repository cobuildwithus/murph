"use client";

import { CircleCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { HostedContactCodeForm } from "@/src/components/hosted-onboarding/hosted-contact-code-form";
import { HostedTelegramProofButton } from "@/src/components/hosted-onboarding/hosted-telegram-proof-button";
import { useApprovalPasskeyEnrollment } from "@/src/components/sensitive-actions/use-approval-passkey-enrollment";
import { InitialPasskeySetupView } from "./hosted-passkey-settings";
import { useSensitiveActionAuthorization } from "@/src/components/sensitive-actions/use-sensitive-action-authorization";
import { Button } from "@/src/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import type { HostedCredentialChange } from "@/src/lib/better-auth/credential-change";
import type { SensitiveActionChallengeResponse } from "@/src/lib/sensitive-actions/shared";
import { SettingsStatusLine } from "./connected-account-card";
import { formatMaskedPhoneNumber } from "./hosted-settings-utils";

type Methods = Record<HostedCredentialChange["method"], string | null>;
type MethodResponse = { ok: true; methods: Methods; initialMessagingSetupAllowed?: boolean; requiresLogin?: false } | { ok: true; requiresLogin: true };

function allowsInitialMessagingSetup(state: MethodResponse | null, method: HostedCredentialChange["method"], operation: HostedCredentialChange["operation"]) {
  return method !== "email" && operation === "set" && state !== null
    && !state.requiresLogin && state.initialMessagingSetupAllowed === true;
}

function loginMethodDialogCopy(method: HostedCredentialChange["method"], operation: HostedCredentialChange["operation"], previous: string | null, saved: boolean) {
  const label = method === "telegram" ? "Telegram" : method;
  if (saved) {
    const name = { email: "Email", phone: "Phone number", telegram: "Telegram" }[method];
    const action = operation === "remove" ? "removed" : previous ? "updated" : "added";
    const destination = { email: "this email", phone: "this phone number", telegram: "Telegram" }[method];
    return {
      title: `${name} ${action}`,
      description: operation === "remove"
        ? "This sign-in method is disconnected. Your other devices have been signed out."
        : `You can now sign in with ${destination}.`,
    };
  }
  return {
    title: `${operation === "remove" ? "Remove" : previous ? "Change" : "Add"} ${label}`,
    description: operation === "remove" || previous
      ? "This changes where you can sign in and message Murph. Other sessions will be signed out; this browser stays signed in."
      : null,
  };
}

export function HostedLoginMethodEditor({ method, operation, onOpenChange, onSaved, onActiveChange, presentation = "dialog" }: {
  presentation?: "dialog" | "inline";
  method: HostedCredentialChange["method"];
  operation: HostedCredentialChange["operation"];
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  onActiveChange?: (active: boolean) => void;
}) {
  const router = useRouter();
  const { openAuthDialog } = useAuth();
  const approval = useSensitiveActionAuthorization();
  const enrollment = useApprovalPasskeyEnrollment();
  const loading = useRef<Promise<MethodResponse> | null>(null);
  const [current, setCurrent] = useState<MethodResponse | null>(null);
  const [initialPasskeyNeeded, setInitialPasskeyNeeded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const [telegram, setTelegram] = useState<{ idToken: string; change: HostedCredentialChange; challenge: SensitiveActionChallengeResponse | null } | null>(null);
  const methods = current && !current.requiresLogin ? current.methods : null;
  const previous = methods?.[method] ?? null;
  const initialMessagingSetup = allowsInitialMessagingSetup(current, method, operation);
  const label = method === "telegram" ? "Telegram" : method;
  const needsInitialPasskey = initialPasskeyNeeded && !initialMessagingSetup;
  const verifyLabel = initialMessagingSetup ? "Verify phone" : "Approve and save";
  const showSavedConfirmation = saved && presentation === "dialog";

  useEffect(() => {
    const controller = new AbortController();
    mounted.current = true;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    const task = Promise.all([
      requestHostedOnboardingJson<MethodResponse>({ url: "/api/settings/login-methods", signal }),
      requestHostedOnboardingJson<{ initialEnrollmentAllowed: boolean }>({ url: "/api/settings/approval-passkeys", signal }),
    ]).then(([state, factors]) => {
      if (!controller.signal.aborted) { setCurrent(state); setInitialPasskeyNeeded(factors.initialEnrollmentAllowed === true); }
      return state;
    });
    loading.current = task;
    void task.catch((caught: unknown) => {
      if (!controller.signal.aborted) setError(signal.aborted ? "Connection options could not load. Try again." : caught instanceof Error ? caught.message : "Settings could not load. Try again.");
    });
    return () => { mounted.current = false; controller.abort(); };
  }, [attempt, enrollment.registered]);

  async function readActionMethods(signal?: AbortSignal) {
    const state = await loading.current;
    if (signal?.aborted || !mounted.current) throw new DOMException("Canceled", "AbortError");
    if (!state || state.requiresLogin) throw new Error("Sign in again to connect your account.");
    return state;
  }

  function change(value: string | null): HostedCredentialChange {
    return { method, operation, expectedIdentity: previous, value };
  }

  async function commit(selected: HostedCredentialChange, extra: Record<string, unknown>, signal?: AbortSignal) {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setError(null);
    try {
      const state = await readActionMethods(signal);
      const challenge = allowsInitialMessagingSetup(state, method, operation) ? null : telegram?.challenge ?? await requestHostedOnboardingJson<SensitiveActionChallengeResponse>({
        url: "/api/settings/login-methods/challenge", payload: { change: selected }, signal,
      });
      if (signal?.aborted || !mounted.current) return;
      const authorization = challenge ? await approval.signChallenge(challenge, selected) : undefined;
      if (signal?.aborted || !mounted.current) return;
      const suffix = selected.operation === "remove" ? "remove" : selected.method === "telegram" ? "telegram/verify" : "otp/verify";
      try {
        const result = await requestHostedOnboardingJson<{ ok: true }>({
          url: `/api/settings/login-methods/${suffix}`, payload: { change: selected, authorization, ...extra }, signal,
        });
        if (result.ok !== true) throw new Error("The account change could not be confirmed. Refresh Settings.");
        if (mounted.current) { setSaved(true); onSaved?.(); }
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
    if (showSavedConfirmation) content = <Button type="button" size="xl" onClick={() => onOpenChange(false)}>Done</Button>;
    else if (current?.requiresLogin) content = <>
      <p className="text-sm text-muted-foreground">Sign in to approve changes to your login methods.</p>
      <Button type="button" size="xl" onClick={() => { onOpenChange(false); openAuthDialog(); }}>Sign in to continue</Button>
    </>;
    else if (needsInitialPasskey) content = <>
      <p className="text-sm text-muted-foreground">Set up a passkey to protect changes to your connected accounts.</p>
      <InitialPasskeySetupView enrollmentEnabled {...enrollment} onEnroll={() => void enrollment.enroll()} />
    </>;
    else if (!methods && presentation !== "inline") content = null;
    else if (operation === "remove") content = <>
      <p className="break-words text-sm">{method === "phone" && previous ? formatMaskedPhoneNumber(previous) : method === "email" ? previous : "Your connected Telegram account"}</p>
      {Object.values(methods ?? {}).filter(Boolean).length <= 1 ? <p className="text-sm text-muted-foreground">Add another login method before removing this one.</p>
        : <Button type="button" size="xl" variant="destructive" disabled={pending || !previous} onClick={() => void submitChange(change(null), {})}>{pending ? "Removing..." : `Approve and remove ${label}`}</Button>}
    </>;
    else if (method === "telegram") content = telegram ? <>
      <p className="text-sm text-muted-foreground">Telegram is verified. Approve this account change with your passkey.</p>
      <Button type="button" size="xl" disabled={pending} onClick={() => void submitChange(telegram.change, { idToken: telegram.idToken })}>{pending ? "Saving..." : "Approve and save"}</Button>
      <Button type="button" size="xl" variant="ghost" disabled={pending} onClick={() => { setTelegram(null); setError(null); }}>Use another Telegram account</Button>
    </> : <HostedTelegramProofButton purpose="credential" label="Connect Telegram" onProof={async (idToken, signal) => {
      await readActionMethods(signal);
      const prepared = await requestHostedOnboardingJson<{ change: HostedCredentialChange; challenge: SensitiveActionChallengeResponse | null }>({
        url: "/api/settings/login-methods/telegram/prepare", payload: { idToken }, signal,
      });
      if (prepared.change.method !== "telegram" || prepared.change.operation !== "set" || prepared.change.expectedIdentity !== previous) {
        throw new Error("Your Telegram connection changed. Reopen Settings and try again.");
      }
      if (signal.aborted) return;
      if (prepared.challenge === null) await commit(prepared.change, { idToken }, signal);
      else setTelegram({ ...prepared, idToken });
    }} />;
    else content = <HostedContactCodeForm method={method} onActiveChange={onActiveChange} autoSubmit={initialMessagingSetup} verifyLabel={verifyLabel}
      onSend={async (value, signal) => {
        await readActionMethods(signal);
        const result = await requestHostedOnboardingJson<{ ok: true }>({ url: "/api/settings/login-methods/otp/send", payload: { change: change(value) }, signal });
        if (result.ok !== true) throw new Error("The code could not be sent. Try again.");
      }}
      onVerify={(value, code, signal) => commit(change(value), { code }, signal)}
    />;
    return content;
  }

  const body = <div className="flex flex-col gap-4" inert={presentation === "inline" && saved}>{renderContent()}{error && !saved ? <>
    <SettingsStatusLine message={error} tone="destructive" />
    {!methods ? <Button type="button" size="xl" variant="outline" onClick={() => { setError(null); setAttempt((value) => value + 1); }}>Try again</Button> : null}
  </> : null}</div>;
  if (presentation === "inline") return body;
  const copy = loginMethodDialogCopy(method, operation, previous, showSavedConfirmation);
  return <Dialog open onOpenChange={onOpenChange}>
    <DialogContent className="max-w-[min(30rem,calc(100vw-2rem))] gap-6 border border-border/80 bg-popover p-6 text-popover-foreground ring-border sm:max-w-[30rem] md:p-8">
      <DialogHeader className="gap-2 pr-10" aria-live="polite" aria-atomic="true">
        {showSavedConfirmation ? <CircleCheck className="mb-2 size-8 text-primary" strokeWidth={1.6} aria-hidden="true" /> : null}
        <DialogTitle className="font-serif text-2xl/8 font-semibold tracking-normal text-popover-foreground">{copy.title}</DialogTitle>
        {copy.description && <DialogDescription className="max-w-[34ch] text-base/7 text-muted-foreground">
          {copy.description}
        </DialogDescription>}
      </DialogHeader>
      {body}
    </DialogContent>
  </Dialog>;
}

export { HostedLoginMethodEditor as HostedLoginMethodDialog };
