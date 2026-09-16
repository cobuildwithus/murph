"use client";

import {
  LockKeyholeIcon,
  RefreshCwIcon,
} from "lucide-react";
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
import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { reloadCurrentHostedAuthDocument } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import { Button, buttonVariants } from "@/src/components/ui/button";
import { Skeleton } from "@/src/components/ui/skeleton";
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
import { cn } from "@/src/lib/utils";

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
  const authOpenedRef = useRef(false);
  const capturedIntentRef = useRef<string | null | undefined>(undefined);
  const launchPromiseRef = useRef<Promise<string> | null>(null);
  const { openAuthDialog } = useAuth();

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
      authenticated
      || (!intentClaim && !launchConnectIntent)
      || authOpenedRef.current
    ) {
      return;
    }

    authOpenedRef.current = true;
    openAuthDialog();
  }, [authenticated, intentClaim, launchConnectIntent, openAuthDialog]);

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
      return (
        <RecordsConnectLauncherState
          onSignIn={openAuthDialog}
          state="authentication-required"
        />
      );
    }
    return <UnavailableIntentState />;
  }

  if (!authenticated) {
    return <AuthRequiredState onSignIn={openAuthDialog} />;
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {consentRequired !== false ? (
        <HostedLegalConsentCard
          acceptedPendingLabel="Opening records search"
          initialStatus={null}
          mode="compact"
          onAccepted={reloadCurrentHostedAuthDocument}
          onRequirementChange={setConsentRequired}
          preferredScope="launch.legal"
          source="clinical-records-connect"
        />
      ) : (
        <ProviderSearch intentClaim={intentClaim} onConsentRequired={() => setConsentRequired(true)} />
      )}
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
  onSignIn,
  state,
}: {
  onRetry?: () => void;
  onSignIn?: () => void;
  state: "authentication-required" | "launch-failed" | "loading";
}) {
  if (state === "loading") return <ConnectPageSkeleton />;
  if (state === "launch-failed") {
    return <LaunchFailedState onRetry={onRetry ?? (() => undefined)} />;
  }
  return <AuthRequiredState onSignIn={onSignIn ?? (() => undefined)} />;
}

function ConnectPageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Preparing records connection" className="flex max-w-2xl flex-col gap-4" role="status">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}

function AuthRequiredState({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section className="max-w-2xl rounded-xl border border-border bg-card p-6 sm:p-8">
      <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <LockKeyholeIcon aria-hidden="true" className="size-5" />
      </span>
      <h2 className="mt-5 font-serif text-2xl font-medium text-foreground">Sign in to continue</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        This private link belongs to your Murph account. Sign in, then find the hospital or clinic whose patient portal you use.
      </p>
      <Button className="mt-6 w-full sm:w-auto" onClick={onSignIn} size="lg" type="button">
        Log in or sign up
      </Button>
    </section>
  );
}

function LaunchFailedState({ onRetry }: { onRetry: () => void }) {
  return (
    <section
      aria-atomic="true"
      aria-live="polite"
      className="max-w-2xl rounded-xl border border-border bg-card p-6 sm:p-8"
      role="status"
    >
      <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <RefreshCwIcon aria-hidden="true" className="size-5" />
      </span>
      <h2 className="mt-5 text-balance font-serif text-2xl font-medium text-foreground">
        Couldn&apos;t start Clinical Records
      </h2>
      <p className="mt-2 max-w-xl text-pretty text-sm leading-6 text-muted-foreground">
        The secure connection could not be prepared. Your link is still valid, so you can try again now.
      </p>
      <Button className="mt-6 w-full sm:w-auto" onClick={onRetry} size="lg" type="button">
        <RefreshCwIcon aria-hidden="true" data-icon="inline-start" />
        Try again
      </Button>
    </section>
  );
}

function UnavailableIntentState() {
  return (
    <section
      aria-atomic="true"
      aria-live="polite"
      className="max-w-2xl rounded-xl border border-border bg-card p-6 sm:p-8"
      role="status"
    >
      <h2 className="font-serif text-2xl font-medium text-foreground">Connection link unavailable</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        This private link is missing, expired, or already used. Start a new connection from Medical records.
      </p>
      <a
        href="/records/connect?launch=clinical-records"
        className={cn(buttonVariants({ size: "lg" }), "mt-6 w-full sm:w-auto")}
      >
        Start a new connection
      </a>
    </section>
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
