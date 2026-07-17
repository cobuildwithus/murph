const CLINICAL_RECORDS_CONNECT_PATH = "/records/connect";
const CLINICAL_RECORDS_INTENT_HASH_KEY = "clinicalRecordsIntent";
const CLINICAL_RECORDS_INTENT_HISTORY_KEY = "__murphClinicalRecordsConnectIntent";
const CLINICAL_RECORDS_INTENT_PATTERN = /^cr_[A-Za-z0-9_-]{32}$/u;

/**
 * Removes the bearer from the visible URL before the page can make a request.
 * Anonymous flows keep it only in this history entry long enough for the
 * shared auth dialog's full-document reload. Authenticated flows take it into
 * component memory and clear the staged copy in the same call.
 */
export function takeClinicalRecordsConnectIntentFromBrowser(input: {
  preserveForAuthReload: boolean;
}): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const url = readCurrentUrl();
  if (!url) {
    return null;
  }

  const hashParams = readHashParams(url.hash);
  const hasHashClaim = hashParams.has(CLINICAL_RECORDS_INTENT_HASH_KEY);
  const hashClaim = hasHashClaim
    ? normalizeClinicalRecordsConnectIntentClaim(
        hashParams.get(CLINICAL_RECORDS_INTENT_HASH_KEY),
      )
    : null;
  const stagedClaim = readStagedClinicalRecordsConnectIntent();
  const claim = hasHashClaim ? hashClaim : stagedClaim;

  if (hasHashClaim) {
    hashParams.delete(CLINICAL_RECORDS_INTENT_HASH_KEY);
    url.hash = hashParams.toString();
  }

  const shouldPreserveClaim = input.preserveForAuthReload && Boolean(claim);
  const historyStateChanged = shouldPreserveClaim
    ? stagedClaim !== claim
    : stagedClaim !== null;

  if (hasHashClaim || historyStateChanged) {
    window.history.replaceState(
      withStagedClinicalRecordsConnectIntent(
        window.history.state,
        shouldPreserveClaim ? claim : null,
      ),
      "",
      url.toString(),
    );
  }

  return claim;
}

export function hasStagedClinicalRecordsConnectIntentForCurrentPath(): boolean {
  return Boolean(
    typeof window !== "undefined"
    && window.location.pathname === CLINICAL_RECORDS_CONNECT_PATH
    && readStagedClinicalRecordsConnectIntent(),
  );
}

function readCurrentUrl(): URL | null {
  try {
    return new URL(window.location.href);
  } catch {
    return null;
  }
}

function readHashParams(hash: string): URLSearchParams {
  return new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
}

function readStagedClinicalRecordsConnectIntent(): string | null {
  const state = window.history.state;
  if (!isRecord(state)) {
    return null;
  }

  return normalizeClinicalRecordsConnectIntentClaim(
    state[CLINICAL_RECORDS_INTENT_HISTORY_KEY],
  );
}

function withStagedClinicalRecordsConnectIntent(
  currentState: unknown,
  claim: string | null,
): Record<string, unknown> {
  const nextState = isRecord(currentState) ? { ...currentState } : {};

  if (claim) {
    nextState[CLINICAL_RECORDS_INTENT_HISTORY_KEY] = claim;
  } else {
    delete nextState[CLINICAL_RECORDS_INTENT_HISTORY_KEY];
  }

  return nextState;
}

function normalizeClinicalRecordsConnectIntentClaim(value: unknown): string | null {
  return typeof value === "string" && CLINICAL_RECORDS_INTENT_PATTERN.test(value)
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
