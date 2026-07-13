"use client";

const BROWSER_VAULT_SESSION_INVALIDATION_CHANNEL =
  "murph.browser-vault-session-invalidation.v1";
const BROWSER_VAULT_SESSION_INVALIDATION_EVENT =
  "murph:browser-vault-session-invalidation";
const BROWSER_VAULT_SESSION_ENDING_EVENT =
  "murph:browser-vault-session-ending";
const BROWSER_VAULT_SESSION_INVALIDATION_MESSAGE = "invalidate";
const BROWSER_VAULT_SESSION_ENDING_MESSAGE = "clear";
export const BROWSER_VAULT_SESSION_ENDING_LEASE_MS = 30_000;
let browserVaultSessionInvalidationChannel: BroadcastChannel | null | undefined;
let browserVaultSessionEnding = false;
let browserVaultSessionEndingLease: ReturnType<typeof setTimeout> | null = null;

export type BrowserVaultSessionInvalidationSource =
  | "same-document"
  | "same-document-clear"
  | "cross-document"
  | "cross-document-clear";

/**
 * Tell this document and other same-origin tabs that the app-session cookie was
 * revoked or replaced. The signal carries no member, session, or health data.
 */
export function publishBrowserVaultSessionInvalidation(): void {
  setBrowserVaultSessionEnding(false);
  publishBrowserVaultSessionSignal({
    eventName: BROWSER_VAULT_SESSION_INVALIDATION_EVENT,
    message: BROWSER_VAULT_SESSION_INVALIDATION_MESSAGE,
  });
}

/**
 * Clear decrypted state in every open tab before dispatching a mutation that
 * may revoke the shared session. Other documents stay mounted and empty until
 * the mutation settles and a normal invalidation asks them to revalidate.
 */
export function publishBrowserVaultSessionEnding(): void {
  setBrowserVaultSessionEnding(true);
  publishBrowserVaultSessionSignal({
    eventName: BROWSER_VAULT_SESSION_ENDING_EVENT,
    message: BROWSER_VAULT_SESSION_ENDING_MESSAGE,
  });
}

export function isBrowserVaultSessionEnding(): boolean {
  return browserVaultSessionEnding;
}

function publishBrowserVaultSessionSignal(input: {
  eventName: string;
  message: string;
}): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(input.eventName));

  const channel = getBrowserVaultSessionInvalidationChannel();
  channel?.postMessage(input.message);
}

export function subscribeBrowserVaultSessionInvalidation(
  onInvalidate: (source: BrowserVaultSessionInvalidationSource) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const onDocumentInvalidation = () => {
    setBrowserVaultSessionEnding(false);
    onInvalidate("same-document");
  };
  const onDocumentSessionEnding = () => {
    setBrowserVaultSessionEnding(true);
    onInvalidate("same-document-clear");
  };
  const onCrossDocumentInvalidation = (event: MessageEvent<unknown>) => {
    if (event.data === BROWSER_VAULT_SESSION_INVALIDATION_MESSAGE) {
      setBrowserVaultSessionEnding(false);
      onInvalidate("cross-document");
      return;
    }
    if (event.data === BROWSER_VAULT_SESSION_ENDING_MESSAGE) {
      setBrowserVaultSessionEnding(true);
      onInvalidate("cross-document-clear");
    }
  };
  const channel = getBrowserVaultSessionInvalidationChannel();

  window.addEventListener(
    BROWSER_VAULT_SESSION_INVALIDATION_EVENT,
    onDocumentInvalidation,
  );
  window.addEventListener(
    BROWSER_VAULT_SESSION_ENDING_EVENT,
    onDocumentSessionEnding,
  );
  channel?.addEventListener("message", onCrossDocumentInvalidation);

  return () => {
    window.removeEventListener(
      BROWSER_VAULT_SESSION_INVALIDATION_EVENT,
      onDocumentInvalidation,
    );
    window.removeEventListener(
      BROWSER_VAULT_SESSION_ENDING_EVENT,
      onDocumentSessionEnding,
    );
    channel?.removeEventListener("message", onCrossDocumentInvalidation);
  };
}

function setBrowserVaultSessionEnding(ending: boolean): void {
  browserVaultSessionEnding = ending;
  if (browserVaultSessionEndingLease) {
    clearTimeout(browserVaultSessionEndingLease);
    browserVaultSessionEndingLease = null;
  }

  if (!ending || typeof window === "undefined") {
    return;
  }

  // The initiator can disappear while a destructive request is in flight.
  // Bound the data-free clear latch so every surviving tab eventually performs
  // a fresh authority check instead of remaining empty for the process lifetime.
  browserVaultSessionEndingLease = setTimeout(() => {
    browserVaultSessionEndingLease = null;
    publishBrowserVaultSessionInvalidation();
  }, BROWSER_VAULT_SESSION_ENDING_LEASE_MS);
}

function getBrowserVaultSessionInvalidationChannel(): BroadcastChannel | null {
  if (browserVaultSessionInvalidationChannel === undefined) {
    browserVaultSessionInvalidationChannel = typeof BroadcastChannel === "function"
      ? new BroadcastChannel(BROWSER_VAULT_SESSION_INVALIDATION_CHANNEL)
      : null;
  }

  return browserVaultSessionInvalidationChannel;
}
