const CLINICAL_RECORDS_CONNECT_PATH = "/records/connect";
const CLINICAL_RECORDS_LAUNCH_PARAM = "launch";
const CLINICAL_RECORDS_LAUNCH_VALUE = "clinical-records";
const CLINICAL_RECORDS_INTENT_HASH_KEY = "clinicalRecordsIntent";
const CLINICAL_RECORDS_INTENT_HISTORY_KEY = "__murphClinicalRecordsConnectIntent";
const CLINICAL_RECORDS_INTENT_PATTERN = /^cr_[A-Za-z0-9_-]{32}$/u;

/**
 * Removes the bearer from the visible URL before the page can make a request.
 * Connect flows can keep it only in this history entry long enough for an auth
 * or session reload. The flow clears the staged copy once SMART start commits
 * or the server declares the intent terminal.
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

export function isClinicalRecordsConnectLauncherForCurrentPath(): boolean {
  if (
    typeof window === "undefined"
    || window.location.pathname !== CLINICAL_RECORDS_CONNECT_PATH
  ) {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  return params.size === 1
    && params.getAll(CLINICAL_RECORDS_LAUNCH_PARAM).length === 1
    && params.get(CLINICAL_RECORDS_LAUNCH_PARAM)
      === CLINICAL_RECORDS_LAUNCH_VALUE;
}

export function stageClinicalRecordsConnectIntentInBrowser(claim: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedClaim = normalizeClinicalRecordsConnectIntentClaim(claim);
  const url = readCurrentUrl();
  if (!normalizedClaim || !url) {
    throw new TypeError("Clinical Records connect intent claim is invalid.");
  }

  const hashParams = readHashParams(url.hash);
  hashParams.delete(CLINICAL_RECORDS_INTENT_HASH_KEY);
  url.hash = hashParams.toString();
  window.history.replaceState(
    withStagedClinicalRecordsConnectIntent(
      window.history.state,
      normalizedClaim,
    ),
    "",
    url.toString(),
  );
}

export function clearClinicalRecordsConnectIntentFromBrowser(): void {
  takeClinicalRecordsConnectIntentFromBrowser({ preserveForAuthReload: false });
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
