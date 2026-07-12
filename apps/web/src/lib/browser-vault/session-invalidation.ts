"use client";

const BROWSER_VAULT_SESSION_INVALIDATION_CHANNEL =
  "murph.browser-vault-session-invalidation.v1";
const BROWSER_VAULT_SESSION_INVALIDATION_EVENT =
  "murph:browser-vault-session-invalidation";
const BROWSER_VAULT_SESSION_INVALIDATION_MESSAGE = "invalidate";

/**
 * Tell this document and other same-origin tabs that the app-session cookie was
 * revoked or replaced. The signal carries no member, session, or health data.
 */
export function publishBrowserVaultSessionInvalidation(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(BROWSER_VAULT_SESSION_INVALIDATION_EVENT));

  const channel = openBrowserVaultSessionInvalidationChannel();
  channel?.postMessage(BROWSER_VAULT_SESSION_INVALIDATION_MESSAGE);
  channel?.close();
}

export function subscribeBrowserVaultSessionInvalidation(
  onInvalidate: () => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const onDocumentInvalidation = () => onInvalidate();
  const onCrossDocumentInvalidation = (event: MessageEvent<unknown>) => {
    if (event.data === BROWSER_VAULT_SESSION_INVALIDATION_MESSAGE) {
      onInvalidate();
    }
  };
  const channel = openBrowserVaultSessionInvalidationChannel();

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
    channel?.close();
  };
}

function openBrowserVaultSessionInvalidationChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel !== "function") {
    return null;
  }

  return new BroadcastChannel(BROWSER_VAULT_SESSION_INVALIDATION_CHANNEL);
}
