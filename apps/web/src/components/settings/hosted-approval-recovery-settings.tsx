"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  const [mode, setMode] = useState<Mode | null>(null);
  return <>
    <ApprovalPasskeyStatus action={<div className="flex flex-wrap justify-end gap-1">
      <Button type="button" size="sm" variant="ghost" aria-label="Save a recovery key" disabled={!enabled} onClick={() => setMode("rotate")}>Save key</Button>
      <Button type="button" size="sm" variant="ghost" aria-label="Use a recovery key" disabled={!enabled} onClick={() => setMode("recover")}>Use key</Button>
    </div>} />
    {mode ? <ApprovalRecoveryDialog mode={mode} onClose={() => setMode(null)} /> : null}
  </>;
}

export function ApprovalRecoveryDialog({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const { openAuthDialog } = useAuth();
  const { authorize } = useSensitiveActionAuthorization();
  const router = useRouter();
  const [key, setKey] = useState("");
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => { inFlight.current?.abort(); }, []);

  function close() { inFlight.current?.abort(); onClose(); }

  async function submit() {
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller; setPending(true); setError(null);
    try {
      if (mode === "rotate") {
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
      <Input id="approval-saved-recovery-key" value={savedKey} readOnly autoComplete="off" spellCheck={false} className="font-mono" />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void copyKey()}>{copied ? "Copied" : "Copy key"}</Button>
        <Button type="button" size="sm" variant="outline" onClick={downloadKey}>Download key</Button>
        <Button type="button" size="sm" className="ml-auto" onClick={close}>Done</Button>
      </div>
    </>;
    if (recovered) return <>
      <SettingsStatusLine message="Your passkey is replaced. Other devices need to sign in again. Save a new recovery key for next time." tone="success" />
      <Button type="button" onClick={close}>Done</Button>
    </>;
    return <>
      {mode === "recover" ? <>
        <Label htmlFor="approval-recovery-key">Saved recovery key</Label>
        <Input id="approval-recovery-key" type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" autoFocus spellCheck={false} disabled={pending} />
      </> : null}
      <Button type="button" disabled={pending || (mode === "recover" && !key.trim())} onClick={() => void submit()}>
        {pending ? "Working…" : mode === "recover" ? "Replace passkey" : "Create recovery key"}
      </Button>
    </>;
  }

  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{mode === "recover" ? "Recover your passkey" : savedKey ? "Save your recovery key" : "Create a recovery key"}</DialogTitle>
        <DialogDescription>{savedKey
          ? "This key is shown only once. Save it somewhere private, separate from your passkey."
          : mode === "recover"
            ? "Using your key replaces all previous passkeys and signs out your other devices."
            : "A backup if you lose your passkey. Creating a new key replaces any previous recovery key."}</DialogDescription></DialogHeader>
      <div className="flex flex-col gap-3">{content()}{error ? <SettingsStatusLine message={error} tone="destructive" /> : null}</div>
    </DialogContent>
  </Dialog>;
}
