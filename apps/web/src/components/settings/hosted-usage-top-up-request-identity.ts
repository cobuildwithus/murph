const HOSTED_USAGE_TOP_UP_REQUEST_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const HOSTED_USAGE_TOP_UP_REQUEST_STORAGE_PREFIX =
  "murph:usage-top-up:unresolved:v1:";

type HostedUsageTopUpStoredRequestIdentity =
  | { available: true; requestKey: string | null }
  | { available: false; requestKey: null };

interface HostedUsageTopUpRequestIdentityScope {
  checkoutUrl: string;
  payerMemberId: string;
}

function readHostedUsageTopUpRequestIdentity(
  scope: HostedUsageTopUpRequestIdentityScope,
): HostedUsageTopUpStoredRequestIdentity {
  const storage = readSessionStorage();
  if (!storage) {
    return { available: false, requestKey: null };
  }

  const storageKey = requestIdentityStorageKey(scope);
  try {
    const requestKey = storage.getItem(storageKey);
    if (requestKey === null) {
      return { available: true, requestKey: null };
    }
    if (HOSTED_USAGE_TOP_UP_REQUEST_KEY_PATTERN.test(requestKey)) {
      return { available: true, requestKey };
    }
    storage.removeItem(storageKey);
    return storage.getItem(storageKey) === null
      ? { available: true, requestKey: null }
      : { available: false, requestKey: null };
  } catch {
    return { available: false, requestKey: null };
  }
}

function writeHostedUsageTopUpRequestIdentity(
  scope: HostedUsageTopUpRequestIdentityScope,
  requestKey: string,
): boolean {
  const storage = readSessionStorage();
  if (
    !storage ||
    !HOSTED_USAGE_TOP_UP_REQUEST_KEY_PATTERN.test(requestKey)
  ) {
    return false;
  }

  const storageKey = requestIdentityStorageKey(scope);
  try {
    storage.setItem(storageKey, requestKey);
    return storage.getItem(storageKey) === requestKey;
  } catch {
    return false;
  }
}

function clearHostedUsageTopUpRequestIdentity(
  scope: HostedUsageTopUpRequestIdentityScope,
): boolean {
  const storage = readSessionStorage();
  if (!storage) {
    return false;
  }

  const storageKey = requestIdentityStorageKey(scope);
  try {
    storage.removeItem(storageKey);
    return storage.getItem(storageKey) === null;
  } catch {
    return false;
  }
}

function requestIdentityStorageKey(
  scope: HostedUsageTopUpRequestIdentityScope,
): string {
  return [
    HOSTED_USAGE_TOP_UP_REQUEST_STORAGE_PREFIX,
    encodeURIComponent(scope.payerMemberId),
    ":",
    encodeURIComponent(scope.checkoutUrl),
  ].join("");
}

function readSessionStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export {
  clearHostedUsageTopUpRequestIdentity,
  readHostedUsageTopUpRequestIdentity,
  writeHostedUsageTopUpRequestIdentity,
};
