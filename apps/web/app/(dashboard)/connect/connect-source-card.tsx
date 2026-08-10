import Image from "next/image";

import { AuthButton } from "@/src/components/ui/auth-button";
import { Button } from "@/src/components/ui/button";

import type {
  ConnectSource,
  ConnectSourceSetupGuideId,
} from "./connect-page-types";

export function SourceCard({
  authenticated,
  errorMessage,
  pending,
  pendingDisconnect,
  source,
  onDisconnectTargetChange,
  onSetupGuideOpen,
  onStartConnection,
}: {
  authenticated: boolean;
  errorMessage: string | null;
  pending: boolean;
  pendingDisconnect: boolean;
  source: ConnectSource;
  onDisconnectTargetChange: (source: ConnectSource | null) => void;
  onSetupGuideOpen?: (setupGuideId: ConnectSourceSetupGuideId) => void;
  onStartConnection: (source: ConnectSource) => Promise<void>;
}) {
  const setupGuideActionLabel = source.setupGuideActionLabel;
  const setupGuideId = source.setupGuideId;
  const statusless = Boolean(setupGuideId)
    || source.connectionStatusMeaningful === false;
  const isAvailable = Boolean(source.connectTarget);
  const canStart = authenticated && isAvailable;
  const canDisconnect = !statusless
    && authenticated
    && Boolean(source.disconnectConnectionId);
  const requiresConnectionReset = !statusless
    && source.recoveryKind === "connection_reset";
  const requiresReconnect = !statusless && source.requiresReconnect === true;
  const historicalResetIncomplete = !statusless
    && source.historicalResetIncomplete === true
    && !source.connected
    && !requiresConnectionReset
    && !requiresReconnect;
  const actionLabel = requiresReconnect ? "Reconnect" : "Connect";
  const disconnectAriaLabel = resolveDisconnectAriaLabel(source);
  const reconnectUnavailable = requiresReconnect && !isAvailable;
  const connectionOfferEnabled = source.connectionAvailable !== false;
  const historicalReconnectUnavailable = historicalResetIncomplete && !connectionOfferEnabled;
  const showReconnectStateDisconnect = canDisconnect
    && (
      reconnectUnavailable
      || requiresConnectionReset
      || source.disconnectScope === "junction_account"
      || Boolean(source.disconnectSourceProviderSlug)
    );
  const unavailableMessage = !requiresReconnect && !requiresConnectionReset && !isAvailable
    ? source.unavailableMessage
    : undefined;
  // These branches add message content beside the source details. Stack the
  // card on phone widths so the message and action never squeeze the
  // description into a narrow column.
  const showsSideMessage = requiresConnectionReset
    || requiresReconnect
    || historicalResetIncomplete
    || Boolean(unavailableMessage)
    || Boolean(errorMessage);

  return (
    <div className="relative box-border flex min-w-0 w-full max-w-full flex-col justify-between overflow-hidden rounded-xl border border-border/50 bg-[rgba(255,252,246,0.9)] p-4 sm:p-5">
      {!statusless ? (
        <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
          <SourceStatusDot
            connected={source.connected}
            historicalResetIncomplete={historicalResetIncomplete}
            requiresConnectionReset={requiresConnectionReset}
            requiresReconnect={requiresReconnect}
            sourceName={source.name}
          />
        </div>
      ) : null}

      <div className="mb-3 flex h-11 min-w-0 items-center sm:mb-5 sm:h-14">
        <SourceLogo source={source} />
      </div>

      <div
        className={
          showsSideMessage
            ? "flex flex-1 flex-col items-stretch gap-3 sm:gap-0"
            : "flex flex-1 items-end gap-4 sm:flex-col sm:items-stretch sm:gap-0"
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

        {!statusless && source.connected && !requiresReconnect ? (
          <div className="ml-auto flex shrink-0 flex-col items-end gap-2 self-end sm:mt-auto sm:shrink">
            {errorMessage ? (
              <p role="alert" className="text-xs leading-snug text-destructive">
                {errorMessage}
              </p>
            ) : null}
            {canDisconnect ? (
              <button
                type="button"
                aria-label={disconnectAriaLabel}
                disabled={pendingDisconnect}
                onClick={() => onDisconnectTargetChange(source)}
                className="relative self-end text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline before:absolute before:-inset-x-2 before:-inset-y-2.5 before:content-['']"
              >
                {pendingDisconnect ? "Disconnecting..." : "Disconnect"}
              </button>
            ) : null}
          </div>
        ) : (
          <div
            className={
              showsSideMessage
                ? "flex w-full shrink-0 flex-col items-stretch gap-2 self-stretch sm:mt-auto sm:shrink"
                : "ml-auto flex shrink-0 flex-col items-stretch gap-2 self-end sm:mt-auto sm:shrink"
            }
          >
            {requiresConnectionReset ? (
              <p className="max-w-[22rem] text-sm leading-relaxed text-pretty text-destructive">
                {connectionOfferEnabled
                  ? `${source.name} needs a fresh connection. Disconnect it first, then connect it again.`
                  : `${source.name} needs a fresh connection, but reconnecting is temporarily unavailable. You can disconnect the old connection here.`}
              </p>
            ) : requiresReconnect ? (
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
            {errorMessage ? (
              <p role="alert" className="text-xs leading-snug text-destructive">
                {errorMessage}
              </p>
            ) : null}
            {source.unavailableActionUrl && source.unavailableActionLabel ? (
              <Button
                className="self-end"
                render={(
                  <a
                    href={source.unavailableActionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                )}
                nativeButton={false}
                aria-label={
                  source.unavailableActionAriaLabel
                  ?? `${source.unavailableActionLabel} for ${source.name}`
                }
              >
                {source.unavailableActionLabel}
              </Button>
            ) : setupGuideId && setupGuideActionLabel && !authenticated ? (
              <AuthButton
                aria-label={`Log in or sign up to set up ${source.name}`}
                className="self-end"
              >
                Log in or sign up
              </AuthButton>
            ) : setupGuideId && setupGuideActionLabel ? (
              <Button
                type="button"
                disabled={!onSetupGuideOpen}
                aria-label={`${setupGuideActionLabel} for ${source.name}`}
                onClick={() => onSetupGuideOpen?.(setupGuideId)}
                className="self-end"
              >
                {setupGuideActionLabel}
              </Button>
            ) : !authenticated ? (
              <AuthButton
                aria-label={`Sign in to connect ${source.name}`}
                className="self-end"
              >
                Sign in
              </AuthButton>
            ) : unavailableMessage && source.unavailableActionLabel ? (
              <Button
                type="button"
                disabled
                aria-label={`${source.name} web setup is not available yet`}
                className="self-end"
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
                className="self-end"
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
                className="relative self-end text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline before:absolute before:-inset-x-2 before:-inset-y-2.5 before:content-['']"
              >
                {pendingDisconnect ? "Disconnecting..." : "Disconnect"}
              </button>
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
