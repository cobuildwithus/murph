"use client";

const BROWSER_VAULT_SESSION_INVALIDATION_CHANNEL =
  "murph.browser-vault-session-invalidation.v1";
const BROWSER_VAULT_SESSION_INVALIDATION_EVENT =
  "murph:browser-vault-session-invalidation";
const BROWSER_VAULT_SESSION_ENDING_EVENT =
  "murph:browser-vault-session-ending";
const BROWSER_VAULT_SESSION_INVALIDATION_MESSAGE = "invalidate";
const BROWSER_VAULT_SESSION_ENDING_MESSAGE = "clear";
let browserVaultSessionInvalidationChannel: BroadcastChannel | null | undefined;

export type BrowserVaultSessionInvalidationSource =
  | "same-document"
  | "cross-document"
  | "cross-document-clear";

/**
 * Tell this document and other same-origin tabs that the app-session cookie was
 * revoked or replaced. The signal carries no member, session, or health data.
 */
export function publishBrowserVaultSessionInvalidation(): void {
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
  publishBrowserVaultSessionSignal({
    eventName: BROWSER_VAULT_SESSION_ENDING_EVENT,
    message: BROWSER_VAULT_SESSION_ENDING_MESSAGE,
  });
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

  const onDocumentInvalidation = () => onInvalidate("same-document");
  const onCrossDocumentInvalidation = (event: MessageEvent<unknown>) => {
    if (event.data === BROWSER_VAULT_SESSION_INVALIDATION_MESSAGE) {
      onInvalidate("cross-document");
      return;
    }
    if (event.data === BROWSER_VAULT_SESSION_ENDING_MESSAGE) {
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
    onDocumentInvalidation,
  );
  channel?.addEventListener("message", onCrossDocumentInvalidation);

  return () => {
    window.removeEventListener(
      BROWSER_VAULT_SESSION_INVALIDATION_EVENT,
      onDocumentInvalidation,
    );
    window.removeEventListener(
      BROWSER_VAULT_SESSION_ENDING_EVENT,
      onDocumentInvalidation,
    );
    channel?.removeEventListener("message", onCrossDocumentInvalidation);
  };
}

function getBrowserVaultSessionInvalidationChannel(): BroadcastChannel | null {
  if (browserVaultSessionInvalidationChannel === undefined) {
    browserVaultSessionInvalidationChannel = typeof BroadcastChannel === "function"
      ? new BroadcastChannel(BROWSER_VAULT_SESSION_INVALIDATION_CHANNEL)
      : null;
  }

  return browserVaultSessionInvalidationChannel;
}
