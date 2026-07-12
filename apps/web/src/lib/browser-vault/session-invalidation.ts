"use client";

const BROWSER_VAULT_SESSION_INVALIDATION_CHANNEL =
  "murph.browser-vault-session-invalidation.v1";
const BROWSER_VAULT_SESSION_INVALIDATION_EVENT =
  "murph:browser-vault-session-invalidation";
const BROWSER_VAULT_SESSION_INVALIDATION_MESSAGE = "invalidate";
let browserVaultSessionInvalidationChannel: BroadcastChannel | null | undefined;

export type BrowserVaultSessionInvalidationSource =
  | "same-document"
  | "cross-document";

/**
 * Tell this document and other same-origin tabs that the app-session cookie was
 * revoked or replaced. The signal carries no member, session, or health data.
 */
export function publishBrowserVaultSessionInvalidation(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(BROWSER_VAULT_SESSION_INVALIDATION_EVENT));

  const channel = getBrowserVaultSessionInvalidationChannel();
  channel?.postMessage(BROWSER_VAULT_SESSION_INVALIDATION_MESSAGE);
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
    }
  };
  const channel = getBrowserVaultSessionInvalidationChannel();

  window.addEventListener(
    BROWSER_VAULT_SESSION_INVALIDATION_EVENT,
    onDocumentInvalidation,
  );
  channel?.addEventListener("message", onCrossDocumentInvalidation);

  return () => {
    window.removeEventListener(
      BROWSER_VAULT_SESSION_INVALIDATION_EVENT,
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
