"use client";

import { useEffect } from "react";
import { withHostedSessionCookieWrite } from "./hosted-app-session-client";

const RENEWAL_CHECK_MS = 60 * 60 * 1_000;

// The server owns expiry and the daily renewal threshold. Legacy browser
// sessions are read unchanged; this never exchanges or extends their lifetime.
export function HostedSessionRenewal({ authenticated }: { authenticated: boolean }) {
  useEffect(() => {
    // Without origin-wide ordering, retain the existing cookie lifetime.
    // Native renewal has no browser cookie and does not need this lock.
    if (!authenticated || !navigator.locks) return;
    let nextAttempt = 0;
    let request: AbortController | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    async function renew() {
      if (document.visibilityState === "hidden" || request || Date.now() < nextAttempt) return;
      nextAttempt = Date.now() + RENEWAL_CHECK_MS;
      const controller = new AbortController();
      request = controller;
      timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        await withHostedSessionCookieWrite(() => fetch("/api/auth/session", {
          method: "POST", credentials: "same-origin", cache: "no-store",
          redirect: "error", signal: controller.signal,
        }), controller.signal);
      } catch {
        // An offline tab keeps its credential. Product requests remain the
        // authority for admission; a late renewal result cannot sign it out.
      } finally {
        clearTimeout(timeout);
        request = null;
      }
    }
    const check = () => { void renew(); };
    check();
    const interval = setInterval(check, RENEWAL_CHECK_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
      request?.abort();
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [authenticated]);
  return null;
}
