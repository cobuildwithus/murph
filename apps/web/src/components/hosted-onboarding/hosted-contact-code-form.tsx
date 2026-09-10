"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/src/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/src/components/ui/field";
import { Input } from "@/src/components/ui/input";
import { SettingsStatusLine } from "@/src/components/settings/connected-account-card";
import { maskPhoneNumber, normalizePhoneNumberForCountry } from "@/src/lib/hosted-onboarding/phone";
import { HostedPhoneEntryStep } from "./hosted-phone-auth-step-views";
import { HOSTED_PHONE_COUNTRY_OPTIONS } from "./hosted-phone-country-options";
import { usePhoneCountryCode } from "./phone-country-code-client-provider";
import { HostedVerificationCodeStep } from "./hosted-verification-code-step";

// Presentation and in-flight ownership shared by login and credential changes.
// Each caller retains its own proof, session and canonical mutation endpoints.
export function HostedContactCodeForm({
  method, onSend, onVerify, verifyLabel = "Continue", autoSubmit = true,
  onActiveChange, autoSendPastedPhoneNumber = false,
  autoFocus = false, initialValue = "",
}: {
  method: "email" | "phone";
  onSend: (value: string, signal: AbortSignal) => Promise<void>;
  onVerify: (value: string, code: string, signal: AbortSignal) => Promise<void>;
  verifyLabel?: string;
  autoSubmit?: boolean;
  autoSendPastedPhoneNumber?: boolean;
  autoFocus?: boolean;
  initialValue?: string;
  onActiveChange?: (active: boolean) => void;
}) {
  const inputId = useId();
  const countryHint = usePhoneCountryCode();
  const [countryCode, setCountryCode] = useState(countryHint ?? "US");
  const country = HOSTED_PHONE_COUNTRY_OPTIONS.find((entry) => entry.code === countryCode)
    ?? HOSTED_PHONE_COUNTRY_OPTIONS.find((entry) => entry.code === "US")!;
  const [draft, setDraft] = useState(initialValue);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const codeRef = useRef("");
  const [pending, setPending] = useState<"send-code" | "verify-code" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => { operation.current?.abort(); }, []);

  async function run(kind: "send-code" | "verify-code", action: (signal: AbortSignal) => Promise<void>) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(kind);
    setError(null);
    onActiveChange?.(true);
    try { await action(controller.signal); }
    catch (caught) {
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
        if (!sentTo) onActiveChange?.(false);
      }
    } finally {
      if (!controller.signal.aborted) {
        operation.current = null;
        setPending(null);
      }
    }
  }

  function send(value = draft, dialCode = country.dialCode) {
    const normalized = sentTo ?? (method === "email" ? value.trim().toLowerCase() : normalizePhoneNumberForCountry(value, dialCode));
    if (!normalized) { setError("Enter a valid phone number."); return; }
    void run("send-code", async (signal) => {
      await onSend(normalized, signal);
      if (signal.aborted) return;
      setSentTo(normalized);
      codeRef.current = "";
      setCode("");
    });
  }

  function verify() {
    if (!sentTo || !/^\d{6}$/u.test(codeRef.current)) {
      setError("Enter the six-digit code.");
      return;
    }
    void run("verify-code", (signal) => onVerify(sentTo, codeRef.current, signal));
  }

  return <div className="flex flex-col gap-4">
    {sentTo ? <HostedVerificationCodeStep
      autoSubmit={autoSubmit} code={code} disabled={pending !== null} pendingAction={pending}
      description={`We sent the latest code to ${method === "phone" ? maskPhoneNumber(sentTo) : sentTo}.`}
      primaryActionLabel={verifyLabel} primaryActionPendingLabel="Finishing..."
      onCodeChange={(value) => { codeRef.current = value.replace(/\D/gu, "").slice(0, 6); setCode(codeRef.current); }}
      onResendCode={() => send()} onSubmit={verify}
      secondaryAction={<Button type="button" variant="ghost" disabled={pending !== null} onClick={() => {
        setSentTo(null); setCode(""); codeRef.current = ""; setError(null); onActiveChange?.(false);
      }}>Use a different {method === "phone" ? "number" : "email"}</Button>}
    /> : method === "phone" ? <HostedPhoneEntryStep
      phoneInputAutoFocus={autoFocus}
      phoneNumber={draft} selectedPhoneCountry={country} phoneCountryOptions={HOSTED_PHONE_COUNTRY_OPTIONS}
      pendingAction={pending} phoneInputDisabled={pending !== null} sendCodeDisabled={pending !== null || !draft.trim()}
      onPhoneCountryChange={setCountryCode} onPhoneNumberChange={(value, metadata) => {
        setDraft(value);
        if (metadata && autoSendPastedPhoneNumber) {
          const pastedCountry = HOSTED_PHONE_COUNTRY_OPTIONS.find((entry) => entry.code === metadata.countryCode);
          send(value, pastedCountry?.dialCode ?? country.dialCode);
        }
      }}
      onSubmitPhoneEntry={(event) => { event.preventDefault(); send(); }}
    /> : <form onSubmit={(event) => { event.preventDefault(); send(); }}>
      <FieldGroup>
        <Field data-disabled={pending !== null}>
          <FieldLabel htmlFor={inputId}>Email</FieldLabel>
          <Input id={inputId} type="email" autoFocus={autoFocus} autoComplete="email" autoCapitalize="none" spellCheck={false}
            maxLength={320} required value={draft} disabled={pending !== null} onChange={(event) => setDraft(event.target.value)} />
        </Field>
        <Button type="submit" disabled={pending !== null || !draft.trim()} aria-busy={pending !== null}>
          {pending === "send-code" ? "Sending code..." : "Send verification code"}
        </Button>
      </FieldGroup>
    </form>}
    {error ? <SettingsStatusLine message={error} tone="destructive" /> : null}
  </div>;
}
