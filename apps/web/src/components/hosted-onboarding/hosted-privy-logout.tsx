"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useRef } from "react";

import { HostedPrivyProvider } from "./privy-provider";

/**
 * Lazily mounts the Privy SDK to clear its client session, then calls
 * `onDone`. Renders nothing. Use after the Murph app session is logged out
 * from surfaces that do not already live inside a Privy provider, so sign-out
 * cannot leave a stale Privy session behind in the browser.
 */
export function HostedPrivyLogout({ onDone }: { onDone: () => void }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const clientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim() || null;

  useEffect(() => {
    if (!appId) {
      onDone();
    }
  }, [appId, onDone]);

  if (!appId) {
    return null;
  }

  return (
    <HostedPrivyProvider appId={appId} clientId={clientId}>
      <PrivyLogoutOnReady onDone={onDone} />
    </HostedPrivyProvider>
  );
}

function PrivyLogoutOnReady({ onDone }: { onDone: () => void }) {
  const { logout, ready } = usePrivy();
  const startedRef = useRef(false);

  useEffect(() => {
    if (!ready || startedRef.current) {
      return;
    }

    startedRef.current = true;
    void Promise.resolve()
      .then(() => logout())
      .catch(() => {
        // The Murph app-session logout is authoritative; Privy logout is
        // best-effort client cleanup.
      })
      .finally(onDone);
  }, [logout, onDone, ready]);

  return null;
}
