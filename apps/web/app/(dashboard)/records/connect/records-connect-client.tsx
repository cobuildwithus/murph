"use client";

import Link from "next/link";
import {
  ArrowRightIcon,
  Building2Icon,
  FileTextIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  MapPinIcon,
  RefreshCwIcon,
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
import { reloadCurrentHostedAuthDocument } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button, buttonVariants } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Skeleton } from "@/src/components/ui/skeleton";
import { Spinner } from "@/src/components/ui/spinner";
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
  type ClinicalProviderFacilityContract,
  type ClinicalProviderSearchResultContract,
} from "@/src/lib/clinical-records/client-contracts";
import { cn } from "@/src/lib/utils";

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

  const currentStep = consentRequired === false ? 1 : 0;

  return (
    <div className="max-w-5xl space-y-9">
      <ConnectJourney currentStep={currentStep} />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-12">
        {consentRequired !== false ? (
          <section aria-labelledby="records-consent-title" className="min-w-0 space-y-6">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
                Step 1 of 3
              </p>
              <h2 id="records-consent-title" className="mt-1 font-serif text-2xl font-medium tracking-tight text-foreground">
                Review how Murph uses your health data
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                You control whether Murph can save these records. Review the terms that apply before choosing where you get care.
              </p>
            </div>
            <HostedLegalConsentCard
              acceptedPendingLabel="Opening records search"
              initialStatus={null}
              mode="compact"
              onAccepted={reloadCurrentHostedAuthDocument}
              onRequirementChange={setConsentRequired}
              preferredScope="launch.legal"
              source="clinical-records-connect"
            />
          </section>
        ) : (
          <ProviderSearch
            intentClaim={intentClaim}
            onConsentRequired={() => setConsentRequired(true)}
          />
        )}

        <ImportBoundaryAside />
      </div>
    </div>
  );
}

function ConnectJourney({ currentStep }: { currentStep: number }) {
  const steps = [
    { description: "Check how Murph uses your health data", label: "Review" },
    { description: "Find your hospital or clinic", label: "Where you get care" },
    { description: "Sign in where you get care", label: "Patient portal" },
  ] as const;

  return (
    <section aria-label="Medical records connection progress" className="border-y border-border py-4 sm:py-5">
      <ol className="grid gap-4 sm:grid-cols-3 sm:gap-6">
        {steps.map((step, index) => {
          const active = index === currentStep;
          const complete = index < currentStep;
          return (
            <li key={step.label} aria-current={active ? "step" : undefined} className="flex items-start gap-3">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-medium tabular-nums",
                  active && "border-primary bg-primary text-primary-foreground",
                  complete && "border-primary/30 bg-primary/10 text-primary",
                  !active && !complete && "border-border text-muted-foreground",
                )}
              >
                {index + 1}
              </span>
              <div className="pt-0.5">
                <p className={cn("text-sm font-medium", active || complete ? "text-foreground" : "text-muted-foreground")}>
                  {step.label}
                </p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {step.description}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ImportBoundaryAside() {
  const facts = [
    {
      description: "Your patient portal password never enters Murph.",
      icon: KeyRoundIcon,
      label: "Your portal handles sign-in",
    },
    {
      description: "Murph copies records once. It does not keep checking your chart.",
      icon: RefreshCwIcon,
      label: "Copies once",
    },
    {
      description: "Lab results and report summaries available through your portal.",
      icon: FileTextIcon,
      label: "What gets copied",
    },
  ] as const;

  return (
    <aside className="border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
      <p className="font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
        What to expect
      </p>
      <div className="mt-5 space-y-6">
        {facts.map(({ description, icon: Icon, label }) => (
          <div key={label} className="flex gap-3">
            <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
            </div>
          </div>
        ))}
      </div>
    </aside>
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
  const startCommittedRef = useRef(false);
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
      searchInFlightRef.current = false;
      startInFlightRef.current = false;
      setSearchPending(false);
      setStartingProviderId(null);
      if (startCommittedRef.current) {
        setIntentUnavailable(true);
      }
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
    const operationGeneration = operationGenerationRef.current + 1;
    operationGenerationRef.current = operationGeneration;
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
      if (operationGenerationRef.current !== operationGeneration) {
        return;
      }
      setProviders(parsed.providers);
      setHasSearched(true);
      requestAnimationFrame(() => resultsHeadingRef.current?.focus());
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
    if (searchInFlightRef.current || startInFlightRef.current) {
      return;
    }

    startInFlightRef.current = true;
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
        `Could not continue with ${provider.brandName}. Choose it again or try another result.`,
      );
      setStartingProviderId(null);
    }
  }

  if (intentUnavailable) {
    return <UnavailableIntentState />;
  }

  return (
    <section aria-labelledby="provider-search-title" className="min-w-0 space-y-7">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
          Step 2 of 3
        </p>
        <h2 id="provider-search-title" className="mt-1 font-serif text-2xl font-medium tracking-tight text-foreground">
          Where do you get care?
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Search for the hospital or clinic whose patient portal you use. Murph supports selected portals right now.
        </p>
      </div>

      <form
        role="search"
        className="space-y-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          void searchProviders();
        }}
      >
        <label htmlFor="clinical-provider-search" className="font-mono text-[10px] uppercase tracking-[0.11em] text-foreground">
          Hospital or clinic
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
              maxLength={120}
              name="provider-search"
              placeholder="Hospital name, New York, NY, or 10001"
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
              className="font-serif text-xl font-medium tracking-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Matching places
            </h3>
            <p aria-live="polite" className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              {providers.length === 0
                ? "No matches"
                : `${providers.length} ${providers.length === 1 ? "match" : "matches"}.`}
            </p>
          </div>

          {providers.length > 0 ? (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
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
          ) : (
            <div className="flex gap-4 border-y border-border py-6">
              <SearchIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">This portal may not be supported</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Murph does not support every patient portal yet. Check the hospital or clinic name and city, or try another place where you get care.
                </p>
              </div>
            </div>
          )}
        </div>
      ) : null}
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
    <li className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="min-w-0 space-y-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Building2Icon aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="font-serif text-lg font-medium leading-6 tracking-tight text-foreground text-pretty">{provider.brandName}</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              Patient portal
            </p>
          </div>
        </div>
        {facilities.length > 0 ? (
          <ul className="space-y-1.5 pl-12 text-sm text-muted-foreground">
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
        aria-label={`Continue to ${provider.brandName} patient portal`}
        className="w-full sm:w-auto"
        disabled={disabled}
        onClick={onSelect}
        size="lg"
        type="button"
      >
        {pending ? <Spinner /> : null}
        {pending ? "Opening portal" : "Continue to portal"}
        {!pending ? <ArrowRightIcon aria-hidden="true" data-icon="inline-end" /> : null}
      </Button>
    </li>
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
    <div aria-busy="true" aria-label="Preparing records connection" className="max-w-5xl space-y-8" role="status">
      <Skeleton className="h-4 w-36" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="space-y-5">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
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
