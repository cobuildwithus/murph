"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { HostedOnboardingApiError, requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { useSensitiveActionAuthorization } from "@/src/components/sensitive-actions/use-sensitive-action-authorization";
import { Button } from "@/src/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { SettingsStatusLine } from "./connected-account-card";
import { ApprovalPasskeyStatus } from "./approval-passkey-status";

type Mode = "rotate" | "recover";
const ROOT = "/api/settings/approval-passkeys";

export function HostedApprovalRecoverySettings({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <ApprovalPasskeyStatus action={
      <Button type="button" size="sm" variant="ghost" disabled={!enabled} onClick={() => setOpen(true)}>Recovery key</Button>
    } />
    {open ? <ApprovalRecoveryDialog onClose={() => setOpen(false)} /> : null}
  </>;
}

export function ApprovalRecoveryDialog({ onClose }: { onClose: () => void }) {
  const { openAuthDialog } = useAuth();
  const { authorize } = useSensitiveActionAuthorization();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("rotate");
  const [key, setKey] = useState("");
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => { inFlight.current?.abort(); }, []);

  function close() { inFlight.current?.abort(); onClose(); }

  async function submit(action: Mode) {
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller; setPending(true); setError(null);
    try {
      if (action === "rotate") {
        const authorization = await authorize("approval.recovery-key.rotate");
        if (controller.signal.aborted) return;
        const result = await requestHostedOnboardingJson<{ key: string }>({ url: `${ROOT}/recovery-key`, payload: { authorization }, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (typeof result.key !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(result.key)) throw new Error("Your recovery key could not be confirmed. Create another key before relying on it.");
        setSavedKey(result.key);
      } else {
        const input = key.trim();
        const result = await requestHostedOnboardingJson<{ token: string; options: PublicKeyCredentialCreationOptionsJSON }>({ url: `${ROOT}/recovery/options`, payload: { key: input }, signal: controller.signal });
        if (controller.signal.aborted) return;
        const response = await startRegistration({ optionsJSON: result.options });
        if (controller.signal.aborted) return;
        try {
          const completed = await requestHostedOnboardingJson<{ recovered: true }>({ url: `${ROOT}/recovery/register`, payload: { key: input, token: result.token, response }, signal: controller.signal });
          if (controller.signal.aborted) return;
          if (completed.recovered !== true) throw new Error("Passkey recovery could not be confirmed. Refresh Settings before trying again.");
          setRecovered(true); setKey("");
        } finally { router.refresh(); }
      }
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (caught instanceof HostedOnboardingApiError && caught.code === "SENSITIVE_ACTION_FRESH_LOGIN_REQUIRED") {
        close(); openAuthDialog(); return;
      }
      setError(caught instanceof Error ? caught.message : "Recovery could not finish. Please try again.");
    } finally {
      if (!controller.signal.aborted) { inFlight.current = null; setPending(false); }
    }
  }

  async function copyKey() {
    if (!savedKey) return;
    try { await navigator.clipboard.writeText(savedKey); setCopied(true); setError(null); }
    catch { setError("Select and copy the key above, then save it somewhere safe."); }
  }

  function downloadKey() {
    if (!savedKey) return;
    const url = URL.createObjectURL(new Blob([savedKey + "\n"], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "murph-recovery-key.txt";
    document.body.append(link);
    link.click(); link.remove();
    URL.revokeObjectURL(url);
  }

  function content() {
    if (savedKey) return <>
      <Label htmlFor="approval-saved-recovery-key" className="sr-only">Recovery key</Label>
      <Input id="approval-saved-recovery-key" inputSize="xl" value={savedKey} readOnly autoComplete="off" spellCheck={false} className="font-mono" />
      <div className="grid grid-cols-2 gap-3">
        <Button type="button" size="lg" variant="outline" onClick={() => void copyKey()}>{copied ? "Copied" : "Copy"}</Button>
        <Button type="button" size="lg" variant="outline" onClick={downloadKey}>Download</Button>
      </div>
      <Button type="button" size="xl" onClick={close}>Done</Button>
    </>;
    if (recovered) return <>
      <p className="text-sm text-muted-foreground">Save a new recovery key for next time. The one you used is no longer valid.</p>
      <Button type="button" size="xl" disabled={pending} onClick={() => void submit("rotate")}>{pending ? "Working…" : "Create recovery key"}</Button>
      <Button type="button" size="lg" variant="ghost" onClick={close}>Done</Button>
    </>;
    return <>
      {mode === "recover" ? <>
        <Label htmlFor="approval-recovery-key">Saved recovery key</Label>
        <Input id="approval-recovery-key" inputSize="xl" type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" autoFocus spellCheck={false} disabled={pending} />
      </> : null}
      <Button type="button" size="xl" disabled={pending || (mode === "recover" && !key.trim())} onClick={() => void submit(mode)}>
        {pending ? "Working…" : mode === "recover" ? "Replace passkey" : "Create recovery key"}
      </Button>
      {mode === "rotate"
        ? <Button type="button" size="xl" variant="outline" disabled={pending} onClick={() => { setError(null); setMode("recover"); }}>Use a recovery key</Button>
        : <Button type="button" size="lg" variant="ghost" disabled={pending} onClick={() => { setError(null); setKey(""); setMode("rotate"); }}>Back</Button>}
    </>;
  }

  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className="max-w-[min(30rem,calc(100vw-2rem))] gap-6 border border-border/80 bg-popover p-6 text-popover-foreground ring-border sm:max-w-[30rem] md:p-8">
      <DialogHeader className="gap-2 pr-10" aria-live="polite" aria-atomic="true">
        {recovered && !savedKey ? <CircleCheck className="mb-2 size-8 text-primary" strokeWidth={1.6} aria-hidden="true" /> : null}
        <DialogTitle className="font-serif text-2xl/8 font-semibold tracking-normal text-popover-foreground">{savedKey ? "Save your recovery key" : recovered ? "Passkey recovered" : mode === "recover" ? "Recover your passkey" : "Recovery key"}</DialogTitle>
        <DialogDescription className="max-w-[34ch] text-base/7 text-muted-foreground">{savedKey
          ? "This key is shown only once. Save it somewhere private, separate from your passkey."
          : recovered
            ? "Your new passkey is ready. Other devices have been signed out."
            : mode === "recover"
              ? "Using your key replaces all previous passkeys and signs out your other devices."
              : "A backup if you lose your passkey. Creating a new key replaces any previous recovery key."}</DialogDescription></DialogHeader>
      <div className="flex flex-col gap-4">{content()}{error ? <SettingsStatusLine message={error} tone="destructive" /> : null}</div>
    </DialogContent>
  </Dialog>;
}
