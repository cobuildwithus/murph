"use client";

import { useCallback, useState, type ReactNode } from "react";

import { HostedAuthPanelWithinPrivy } from "./hosted-auth-panel-island";
import { HostedPrivyProvider } from "./privy-provider";

export type HostedAuthRuntimeState =
  | {
      attempt: number;
      AuthPanel: typeof HostedAuthPanelWithinPrivy;
      kind: "configured";
      restart: () => void;
    }
  | {
      kind: "unconfigured";
    };

export function HostedAuthRuntime({
  children,
}: {
  children: (state: HostedAuthRuntimeState) => ReactNode;
}) {
  const [attempt, setAttempt] = useState(1);
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const clientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim() || null;
  const restart = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  if (!appId) {
    return <>{children({ kind: "unconfigured" })}</>;
  }

  return (
    <HostedPrivyProvider appId={appId} clientId={clientId} key={attempt}>
      {children({
        attempt,
        AuthPanel: HostedAuthPanelWithinPrivy,
        kind: "configured",
        restart,
      })}
    </HostedPrivyProvider>
  );
}
