"use client";

import Link from "next/link";
import {
  Building2Icon,
  LockKeyholeIcon,
  MapPinIcon,
  SearchIcon,
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
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button, buttonVariants } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Skeleton } from "@/src/components/ui/skeleton";
import { Spinner } from "@/src/components/ui/spinner";
import { takeClinicalRecordsConnectIntentFromBrowser } from "@/src/lib/clinical-records/browser-connect-intent";
import {
  CLINICAL_RECORD_CONNECT_START_PATH,
  parseClinicalProviderSearchResponse,
  parseClinicalRecordConnectStartResponse,
  type ClinicalProviderFacilityContract,
  type ClinicalProviderSearchResultContract,
} from "@/src/lib/clinical-records/client-contracts";
import { cn } from "@/src/lib/utils";

const PROVIDER_SEARCH_PATH = "/api/clinical-records/providers/search";

export function RecordsConnectClient({ authenticated }: { authenticated: boolean }) {
  const [intentClaim, setIntentClaim] = useState<string | null | undefined>(undefined);
  const [consentRequired, setConsentRequired] = useState<boolean | null>(null);
  const authOpenedRef = useRef(false);
  const capturedIntentRef = useRef<string | null | undefined>(undefined);
  const { openAuthDialog } = useAuth();

  useLayoutEffect(() => {
    if (capturedIntentRef.current === undefined) {
      capturedIntentRef.current = takeClinicalRecordsConnectIntentFromBrowser({
        preserveForAuthReload: !authenticated,
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
      || !intentClaim
      || authOpenedRef.current
    ) {
      return;
    }

    authOpenedRef.current = true;
    openAuthDialog();
  }, [authenticated, intentClaim, openAuthDialog]);

  if (intentClaim === undefined) {
    return <ConnectPageSkeleton />;
  }

  if (!intentClaim) {
    return <UnavailableIntentState />;
  }

  if (!authenticated) {
    return <AuthRequiredState onSignIn={openAuthDialog} />;
  }

  return (
    <div className="max-w-3xl space-y-6">
      {consentRequired !== false ? (
        <section aria-labelledby="records-consent-title" className="space-y-4">
          <div className="space-y-1">
            <h2 id="records-consent-title" className="font-serif text-xl font-medium text-foreground">
              Before you choose an organization
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Review Murph&apos;s health-data terms. This beta makes one import of supported Epic laboratory results and diagnostic summaries.
            </p>
          </div>
          <HostedLegalConsentCard
            initialStatus={null}
            onAccepted={() => setConsentRequired(false)}
            onRequirementChange={setConsentRequired}
            preferredScope="launch.legal"
            source="clinical-records-connect"
          />
        </section>
      ) : (
        <ProviderSearch intentClaim={intentClaim} onConsentRequired={() => setConsentRequired(true)} />
      )}
    </div>
  );
}

function ProviderSearch({
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
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchInFlightRef = useRef(false);
  const startInFlightRef = useRef(false);
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
      searchInFlightRef.current = false;
      startInFlightRef.current = false;
      setSearchPending(false);
      setStartingProviderId(null);
    }

    window.addEventListener("pageshow", restoreAfterHistoryNavigation);
    return () => window.removeEventListener("pageshow", restoreAfterHistoryNavigation);
  }, []);

  async function searchProviders() {
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
    setSearchPending(true);
    setSearchError(null);
    setStartError(null);

    try {
      const response = await requestHostedOnboardingJson<unknown>({
        method: "POST",
        payload: { query: normalizedQuery },
        url: PROVIDER_SEARCH_PATH,
      });
      const parsed = parseClinicalProviderSearchResponse(response);
      setProviders(parsed.providers);
      setHasSearched(true);
      requestAnimationFrame(() => resultsHeadingRef.current?.focus());
    } catch (error) {
      setProviders([]);
      setHasSearched(false);
      setSearchError(readRequestError(
        error,
        "Epic organizations could not be searched right now. Try again.",
      ));
    } finally {
      searchInFlightRef.current = false;
      setSearchPending(false);
    }
  }

  async function startConnection(provider: ClinicalProviderSearchResultContract) {
    if (searchInFlightRef.current || startInFlightRef.current) {
      return;
    }

    startInFlightRef.current = true;
    setStartingProviderId(provider.id);
    setStartError(null);

    try {
      const response = await requestHostedOnboardingJson<unknown>({
        method: "POST",
        payload: {
          claim: intentClaim,
          providerDirectoryEntryId: provider.id,
        },
        url: CLINICAL_RECORD_CONNECT_START_PATH,
      });
      const parsed = parseClinicalRecordConnectStartResponse(response);
      const authorizationUrl = new URL(parsed.authorizationUrl);
      if (authorizationUrl.protocol !== "https:") {
        throw new TypeError("Clinical Records authorization URL must use HTTPS.");
      }
      window.location.assign(parsed.authorizationUrl);
    } catch (error) {
      if (isConsentRequiredError(error)) {
        startInFlightRef.current = false;
        setStartingProviderId(null);
        onConsentRequired();
        return;
      }
      if (isUnavailableIntentError(error)) {
        startInFlightRef.current = false;
        setIntentUnavailable(true);
        setStartingProviderId(null);
        return;
      }

      startInFlightRef.current = false;
      setStartError(readRequestError(
        error,
        `Could not continue with ${provider.brandName}. Choose the organization again or try another result.`,
      ));
      setStartingProviderId(null);
    }
  }

  if (intentUnavailable) {
    return <UnavailableIntentState />;
  }

  return (
    <section aria-labelledby="provider-search-title" className="space-y-6">
      <div className="space-y-1">
        <h2 id="provider-search-title" className="font-serif text-xl font-medium text-foreground">
          Find your Epic organization
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Search by health system, hospital, clinic, city, state, or ZIP code. You will choose the organization before leaving Murph.
        </p>
      </div>

      <form
        role="search"
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void searchProviders();
        }}
      >
        <label htmlFor="clinical-provider-search" className="text-sm font-medium text-foreground">
          Organization or location
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="clinical-provider-search"
              autoComplete="off"
              className="pl-11"
              inputSize="lg"
              name="provider-search"
              placeholder="Piedmont, Atlanta, GA, or 30309"
              readOnly={searchPending || Boolean(startingProviderId)}
              ref={attachSearchInput}
              required
            />
          </div>
          <Button
            aria-busy={searchPending}
            className="w-full sm:w-auto"
            disabled={searchPending || Boolean(startingProviderId)}
            size="lg"
            type="submit"
          >
            {searchPending ? <Spinner /> : <SearchIcon aria-hidden="true" />}
            {searchPending ? "Searching" : "Search"}
          </Button>
        </div>
      </form>

      {searchError ? (
        <Alert variant="destructive">
          <AlertTitle>Search unavailable</AlertTitle>
          <AlertDescription>{searchError}</AlertDescription>
        </Alert>
      ) : null}

      {startError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not start the connection</AlertTitle>
          <AlertDescription>{startError}</AlertDescription>
        </Alert>
      ) : null}

      {hasSearched ? (
        <div
          aria-busy={searchPending}
          className={cn("space-y-3 transition-opacity", searchPending && "opacity-60")}
        >
          <div>
            <h3
              ref={resultsHeadingRef}
              tabIndex={-1}
              className="font-serif text-lg font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Search results
            </h3>
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {providers.length === 0
                ? "No matching Epic organizations found. Try a broader name or location."
                : `${providers.length} ${providers.length === 1 ? "organization" : "organizations"} found.`}
            </p>
          </div>

          {providers.length > 0 ? (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {providers.map((provider) => (
                <ProviderResult
                  key={provider.id}
                  disabled={searchPending || Boolean(startingProviderId)}
                  pending={startingProviderId === provider.id}
                  provider={provider}
                  onSelect={() => void startConnection(provider)}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <p className="border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
        This beta performs one import of supported Epic laboratory results and diagnostic summaries. It does not continuously sync your chart.
      </p>
    </section>
  );
}

function ProviderResult({
  disabled,
  onSelect,
  pending,
  provider,
}: {
  disabled: boolean;
  onSelect: () => void;
  pending: boolean;
  provider: ClinicalProviderSearchResultContract;
}) {
  const facilities = formatFacilities(provider.facilities);

  return (
    <li className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div className="min-w-0 space-y-2">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-primary">
            <Building2Icon aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="font-medium leading-6 text-foreground text-pretty">{provider.brandName}</p>
            <p className="text-xs text-muted-foreground">Epic patient portal</p>
          </div>
        </div>
        {facilities.length > 0 ? (
          <ul className="space-y-1 pl-11 text-sm text-muted-foreground">
            {facilities.map((facility) => (
              <li key={facility} className="flex items-start gap-1.5">
                <MapPinIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span className="text-pretty">{facility}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <Button
        aria-busy={pending}
        aria-label={`Continue with ${provider.brandName}`}
        className="w-full sm:w-auto"
        disabled={disabled}
        onClick={onSelect}
        size="lg"
        type="button"
      >
        {pending ? <Spinner /> : null}
        {pending ? "Opening Epic" : "Continue"}
      </Button>
    </li>
  );
}

function ConnectPageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Preparing Epic connection" className="max-w-3xl space-y-5" role="status">
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-4 w-full max-w-xl" />
      <Skeleton className="h-32 w-full rounded-2xl" />
    </div>
  );
}

function AuthRequiredState({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section className="max-w-2xl rounded-2xl border border-border bg-card p-6 sm:p-8">
      <span className="flex size-10 items-center justify-center rounded-full border border-border bg-background text-primary">
        <LockKeyholeIcon aria-hidden="true" className="size-5" />
      </span>
      <h2 className="mt-5 font-serif text-2xl font-medium text-foreground">Sign in to continue</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        This private connection link is bound to your Murph account. Sign in, then choose the Epic organization whose portal you use.
      </p>
      <Button className="mt-6 w-full sm:w-auto" onClick={onSignIn} size="lg" type="button">
        Log in or sign up
      </Button>
    </section>
  );
}

function UnavailableIntentState() {
  return (
    <section className="max-w-2xl rounded-2xl border border-border bg-card p-6 sm:p-8">
      <h2 className="font-serif text-2xl font-medium text-foreground">Connection link unavailable</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        This private link is missing, expired, or already used. Start a new Epic connection from Medical records.
      </p>
      <Link
        href="/records"
        className={cn(buttonVariants({ size: "lg" }), "mt-6 w-full sm:w-auto")}
      >
        Back to medical records
      </Link>
    </section>
  );
}

function formatFacilities(
  facilities: readonly ClinicalProviderFacilityContract[],
): string[] {
  const labels = new Set<string>();
  for (const facility of facilities) {
    const location = [facility.city, facility.state, facility.postalCode]
      .filter((part): part is string => Boolean(part))
      .join(", ");
    const label = [facility.name, location]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
    if (label) {
      labels.add(label);
    }
    if (labels.size === 3) {
      break;
    }
  }
  return [...labels];
}

function readRequestError(error: unknown, fallback: string): string {
  return error instanceof HostedOnboardingApiError && error.message
    ? error.message
    : fallback;
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
