import Image from "next/image";

import { AuthButton } from "@/src/components/ui/auth-button";
import { Button } from "@/src/components/ui/button";

import type { ConnectSource } from "./connect-page-types";

export function SourceCard({
  authenticated,
  errorMessage,
  pending,
  pendingDisconnect,
  source,
  onDisconnectTargetChange,
  onStartConnection,
}: {
  authenticated: boolean;
  errorMessage: string | null;
  pending: boolean;
  pendingDisconnect: boolean;
  source: ConnectSource;
  onDisconnectTargetChange: (source: ConnectSource | null) => void;
  onStartConnection: (source: ConnectSource) => Promise<void>;
}) {
  const isAvailable = Boolean(source.connectTarget);
  const canStart = authenticated && isAvailable;
  const canDisconnect = authenticated && Boolean(source.disconnectConnectionId);
  const actionLabel = source.requiresReconnect ? "Reconnect" : "Connect";

  return (
    <div className="relative box-border flex min-w-0 w-full max-w-full flex-col justify-between overflow-hidden rounded-xl border border-border/50 bg-[rgba(255,252,246,0.9)] p-4 sm:p-5">
      <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
        <SourceStatusDot
          connected={source.connected}
          requiresReconnect={source.requiresReconnect}
          sourceName={source.name}
        />
      </div>

      <div className="mb-3 flex h-11 min-w-0 items-center sm:mb-5 sm:h-14">
        <SourceLogo source={source} />
      </div>

      <div className="flex flex-1 items-center gap-4 sm:flex-col sm:items-stretch sm:gap-0">
        <div className="min-w-0 flex-1 sm:mb-5 sm:flex-none">
          <h2 className="font-serif text-lg font-semibold text-foreground">
            {source.name}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-pretty text-muted-foreground">
            {source.description}
          </p>
        </div>

        {source.connected && !source.requiresReconnect ? (
          <div className="flex shrink-0 flex-col gap-2 sm:mt-auto sm:shrink">
            {canDisconnect ? (
              <button
                type="button"
                aria-label={`Disconnect ${source.name}`}
                disabled={pendingDisconnect}
                onClick={() => onDisconnectTargetChange(source)}
                className="relative self-start text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline before:absolute before:-inset-x-2 before:-inset-y-2.5 before:content-['']"
              >
                {pendingDisconnect ? "Disconnecting..." : "Disconnect"}
              </button>
            ) : null}
            {errorMessage ? (
              <p role="alert" className="text-xs leading-snug text-destructive">
                {errorMessage}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex shrink-0 flex-col items-start gap-2 sm:mt-auto sm:shrink">
            {source.requiresReconnect ? (
              <p className="max-w-[22rem] text-sm leading-relaxed text-pretty text-destructive">
                Please reconnect {source.name} to resume syncing.
              </p>
            ) : null}
            {!authenticated ? (
              <AuthButton aria-label={`Sign in to connect ${source.name}`}>
                Sign in
              </AuthButton>
            ) : (
              <Button
                type="button"
                disabled={!canStart || pending}
                aria-label={isAvailable
                  ? `${actionLabel} ${source.name}`
                  : `${source.name} connection is not available yet`}
                onClick={() => void onStartConnection(source)}
              >
                {pending ? "Opening..." : isAvailable ? actionLabel : "Not available"}
              </Button>
            )}
            {errorMessage ? (
              <p role="alert" className="text-xs leading-snug text-destructive">
                {errorMessage}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function SourceStatusDot({
  connected = false,
  requiresReconnect = false,
  sourceName,
}: {
  connected?: boolean;
  requiresReconnect?: boolean;
  sourceName: string;
}) {
  const state = requiresReconnect ? "needs-access" : connected ? "connected" : "idle";

  return (
    <>
      <span
        aria-hidden="true"
        data-connection-state={state}
        className={
          requiresReconnect
            ? "block size-2.5 rounded-full bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.18)]"
            : connected
            ? "block size-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.14)]"
            : "block size-2.5 rounded-full bg-stone-300 shadow-[0_0_0_3px_rgba(120,113,108,0.12)]"
        }
      />
      <span className="sr-only">
        {sourceName} {requiresReconnect ? "needs reconnect" : connected ? "connected" : "not connected"}
      </span>
    </>
  );
}

function SourceLogo({ source }: { source: ConnectSource }) {
  return (
    <Image
      src={source.logo.src}
      alt=""
      width={source.logo.width}
      height={source.logo.height}
      className={source.logo.className}
    />
  );
}
