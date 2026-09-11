"use client";

import { useEffect, useRef, useState } from "react";
import { TelegramIcon } from "@/src/components/homepage/telegram-icon";
import { Spinner } from "@/src/components/ui/spinner";
import { HostedInlineAuthButton } from "./hosted-inline-auth-button";
import { Button } from "@/src/components/ui/button";
import { SettingsStatusLine } from "@/src/components/settings/connected-account-card";
import { requestHostedOnboardingJson } from "./client-api";

interface TelegramLogin {
  auth: (options: { client_id: number; nonce: string; scope: ["profile", "write"] }, callback: (value: unknown) => void) => void;
  close: () => void;
}
declare global { interface Window { Telegram?: { Login?: TelegramLogin } } }
let scriptLoad: Promise<TelegramLogin> | null = null;
let cancelActivePopup: (() => void) | null = null;

function loadTelegramLogin(): Promise<TelegramLogin> {
  if (window.Telegram?.Login) return Promise.resolve(window.Telegram.Login);
  if (scriptLoad) return scriptLoad;
  scriptLoad = new Promise<TelegramLogin>((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => { clearTimeout(timer); script.remove(); reject(new Error("Telegram could not load. Try again.")); };
    const timer = window.setTimeout(fail, 15_000);
    script.src = "https://telegram.org/js/telegram-login.js";
    script.async = true;
    script.onload = () => {
      if (!window.Telegram?.Login) { fail(); return; }
      clearTimeout(timer);
      resolve(window.Telegram.Login);
    };
    script.onerror = fail;
    document.head.appendChild(script);
  }).catch((error: unknown) => { scriptLoad = null; throw error; });
  return scriptLoad;
}

export function HostedTelegramProofButton({ purpose, onProof, label = "Continue with Telegram" }: {
  purpose: "login" | "credential";
  onProof: (idToken: string, signal: AbortSignal) => Promise<void>;
  label?: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState<{ api: TelegramLogin; clientId: number; nonce: string; expiresAt: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    current.current = controller;
    const start = purpose === "login" ? "/api/auth/telegram/start" : "/api/settings/login-methods/telegram/start";
    void Promise.all([
      loadTelegramLogin(),
      requestHostedOnboardingJson<{ ok: true; nonce: string; clientId: string }>({ url: start, method: "POST", payload: {}, signal: controller.signal }),
    ]).then(([api, proof]) => {
      if (controller.signal.aborted) return;
      const clientId = Number(proof.clientId);
      if (proof.ok !== true || !Number.isSafeInteger(clientId) || clientId <= 0 || !/^[A-Za-z0-9_-]{43}$/u.test(proof.nonce)) {
        throw new Error("Telegram could not start. Try again.");
      }
      setReady({ api, clientId, nonce: proof.nonce, expiresAt: Date.now() + 240_000 });
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Telegram could not start. Try again.");
    });
    return () => { controller.abort(); };
  }, [attempt, purpose]);

  function retry() {
    current.current?.abort();
    setReady(null); setPending(false); setError(null); setAttempt((value) => value + 1);
  }

  function open() {
    if (!ready || pending) return;
    if (ready.expiresAt <= Date.now()) { retry(); return; }
    cancelActivePopup?.();
    const controller = current.current;
    if (!controller || controller.signal.aborted) return;
    setPending(true); setError(null);
    let completed = false;
    const cancel = () => {
      setError("Another Telegram sign-in was opened. Try again here when it finishes.");
      controller.abort();
    };
    cancelActivePopup = cancel;
    const timeout = window.setTimeout(() => {
      if (!completed) { setError("Telegram did not finish. Try again and allow the sign-in window to open."); controller.abort(); }
    }, 120_000);
    const cleanup = () => {
      clearTimeout(timeout);
      if (cancelActivePopup === cancel) { cancelActivePopup = null; ready.api.close(); }
    };
    controller.signal.addEventListener("abort", cleanup, { once: true });
    try { ready.api.auth({ client_id: ready.clientId, nonce: ready.nonce, scope: ["profile", "write"] }, (result) => {
      if (completed || controller.signal.aborted) return;
      completed = true;
      cleanup();
      const token: unknown = result && typeof result === "object" ? Reflect.get(result, "id_token") : null;
      void (async () => {
        if (typeof token !== "string" || token.length === 0 || token.length > 8_192) throw new Error("Telegram sign-in was canceled. Try again.");
        await onProof(token, controller.signal);
      })().catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Telegram could not be verified. Try again.");
      }).finally(() => { if (!controller.signal.aborted) { setPending(false); setReady(null); } });
    }); } catch {
      cleanup(); setPending(false); setError("Telegram could not open. Try again.");
    }
  }

  return <div className="flex flex-col gap-3">
    {error ? <>
      <SettingsStatusLine message={error} tone="destructive" />
      <HostedInlineAuthButton icon={<TelegramIcon className="h-5 w-5" />} onClick={retry}>Try Telegram again</HostedInlineAuthButton>
    </> : <HostedInlineAuthButton busy={!ready || pending} disabled={!ready || pending} onClick={open}
      icon={!ready || pending ? <Spinner aria-hidden="true" /> : <TelegramIcon className="h-5 w-5" />}>
      {pending ? "Waiting for Telegram..." : ready ? label : "Preparing Telegram..."}
    </HostedInlineAuthButton>}
    {pending && !error ? <Button type="button" variant="ghost" size="lg" className="w-full text-muted-foreground hover:text-foreground" onClick={retry}>Cancel</Button> : null}
  </div>;
}
