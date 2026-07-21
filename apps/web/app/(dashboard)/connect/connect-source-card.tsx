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
  const requiresConnectionReset = source.recoveryKind === "connection_reset";
  const historicalResetIncomplete = source.historicalResetIncomplete === true
    && !source.connected
    && !requiresConnectionReset
    && !source.requiresReconnect;
  const actionLabel = source.requiresReconnect ? "Reconnect" : "Connect";
  const disconnectAriaLabel = resolveDisconnectAriaLabel(source);
  const reconnectUnavailable = source.requiresReconnect && !isAvailable;
  const connectionOfferEnabled = source.connectionAvailable !== false;
  const historicalReconnectUnavailable = historicalResetIncomplete && !connectionOfferEnabled;
  const showReconnectStateDisconnect = canDisconnect
    && (reconnectUnavailable || requiresConnectionReset || source.disconnectScope === "junction_account");
  const unavailableMessage = !source.requiresReconnect && !requiresConnectionReset && !isAvailable
    ? source.unavailableMessage
    : undefined;
  // Any of these branches renders a wide (max-w-[22rem]) message beside the
  // source details. That message is too wide to share the base-breakpoint row,
  // so the card stacks vertically on phone widths to keep the text from
  // overlapping the description.
  const showsSideMessage = requiresConnectionReset
    || source.requiresReconnect
    || historicalResetIncomplete
    || Boolean(unavailableMessage);

  return (
    <div className="relative box-border flex min-w-0 w-full max-w-full flex-col justify-between overflow-hidden rounded-xl border border-border/50 bg-[rgba(255,252,246,0.9)] p-4 sm:p-5">
      <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
        <SourceStatusDot
          connected={source.connected}
          historicalResetIncomplete={historicalResetIncomplete}
          requiresConnectionReset={requiresConnectionReset}
          requiresReconnect={source.requiresReconnect}
          sourceName={source.name}
        />
      </div>

      <div className="mb-3 flex h-11 min-w-0 items-center sm:mb-5 sm:h-14">
        <SourceLogo source={source} />
      </div>

      <div
        className={
          showsSideMessage
            ? "flex flex-1 flex-col items-stretch gap-3 sm:gap-0"
            : "flex flex-1 items-center gap-4 sm:flex-col sm:items-stretch sm:gap-0"
        }
      >
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
                aria-label={disconnectAriaLabel}
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
            {requiresConnectionReset ? (
              <p className="max-w-[22rem] text-sm leading-relaxed text-pretty text-destructive">
                {connectionOfferEnabled
                  ? `${source.name} needs a fresh connection. Disconnect it first, then connect it again.`
                  : `${source.name} needs a fresh connection, but reconnecting is temporarily unavailable. You can disconnect the old connection here.`}
              </p>
            ) : source.requiresReconnect ? (
              <p className="max-w-[22rem] text-sm leading-relaxed text-pretty text-destructive">
                {reconnectUnavailable
                  ? `${source.name} needs attention from the connected app before Murph can keep syncing it.`
                  : `Please reconnect ${source.name} to resume syncing.`}
              </p>
            ) : historicalResetIncomplete ? (
              <p className="max-w-[22rem] text-sm leading-relaxed text-pretty text-destructive">
                {connectionOfferEnabled
                  ? `The last reset for ${source.name} did not finish. Remove the old connection in your wearable provider account, then connect it again here.`
                  : `The last reset for ${source.name} did not finish. Remove the old connection in your wearable provider account. Reconnecting through Murph is temporarily unavailable.`}
              </p>
            ) : null}
            {unavailableMessage ? (
              <p className="max-w-[22rem] text-sm leading-relaxed text-pretty text-muted-foreground">
                {unavailableMessage}
              </p>
            ) : null}
            {source.unavailableActionUrl && source.unavailableActionLabel ? (
              <Button
                render={(
                  <a
                    href={source.unavailableActionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                )}
                nativeButton={false}
                aria-label={`${source.unavailableActionLabel} for ${source.name}`}
              >
                {source.unavailableActionLabel}
              </Button>
            ) : !authenticated ? (
              <AuthButton aria-label={`Sign in to connect ${source.name}`}>
                Sign in
              </AuthButton>
            ) : unavailableMessage && source.unavailableActionLabel ? (
              <Button
                type="button"
                disabled
                aria-label={`${source.name} web setup is not available yet`}
              >
                {source.unavailableActionLabel}
              </Button>
            ) : reconnectUnavailable
              || requiresConnectionReset
              || historicalReconnectUnavailable
              || unavailableMessage ? null : (
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
            {showReconnectStateDisconnect ? (
              <button
                type="button"
                aria-label={disconnectAriaLabel}
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
        )}
      </div>
    </div>
  );
}

function resolveDisconnectAriaLabel(source: ConnectSource): string {
  return source.disconnectScope === "junction_account"
    ? "Disconnect account"
    : `Disconnect ${source.name}`;
}

function SourceStatusDot({
  connected = false,
  historicalResetIncomplete = false,
  requiresConnectionReset = false,
  requiresReconnect = false,
  sourceName,
}: {
  connected?: boolean;
  historicalResetIncomplete?: boolean;
  requiresConnectionReset?: boolean;
  requiresReconnect?: boolean;
  sourceName: string;
}) {
  const needsAttention = requiresReconnect || requiresConnectionReset || historicalResetIncomplete;
  const state = needsAttention ? "needs-access" : connected ? "connected" : "idle";

  return (
    <>
      <span
        aria-hidden="true"
        data-connection-state={state}
        className={
          needsAttention
            ? "block size-2.5 rounded-full bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.18)]"
            : connected
            ? "block size-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.14)]"
            : "block size-2.5 rounded-full bg-stone-300 shadow-[0_0_0_3px_rgba(120,113,108,0.12)]"
        }
      />
      <span className="sr-only">
        {sourceName} {requiresConnectionReset
          ? "needs a fresh connection"
          : requiresReconnect
          ? "needs reconnect"
          : historicalResetIncomplete
          ? "needs its old connection removed"
          : connected
          ? "connected"
          : "not connected"}
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
