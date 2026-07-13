"use client";

const BROWSER_VAULT_SESSION_INVALIDATION_CHANNEL =
  "murph.browser-vault-session-invalidation.v1";
const BROWSER_VAULT_SESSION_INVALIDATION_EVENT =
  "murph:browser-vault-session-invalidation";
const BROWSER_VAULT_SESSION_ENDING_EVENT =
  "murph:browser-vault-session-ending";
const BROWSER_VAULT_SESSION_ENDING_EXPIRED_EVENT =
  "murph:browser-vault-session-ending-expired";
const BROWSER_VAULT_SESSION_INVALIDATION_MESSAGE = "invalidate";
const BROWSER_VAULT_SESSION_ENDING_MESSAGE = "clear";
export const BROWSER_VAULT_SESSION_ENDING_LEASE_MS = 30_000;
let browserVaultSessionInvalidationChannel: BroadcastChannel | null | undefined;
let browserVaultSessionEnding = false;
let browserVaultSessionEndingLease: ReturnType<typeof setTimeout> | null = null;

export type BrowserVaultSessionInvalidationSource =
  | "same-document"
  | "same-document-clear"
  | "same-document-expired"
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
 * may revoke the shared session. Other documents stay empty until the mutation
 * settles or their passive-receiver lease asks the local auth owner to recheck.
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
  const onDocumentSessionEndingExpired = () => {
    onInvalidate("same-document-expired");
  };
  const onCrossDocumentInvalidation = (event: MessageEvent<unknown>) => {
    if (event.data === BROWSER_VAULT_SESSION_INVALIDATION_MESSAGE) {
      setBrowserVaultSessionEnding(false);
      onInvalidate("cross-document");
      return;
    }
    if (event.data === BROWSER_VAULT_SESSION_ENDING_MESSAGE) {
      setBrowserVaultSessionEnding(true, { startLease: true });
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
  window.addEventListener(
    BROWSER_VAULT_SESSION_ENDING_EXPIRED_EVENT,
    onDocumentSessionEndingExpired,
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
    window.removeEventListener(
      BROWSER_VAULT_SESSION_ENDING_EXPIRED_EVENT,
      onDocumentSessionEndingExpired,
    );
    channel?.removeEventListener("message", onCrossDocumentInvalidation);
  };
}

function setBrowserVaultSessionEnding(
  ending: boolean,
  options: { startLease?: boolean } = {},
): void {
  browserVaultSessionEnding = ending;
  if (browserVaultSessionEndingLease) {
    clearTimeout(browserVaultSessionEndingLease);
    browserVaultSessionEndingLease = null;
  }

  if (!ending || !options.startLease || typeof window === "undefined") {
    return;
  }

  // A passive receiver cannot know whether the initiator survived. Expiry is
  // local-only—not proof that the mutation settled—and asks the document's
  // existing auth owner to recheck authority without notifying other tabs.
  browserVaultSessionEndingLease = setTimeout(() => {
    browserVaultSessionEndingLease = null;
    browserVaultSessionEnding = false;
    window.dispatchEvent(new Event(BROWSER_VAULT_SESSION_ENDING_EXPIRED_EVENT));
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
