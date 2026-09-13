"use client";

import { useEffect, useRef, useState } from "react";
import { TelegramIcon } from "@/src/components/homepage/telegram-icon";
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

interface PreparedTelegramLogin {
  api: TelegramLogin;
  clientId: number;
  nonce: string;
  expiresAt: number;
}

async function prepareTelegramLogin(purpose: "login" | "credential", signal: AbortSignal): Promise<PreparedTelegramLogin> {
  const start = purpose === "login" ? "/api/auth/telegram/start" : "/api/settings/login-methods/telegram/start";
  const [api, proof] = await Promise.all([
    loadTelegramLogin(),
    requestHostedOnboardingJson<{ ok: true; nonce: string; clientId: string }>({ url: start, method: "POST", payload: {}, signal }),
  ]);
  const clientId = Number(proof.clientId);
  if (proof.ok !== true || !Number.isSafeInteger(clientId) || clientId <= 0 || !/^[A-Za-z0-9_-]{43}$/u.test(proof.nonce)) {
    throw new Error("Telegram could not start. Try again.");
  }
  return { api, clientId, nonce: proof.nonce, expiresAt: Date.now() + 240_000 };
}

export function HostedTelegramProofButton({ purpose, onProof, onErrorChange, label = "Continue with Telegram" }: {
  purpose: "login" | "credential";
  onProof: (idToken: string, signal: AbortSignal) => Promise<void>;
  label?: string;
  onErrorChange?: (error: string | null) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const ready = useRef<PreparedTelegramLogin | null>(null);
  const preparation = useRef<Promise<PreparedTelegramLogin> | null>(null);
  const opening = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<AbortController | null>(null);

  useEffect(() => {
    onErrorChange?.(error);
    return () => { onErrorChange?.(null); };
  }, [error, onErrorChange]);

  useEffect(() => {
    const controller = new AbortController();
    current.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    const task = prepareTelegramLogin(purpose, signal);
    preparation.current = task;
    void task.then((prepared) => {
      if (!controller.signal.aborted) ready.current = prepared;
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setError(signal.aborted ? "Telegram could not start. Try again." : caught instanceof Error ? caught.message : "Telegram could not start. Try again.");
    });
    return () => { controller.abort(); };
  }, [attempt, purpose]);

  function retry() {
    current.current?.abort();
    ready.current = null; opening.current = false; setPending(false); setError(null); setAttempt((value) => value + 1);
  }

  function open() {
    if (opening.current) return;
    cancelActivePopup?.();
    const controller = current.current;
    if (!controller || controller.signal.aborted) return;
    opening.current = true;
    setPending(true); setError(null);
    let reservedPopup: Window | null = null;
    let api: TelegramLogin | null = null;
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
      if (cancelActivePopup === cancel) { cancelActivePopup = null; api?.close(); reservedPopup?.close(); }
    };
    controller.signal.addEventListener("abort", cleanup, { once: true });
    const launch = (prepared: PreparedTelegramLogin) => {
      if (controller.signal.aborted) return;
      if (reservedPopup?.closed) throw new Error("Telegram sign-in was canceled. Try again.");
      api = prepared.api;
      api.auth({ client_id: prepared.clientId, nonce: prepared.nonce, scope: ["profile", "write"] }, (result) => {
        if (completed || controller.signal.aborted) return;
        completed = true;
        cleanup();
        const token: unknown = result && typeof result === "object" ? Reflect.get(result, "id_token") : null;
        void (async () => {
          if (typeof token !== "string" || token.length === 0 || token.length > 8_192) throw new Error("Telegram sign-in was canceled. Try again.");
          await onProof(token, controller.signal);
        })().catch(fail).finally(() => {
          if (!controller.signal.aborted) { opening.current = false; setPending(false); ready.current = null; preparation.current = null; }
        });
      });
    };
    const fail = (caught: unknown) => {
      cleanup();
      if (controller.signal.aborted) return;
      opening.current = false; setPending(false);
      setError(caught instanceof Error ? caught.message : "Telegram could not open. Try again.");
    };
    try {
      if (ready.current && ready.current.expiresAt > Date.now()) { launch(ready.current); return; }
      // Reserve the SDK's named popup during the click, before any await.
      // Its later window.open reuses this window without another user gesture.
      reservedPopup = window.open("about:blank", "telegram_oidc_login", "popup,width=550,height=650");
      if (!reservedPopup) throw new Error("Allow the Telegram sign-in window to open, then try again.");
      if (ready.current || !preparation.current) {
        preparation.current = prepareTelegramLogin(purpose, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
      }
      void preparation.current?.then(launch).catch(fail);
    } catch (caught) { fail(caught); }

  }

  return <div className="flex flex-col gap-3">
    {error ? <>
      {!onErrorChange ? <SettingsStatusLine message={error} tone="destructive" /> : null}
      <HostedInlineAuthButton icon={<TelegramIcon className="h-5 w-5" />} onClick={retry}>Try again</HostedInlineAuthButton>
    </> : <HostedInlineAuthButton busy={pending} disabled={pending} onClick={open}
      icon={<TelegramIcon className="h-5 w-5" />}>
      {label}
    </HostedInlineAuthButton>}
    {pending && !error ? <Button type="button" variant="ghost" size="lg" className="w-full text-muted-foreground hover:text-foreground" onClick={retry}>Cancel</Button> : null}
  </div>;
}
