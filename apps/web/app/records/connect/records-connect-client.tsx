"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { HostedLegalConsentCard } from "@/src/components/legal/hosted-legal-consent-card";
import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { reloadCurrentHostedAuthDocument } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import { LinkPageDots } from "@/src/components/link-page/link-page-dots";
import {
  LINK_PAGE_NIGHT_TOKENS,
  LINK_PAGE_PILL_CLASS,
  LinkPagePill,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";
import { LinkPageSignInScreen } from "@/src/components/link-page/link-page-sign-in";
import {
  clearClinicalRecordsConnectIntentFromBrowser,
  stageClinicalRecordsConnectIntentInBrowser,
  takeClinicalRecordsConnectIntentFromBrowser,
} from "@/src/lib/clinical-records/browser-connect-intent";
import {
  CLINICAL_RECORD_CONNECT_START_PATH,
  parseClinicalProviderSearchResponse,
  parseClinicalRecordConnectIntentResponse,
  parseClinicalRecordConnectStartResponse,
  type ClinicalProviderSearchResultContract,
} from "@/src/lib/clinical-records/client-contracts";

import { ProviderSearchView } from "./provider-search-view";

const PROVIDER_SEARCH_PATH = "/api/clinical-records/providers/search";
const CONNECT_INTENT_PATH = "/api/clinical-records/connect-intents";

export function RecordsConnectClient({
  authenticated,
  launchConnectIntent = false,
}: {
  authenticated: boolean;
  launchConnectIntent?: boolean;
}) {
  const [intentClaim, setIntentClaim] = useState<string | null | undefined>(undefined);
  const [launchFailed, setLaunchFailed] = useState(false);
  const [consentRequired, setConsentRequired] = useState<boolean | null>(null);
  const capturedIntentRef = useRef<string | null | undefined>(undefined);
  const launchPromiseRef = useRef<Promise<string> | null>(null);

  useLayoutEffect(() => {
    if (capturedIntentRef.current === undefined) {
      capturedIntentRef.current = takeClinicalRecordsConnectIntentFromBrowser({
        preserveForAuthReload: true,
      });
    }
    const capturedIntent = capturedIntentRef.current;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setIntentClaim(capturedIntent);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  useEffect(() => {
    if (
      !launchConnectIntent
      || !authenticated
      || intentClaim !== null
      || launchFailed
    ) {
      return;
    }
    let cancelled = false;
    const launchPromise = launchPromiseRef.current ?? requestHostedOnboardingJson<unknown>({
      method: "POST",
      payload: {},
      url: CONNECT_INTENT_PATH,
    }).then((response) => parseClinicalRecordConnectIntentResponse(response).claim);
    launchPromiseRef.current = launchPromise;
    void launchPromise
      .then((claim) => {
        if (cancelled) return;
        stageClinicalRecordsConnectIntentInBrowser(claim);
        setLaunchFailed(false);
        setIntentClaim(claim);
      })
      .catch(() => {
        if (launchPromiseRef.current === launchPromise) {
          launchPromiseRef.current = null;
        }
        if (!cancelled) {
          setLaunchFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, intentClaim, launchConnectIntent, launchFailed]);

  if (
    intentClaim === undefined
    || (
      launchConnectIntent
      && authenticated
      && intentClaim === null
      && !launchFailed
    )
  ) {
    return <RecordsConnectLauncherState state="loading" />;
  }

  if (!intentClaim) {
    if (launchConnectIntent && authenticated && launchFailed) {
      return (
        <RecordsConnectLauncherState
          onRetry={() => setLaunchFailed(false)}
          state="launch-failed"
        />
      );
    }
    if (launchConnectIntent && !authenticated) {
      return <RecordsConnectLauncherState state="authentication-required" />;
    }
    return <UnavailableIntentState />;
  }

  if (!authenticated) {
    return <RecordsConnectLauncherState state="authentication-required" />;
  }

  if (consentRequired === false) {
    return (
      <ProviderSearch intentClaim={intentClaim} onConsentRequired={() => setConsentRequired(true)} />
    );
  }

  return (
    <div className="flex flex-1 flex-col justify-center py-6" style={LINK_PAGE_NIGHT_TOKENS}>
      <HostedLegalConsentCard
        acceptedPendingLabel="Opening records search"
        initialStatus={null}
        mode="compact"
        onAccepted={reloadCurrentHostedAuthDocument}
        onRequirementChange={setConsentRequired}
        preferredScope="launch.legal"
        source="clinical-records-connect"
      />
    </div>
  );
}

export function ProviderSearch({
  intentClaim,
  onConsentRequired,
}: {
  intentClaim: string;
  onConsentRequired: () => void;
}) {
  const [providers, setProviders] = useState<readonly ClinicalProviderSearchResultContract[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchPending, setSearchPending] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [startingProviderId, setStartingProviderId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [intentUnavailable, setIntentUnavailable] = useState(false);
  const [query, setQuery] = useState("");
  const [keepUpdated, setKeepUpdated] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchInFlightRef = useRef(false);
  const startInFlightRef = useRef(false);
  const startCommittedRef = useRef(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const operationGenerationRef = useRef(0);
  const attachSearchInput = useCallback((node: HTMLInputElement | null) => {
    searchInputRef.current = node;
    if (!node) {
      return;
    }
    const activeElement = node.ownerDocument.activeElement;
    if (!activeElement || activeElement === node.ownerDocument.body) {
      node.focus();
    }
  }, []);

  useEffect(() => {
    function restoreAfterHistoryNavigation(event: PageTransitionEvent) {
      if (!event.persisted) {
        return;
      }
      operationGenerationRef.current += 1;
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchAbortRef.current?.abort();
      searchInFlightRef.current = false;
      startInFlightRef.current = false;
      setSearchPending(false);
      setStartingProviderId(null);
      if (startCommittedRef.current) {
        setIntentUnavailable(true);
      }
    }

    window.addEventListener("pageshow", restoreAfterHistoryNavigation);
    return () => {
      window.removeEventListener("pageshow", restoreAfterHistoryNavigation);
      operationGenerationRef.current += 1;
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchAbortRef.current?.abort();
    };
  }, []);

  function changeQuery(value: string, composing = false) {
    if (startInFlightRef.current || selectedProviderId) return;
    operationGenerationRef.current += 1;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchAbortRef.current?.abort();
    searchInFlightRef.current = false;
    setQuery(value);
    setSearchError(null);
    setHasSearched(false);
    setProviders([]);
    const shouldSearch = value.trim().length >= 2 && !composing;
    setSearchPending(shouldSearch);
    if (shouldSearch) searchTimerRef.current = setTimeout(() => { void searchProviders(); }, 300);
  }

  async function searchProviders() {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const normalizedQuery = searchInputRef.current?.value.trim() ?? "";
    if (!normalizedQuery) {
      if (searchInputRef.current) {
        searchInputRef.current.value = "";
        searchInputRef.current.reportValidity();
      }
      return;
    }
    if (searchInFlightRef.current || startInFlightRef.current) {
      return;
    }

    searchInFlightRef.current = true;
    searchAbortRef.current?.abort();
    const searchAbort = new AbortController();
    searchAbortRef.current = searchAbort;
    const operationGeneration = operationGenerationRef.current + 1;
    operationGenerationRef.current = operationGeneration;
    setSearchPending(true);
    setSearchError(null);
    setStartError(null);

    try {
      const response = await requestHostedOnboardingJson<unknown>({
        method: "POST",
        payload: { query: normalizedQuery },
        signal: searchAbort.signal,
        url: PROVIDER_SEARCH_PATH,
      });
      const parsed = parseClinicalProviderSearchResponse(response);
      if (operationGenerationRef.current !== operationGeneration) {
        return;
      }
      setProviders(parsed.providers);
      setHasSearched(true);
    } catch {
      if (operationGenerationRef.current !== operationGeneration) {
        return;
      }
      setProviders([]);
      setHasSearched(false);
      setSearchError("Hospitals and clinics could not be searched right now. Try again.");
    } finally {
      if (operationGenerationRef.current === operationGeneration) {
        searchInFlightRef.current = false;
        setSearchPending(false);
      }
    }
  }

  async function startConnection(provider: ClinicalProviderSearchResultContract) {
    if (selectedProviderId && selectedProviderId !== provider.id) return;
    if (searchInFlightRef.current || startInFlightRef.current) {
      return;
    }

    startInFlightRef.current = true;
    setSelectedProviderId(provider.id);
    const operationGeneration = operationGenerationRef.current + 1;
    operationGenerationRef.current = operationGeneration;
    setStartingProviderId(provider.id);
    setStartError(null);

    const markStartCommitted = () => {
      if (startCommittedRef.current) {
        return;
      }
      startCommittedRef.current = true;
      if (operationGenerationRef.current !== operationGeneration) {
        setIntentUnavailable(true);
      }
      clearClinicalRecordsConnectIntentFromBrowser();
    };

    try {
      const response = await requestHostedOnboardingJson<unknown>({
        method: "POST",
        onSuccessfulResponseHeaders: markStartCommitted,
        payload: {
          claim: intentClaim,
          keepUpdated,
          providerDirectoryEntryId: provider.id,
        },
        url: CLINICAL_RECORD_CONNECT_START_PATH,
      });
      markStartCommitted();
      const parsed = parseClinicalRecordConnectStartResponse(response);
      if (operationGenerationRef.current !== operationGeneration) {
        return;
      }
      const authorizationUrl = new URL(parsed.authorizationUrl);
      if (authorizationUrl.protocol !== "https:") {
        throw new TypeError("Clinical Records authorization URL must use HTTPS.");
      }
      window.location.assign(parsed.authorizationUrl);
    } catch (error) {
      if (operationGenerationRef.current !== operationGeneration) {
        return;
      }
      if (startCommittedRef.current) {
        startInFlightRef.current = false;
        setIntentUnavailable(true);
        setStartingProviderId(null);
        return;
      }
      if (isConsentRequiredError(error)) {
        startInFlightRef.current = false;
        setStartingProviderId(null);
        onConsentRequired();
        return;
      }
      if (isUnavailableIntentError(error)) {
        startInFlightRef.current = false;
        clearClinicalRecordsConnectIntentFromBrowser();
        setIntentUnavailable(true);
        setStartingProviderId(null);
        return;
      }

      startInFlightRef.current = false;
      setStartError(
        `Could not continue with ${provider.brandName}. Try this portal again, or start a new connection to choose another.`,
      );
      setStartingProviderId(null);
    }
  }

  if (intentUnavailable) {
    return <UnavailableIntentState />;
  }

  return (
    <ProviderSearchView
      keepUpdated={keepUpdated}
      onKeepUpdatedChange={setKeepUpdated}
      query={query}
      providers={providers}
      hasSearched={hasSearched}
      searchPending={searchPending}
      searchError={searchError}
      startError={startError}
      startingProviderId={startingProviderId}
      selectedProviderId={selectedProviderId}
      inputRef={attachSearchInput}
      onQueryChange={changeQuery}
      onSearch={() => { void searchProviders(); }}
      onSelect={(provider) => { void startConnection(provider); }}
      onRestart={clearClinicalRecordsConnectIntentFromBrowser}
    />
  );
}

export function RecordsConnectLauncherState({
  onRetry,
  state,
}: {
  onRetry?: () => void;
  state: "authentication-required" | "launch-failed" | "loading";
}) {
  if (state === "loading") return <ConnectPageLoading />;
  if (state === "launch-failed") {
    return <LaunchFailedState onRetry={onRetry ?? (() => undefined)} />;
  }
  return (
    <LinkPageSignInScreen
      detail="Then find the hospital or clinic whose portal you use."
      title="Sign in to connect your records."
    />
  );
}

function ConnectPageLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Preparing records connection"
      className="flex flex-1 flex-col"
      role="status"
    >
      <LinkPageScreen title="One moment.">
        <LinkPageDots />
      </LinkPageScreen>
    </div>
  );
}

function LaunchFailedState({ onRetry }: { onRetry: () => void }) {
  return (
    <LinkPageScreen
      actions={<LinkPagePill onClick={onRetry}>Try again</LinkPagePill>}
      detail="Your link is still valid, so you can try again now."
      title="Couldn’t start this."
    />
  );
}

export function UnavailableIntentState() {
  return (
    <LinkPageScreen
      actions={
        <a className={LINK_PAGE_PILL_CLASS} href="/records/connect?launch=clinical-records">
          Start a new connection
        </a>
      }
      detail="It’s missing, expired, or already used."
      title="This link isn’t working."
    />
  );
}

function isConsentRequiredError(error: unknown): boolean {
  return error instanceof HostedOnboardingApiError
    && error.code === "HOSTED_CONSENT_REQUIRED";
}

function isUnavailableIntentError(error: unknown): boolean {
  return error instanceof HostedOnboardingApiError
    && [
      "CLINICAL_RECORD_CONNECT_INTENT_EXPIRED",
      "CLINICAL_RECORD_CONNECT_INTENT_INVALID",
      "CLINICAL_RECORD_CONNECT_INTENT_SUPERSEDED",
      "CLINICAL_RECORD_CONNECT_INTENT_USED",
    ].includes(error.code ?? "");
}
