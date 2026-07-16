"use client";

import {
  parseHostedRuntimeLabsToolResponse,
  type HostedRuntimeLabsLocation,
  type HostedRuntimeLabsLocationsRequest,
  type HostedRuntimeLabsLocationsResponse,
  type HostedRuntimeLabsOffering,
  type HostedRuntimeLabsSearchRequest,
  type HostedRuntimeLabsSearchResponse,
} from "@murphai/hosted-execution/labs";
import { ChevronDownIcon, InfoIcon, SearchIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/src/components/ui/alert";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/src/components/ui/field";
import { Input } from "@/src/components/ui/input";
import { PageHeader } from "@/src/components/ui/page-header";
import { ResponsiveSelect } from "@/src/components/ui/responsive-select";
import { Skeleton } from "@/src/components/ui/skeleton";
import { Spinner } from "@/src/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";

const SEARCH_LIMIT = 20;
const LOCATION_LIMIT = 8;
const LOCATION_RADIUS_MILES = 25 as const;
const ZIP_CODE_PATTERN = /^\d{5}$/u;

const SEARCH_KIND_OPTIONS = [
  { label: "All catalog items", value: "all" },
  { label: "Panels", value: "panel" },
  { label: "Individual tests", value: "biomarker" },
];

type SearchKind = HostedRuntimeLabsSearchRequest["kind"] & string;

type SearchState =
  | { status: "idle" }
  | { request: HostedRuntimeLabsSearchRequest; status: "loading" }
  | {
      data: HostedRuntimeLabsSearchResponse;
      request: HostedRuntimeLabsSearchRequest;
      status: "success";
    }
  | {
      failure: LabsRequestFailure;
      request: HostedRuntimeLabsSearchRequest;
      status: "error";
    };

type LocationsState =
  | { status: "idle" }
  | { request: HostedRuntimeLabsLocationsRequest; status: "loading" }
  | {
      data: HostedRuntimeLabsLocationsResponse;
      request: HostedRuntimeLabsLocationsRequest;
      status: "success";
    }
  | {
      failure: LabsRequestFailure;
      request: HostedRuntimeLabsLocationsRequest;
      status: "error";
    };

type LabsRequestFailure = "auth" | "unavailable";

interface RequestTracker {
  controller: AbortController | null;
  id: number;
}

export function LabsPageClient() {
  const [query, setQuery] = useState("");
  const [searchKind, setSearchKind] = useState<SearchKind>("all");
  const [searchValidationError, setSearchValidationError] = useState<string | null>(null);
  const [searchState, setSearchState] = useState<SearchState>({ status: "idle" });
  const [expandedOfferingId, setExpandedOfferingId] = useState<string | null>(null);
  const [zipCode, setZipCode] = useState("");
  const [zipValidationError, setZipValidationError] = useState<string | null>(null);
  const [locationsState, setLocationsState] = useState<LocationsState>({ status: "idle" });

  const searchTracker = useRef<RequestTracker>({ controller: null, id: 0 });
  const locationsTracker = useRef<RequestTracker>({ controller: null, id: 0 });

  useEffect(() => {
    const activeSearchTracker = searchTracker.current;
    const activeLocationsTracker = locationsTracker.current;

    return () => {
      activeSearchTracker.controller?.abort();
      activeLocationsTracker.controller?.abort();
    };
  }, []);

  async function runSearch(request: HostedRuntimeLabsSearchRequest) {
    setExpandedOfferingId(null);
    setSearchState({ request, status: "loading" });

    const tracked = startTrackedRequest(searchTracker.current);

    try {
      const data = await requestLabs(request, tracked.controller.signal);
      if (!isCurrentRequest(searchTracker.current, tracked)) {
        return;
      }

      setSearchState({ data, request, status: "success" });
    } catch (error) {
      if (isAbortError(error) || !isCurrentRequest(searchTracker.current, tracked)) {
        return;
      }

      setSearchState({
        failure: classifyLabsRequestFailure(error),
        request,
        status: "error",
      });
    }
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedQuery = query.trim();

    if (normalizedQuery.length < 2) {
      setSearchValidationError("Enter at least 2 characters.");
      return;
    }

    if (normalizedQuery.length > 120) {
      setSearchValidationError("Keep the search to 120 characters or fewer.");
      return;
    }

    setSearchValidationError(null);
    void runSearch({
      action: "search",
      kind: searchKind,
      limit: SEARCH_LIMIT,
      query: normalizedQuery,
    });
  }

  function toggleDetails(item: HostedRuntimeLabsOffering) {
    setExpandedOfferingId((current) =>
      current === item.offeringId ? null : item.offeringId,
    );
  }

  async function runLocations(request: HostedRuntimeLabsLocationsRequest) {
    setLocationsState({ request, status: "loading" });
    const tracked = startTrackedRequest(locationsTracker.current);

    try {
      const data = await requestLabs(request, tracked.controller.signal);
      if (!isCurrentRequest(locationsTracker.current, tracked)) {
        return;
      }

      setLocationsState({ data, request, status: "success" });
    } catch (error) {
      if (isAbortError(error) || !isCurrentRequest(locationsTracker.current, tracked)) {
        return;
      }

      setLocationsState({
        failure: classifyLabsRequestFailure(error),
        request,
        status: "error",
      });
    }
  }

  function handleLocationsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedZipCode = zipCode.trim();

    if (!ZIP_CODE_PATTERN.test(normalizedZipCode)) {
      setZipValidationError("Enter a 5-digit ZIP code.");
      return;
    }

    setZipValidationError(null);
    void runLocations({
      action: "locations",
      limit: LOCATION_LIMIT,
      radiusMiles: LOCATION_RADIUS_MILES,
      zipCode: normalizedZipCode,
    });
  }

  return (
    <div className="flex flex-col gap-10 pb-8">
      <div className="flex flex-col gap-5">
        <PageHeader
          eyebrow="Live catalog preview"
          title="Labs"
          description="Search Junction's current test catalog and explore nearby collection sites. This preview reads live provider data without saving your searches."
        />

        <Alert>
          <InfoIcon />
          <AlertTitle>Discovery only</AlertTitle>
          <AlertDescription>
            Ordering through Murph is not available yet. Listed amounts are current Junction
            catalog prices, not final quotes. Catalog and location listings do not confirm
            eligibility or appointment availability.
          </AlertDescription>
        </Alert>
      </div>

      <section aria-labelledby="labs-catalog-heading" className="flex flex-col gap-5">
        <SectionHeading
          index="01"
          title="Search the live catalog"
          description="Look for a test, panel, or named biomarker. Results stay in Junction's relevance order."
          id="labs-catalog-heading"
        />

        <form
          aria-label="Search live test catalog"
          className="border-y border-border py-5"
          onSubmit={handleSearchSubmit}
        >
          <FieldGroup className="gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-end">
            <Field data-invalid={searchValidationError ? true : undefined}>
              <FieldLabel htmlFor="labs-catalog-query">Test, panel, or biomarker</FieldLabel>
              <Input
                aria-describedby={searchValidationError
                  ? "labs-catalog-query-description labs-catalog-query-error"
                  : "labs-catalog-query-description"}
                aria-invalid={searchValidationError ? true : undefined}
                autoComplete="off"
                id="labs-catalog-query"
                inputMode="search"
                maxLength={121}
                onInput={(event) => {
                  setQuery(event.currentTarget.value);
                  if (searchValidationError) {
                    setSearchValidationError(null);
                  }
                }}
                placeholder="Cholesterol, thyroid panel, ApoB..."
                type="search"
                value={query}
              />
              <FieldDescription id="labs-catalog-query-description">
                Use a specific name for the most precise match.
              </FieldDescription>
              {searchValidationError ? (
                <FieldError id="labs-catalog-query-error">{searchValidationError}</FieldError>
              ) : null}
            </Field>

            <Field aria-labelledby="labs-kind-label">
              <FieldLabel id="labs-kind-label">Catalog type</FieldLabel>
              <ResponsiveSelect
                ariaLabel="Catalog type"
                onValueChange={(value) => {
                  if (isSearchKind(value)) {
                    setSearchKind(value);
                  }
                }}
                options={SEARCH_KIND_OPTIONS}
                value={searchKind}
              />
              <FieldDescription>Panels group tests; individual tests target one marker.</FieldDescription>
            </Field>

            <Button
              disabled={searchState.status === "loading"}
              size="lg"
              type="submit"
            >
              {searchState.status === "loading" ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <SearchIcon data-icon="inline-start" />
              )}
              {searchState.status === "loading" ? "Searching" : "Search catalog"}
            </Button>
          </FieldGroup>
        </form>

        <p aria-live="polite" className="sr-only" id="labs-catalog-status">
          {catalogStatusText(searchState)}
        </p>

        <CatalogResults
          expandedOfferingId={expandedOfferingId}
          onRetrySearch={(request) => void runSearch(request)}
          onToggleDetails={toggleDetails}
          state={searchState}
        />
      </section>

      <section aria-labelledby="labs-locations-heading" className="flex flex-col gap-5">
        <SectionHeading
          index="02"
          title="Find nearby collection sites"
          description="Check general collection coverage within 25 miles of a ZIP code. This search is separate from the catalog above."
          id="labs-locations-heading"
        />

        <form
          aria-label="Find collection locations"
          className="border-y border-border py-5"
          noValidate
          onSubmit={handleLocationsSubmit}
        >
          <FieldGroup className="gap-4 sm:grid sm:grid-cols-[minmax(0,320px)_auto] sm:items-end">
            <Field data-invalid={zipValidationError ? true : undefined}>
              <FieldLabel htmlFor="labs-location-zip">ZIP code</FieldLabel>
              <Input
                aria-describedby={zipValidationError
                  ? "labs-location-zip-description labs-location-zip-error"
                  : "labs-location-zip-description"}
                aria-invalid={zipValidationError ? true : undefined}
                autoComplete="postal-code"
                id="labs-location-zip"
                inputMode="numeric"
                maxLength={5}
                onInput={(event) => {
                  setZipCode(event.currentTarget.value);
                  if (zipValidationError) {
                    setZipValidationError(null);
                  }
                }}
                pattern="[0-9]{5}"
                placeholder="10001"
                value={zipCode}
              />
              <FieldDescription id="labs-location-zip-description">
                Your ZIP is used for this lookup and is not saved by this page.
              </FieldDescription>
              {zipValidationError ? (
                <FieldError id="labs-location-zip-error">{zipValidationError}</FieldError>
              ) : null}
            </Field>

            <Button
              disabled={locationsState.status === "loading"}
              size="lg"
              type="submit"
              variant="secondary"
            >
              {locationsState.status === "loading" ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              {locationsState.status === "loading" ? "Checking" : "Check locations"}
            </Button>
          </FieldGroup>
        </form>

        <p aria-live="polite" className="sr-only" id="labs-locations-status">
          {locationsStatusText(locationsState)}
        </p>

        <LocationsResults
          onRetry={(request) => void runLocations(request)}
          state={locationsState}
        />

        <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
          A nearby site listing does not confirm that a particular test can be collected
          there, your eligibility, appointment availability, or a reservation.
        </p>
      </section>
    </div>
  );
}

function SectionHeading({
  description,
  id,
  index,
  title,
}: {
  description: string;
  id: string;
  index: string;
  title: string;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[48px_minmax(0,1fr)] sm:gap-4">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {index}
      </span>
      <div>
        <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground" id={id}>
          {title}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function CatalogResults({
  expandedOfferingId,
  onRetrySearch,
  onToggleDetails,
  state,
}: {
  expandedOfferingId: string | null;
  onRetrySearch: (request: HostedRuntimeLabsSearchRequest) => void;
  onToggleDetails: (item: HostedRuntimeLabsOffering) => void;
  state: SearchState;
}) {
  if (state.status === "idle") {
    return (
      <p className="text-sm text-muted-foreground">
        No catalog search yet. Try a panel name or a specific biomarker.
      </p>
    );
  }

  if (state.status === "loading") {
    return <CatalogLoading />;
  }

  if (state.status === "error") {
    if (state.failure === "auth") {
      return (
        <LabsAuthAlert>
          Refresh this page, then sign in again if prompted. Your search was not saved.
        </LabsAuthAlert>
      );
    }

    return (
      <Alert variant="destructive">
        <AlertTitle>Catalog temporarily unavailable</AlertTitle>
        <AlertDescription>
          The live catalog could not be loaded. Your search was not saved.
        </AlertDescription>
        <AlertAction>
          <Button
            onClick={() => onRetrySearch(state.request)}
            size="sm"
            type="button"
            variant="outline"
          >
            Retry
          </Button>
        </AlertAction>
      </Alert>
    );
  }

  if (state.data.items.length === 0) {
    const filteredKind = state.request.kind === "panel"
      ? "panels"
      : state.request.kind === "biomarker"
        ? "individual tests"
        : null;
    return (
      <Alert>
        <AlertTitle>
          {filteredKind ? `No matching ${filteredKind} returned` : "No matching tests returned"}
        </AlertTitle>
        <AlertDescription>
          {filteredKind
            ? "Try All catalog items or a shorter provider-facing name."
            : "Try a shorter provider-facing name or a related term."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div aria-busy="false" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <p className="text-sm text-muted-foreground">
          <span className="font-serif text-xl font-semibold text-foreground">
            {state.data.items.length}
          </span>{" "}
          {catalogResultSummary(state.data)}
        </p>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Live Junction catalog · {formatCheckedAt(state.data.checkedAt)}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Test or panel</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="hidden md:table-cell">Included</TableHead>
              <TableHead className="hidden lg:table-cell">Turnaround</TableHead>
              <TableHead className="text-right">Catalog price</TableHead>
              <TableHead>
                <span className="sr-only">Details</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.data.items.map((item, index) => {
              const detailId = `labs-offering-detail-${index}`;
              const expanded = expandedOfferingId === item.offeringId;

              return (
                <CatalogOfferingRows
                  checkedAt={state.data.checkedAt}
                  detailId={detailId}
                  expanded={expanded}
                  item={item}
                  key={item.offeringId}
                  onToggleDetails={onToggleDetails}
                />
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Prices shown are current Junction catalog amounts and may not be the final quote.
      </p>
    </div>
  );
}

function CatalogOfferingRows({
  checkedAt,
  detailId,
  expanded,
  item,
  onToggleDetails,
}: {
  checkedAt: string;
  detailId: string;
  expanded: boolean;
  item: HostedRuntimeLabsOffering;
  onToggleDetails: (item: HostedRuntimeLabsOffering) => void;
}) {
  return (
    <>
      <TableRow>
        <TableCell className="min-w-52 whitespace-normal">
          <span className="font-serif text-base font-semibold text-foreground">{item.name}</span>
          {item.unit ? (
            <span className="mt-0.5 block text-xs text-muted-foreground">Measured in {item.unit}</span>
          ) : null}
        </TableCell>
        <TableCell>
          <Badge variant={item.kind === "panel" ? "secondary" : "outline"}>
            {formatOfferingKind(item.kind)}
          </Badge>
        </TableCell>
        <TableCell className="hidden max-w-64 whitespace-normal md:table-cell">
          {formatIncludedMarkerPreview(item)}
        </TableCell>
        <TableCell className="hidden lg:table-cell">
          {formatTurnaround(item)}
        </TableCell>
        <TableCell className="text-right">
          <span className="font-serif text-base font-semibold text-foreground">
            {formatCatalogPrice(item)}
          </span>
        </TableCell>
        <TableCell className="text-right">
          <Button
            aria-controls={expanded ? detailId : undefined}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "View"} details for ${item.name}`}
            onClick={() => onToggleDetails(item)}
            size="icon-lg"
            type="button"
            variant="ghost"
          >
            <ChevronDownIcon
              className={expanded ? "rotate-180 transition-transform" : "transition-transform"}
            />
          </Button>
        </TableCell>
      </TableRow>

      {expanded ? (
        <TableRow>
          <TableCell className="whitespace-normal p-0" colSpan={6}>
            <div className="flex flex-col gap-4 border-t border-border bg-background/50 p-4 sm:p-6" id={detailId}>
              <OfferingDetail checkedAt={checkedAt} item={item} />
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function OfferingDetail({
  checkedAt,
  item,
}: {
  checkedAt: string;
  item: HostedRuntimeLabsOffering;
}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={item.kind === "panel" ? "secondary" : "outline"}>
            {formatOfferingKind(item.kind)}
          </Badge>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Listed in Junction&apos;s catalog
          </span>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-foreground">
          {item.description ?? "Junction does not provide a description for this catalog item."}
        </p>
      </div>

      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <DetailFact label="Catalog price" value={formatCatalogPrice(item)} serif />
        <DetailFact label="Turnaround" value={formatTurnaround(item)} />
        <DetailFact
          label="Included markers"
          value={item.includedMarkerCount > 0 ? String(item.includedMarkerCount) : "Not provided"}
          serif={item.includedMarkerCount > 0}
        />
        <DetailFact
          label="Catalog checked"
          value={formatCheckedAt(checkedAt)}
        />
      </dl>

      {item.includedMarkers.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Included marker preview
          </h3>
          <p className="max-w-3xl text-sm leading-relaxed text-foreground">
            {item.includedMarkers.map((marker) => marker.name).join(", ")}
          </p>
          {item.includedMarkerCount > item.includedMarkers.length ? (
            <p className="text-xs text-muted-foreground">
              Showing {item.includedMarkers.length} of {item.includedMarkerCount} markers.
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Ordering through Murph is not enabled yet. This listing does not confirm eligibility or a final quote.
      </p>
    </>
  );
}

function DetailFact({
  label,
  serif = false,
  value,
}: {
  label: string;
  serif?: boolean;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className={serif ? "font-serif text-lg font-semibold text-foreground" : "text-sm text-foreground"}>
        {value}
      </dd>
    </div>
  );
}

function CatalogLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Searching Junction&apos;s live catalog
      </p>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Test or panel</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="hidden md:table-cell">Included</TableHead>
              <TableHead className="hidden lg:table-cell">Turnaround</TableHead>
              <TableHead className="text-right">Catalog price</TableHead>
              <TableHead>
                <span className="sr-only">Details</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[0, 1, 2].map((row) => (
              <TableRow key={row}>
                <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                <TableCell className="hidden md:table-cell"><Skeleton className="h-5 w-36" /></TableCell>
                <TableCell className="hidden lg:table-cell"><Skeleton className="h-5 w-24" /></TableCell>
                <TableCell><Skeleton className="ml-auto h-5 w-16" /></TableCell>
                <TableCell><Skeleton className="h-8 w-8" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function LocationsResults({
  onRetry,
  state,
}: {
  onRetry: (request: HostedRuntimeLabsLocationsRequest) => void;
  state: LocationsState;
}) {
  if (state.status === "idle") {
    return (
      <p className="text-sm text-muted-foreground">
        No location search yet.
      </p>
    );
  }

  if (state.status === "loading") {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Checking nearby collection coverage
        </p>
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    );
  }

  if (state.status === "error") {
    if (state.failure === "auth") {
      return (
        <LabsAuthAlert>
          Refresh this page, then sign in again if prompted. Your ZIP was not saved.
        </LabsAuthAlert>
      );
    }

    return (
      <Alert variant="destructive">
        <AlertTitle>Locations temporarily unavailable</AlertTitle>
        <AlertDescription>
          Collection coverage could not be checked. Your ZIP was not saved.
        </AlertDescription>
        <AlertAction>
          <Button onClick={() => onRetry(state.request)} size="sm" type="button" variant="outline">
            Retry
          </Button>
        </AlertAction>
      </Alert>
    );
  }

  if (state.data.status === "not_served") {
    return (
      <Alert>
        <AlertTitle>No collection coverage found</AlertTitle>
        <AlertDescription>
          Junction did not return home or walk-in collection options within {state.data.radiusMiles} miles.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={state.data.homeCollectionAvailable ? "default" : "outline"}>
            {state.data.homeCollectionAvailable
              ? "Home collection listed"
              : "Home collection not listed"}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {state.data.locations.length} walk-in {state.data.locations.length === 1 ? "site" : "sites"}
          </span>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Within {state.data.radiusMiles} miles · {formatCheckedAt(state.data.checkedAt)}
        </p>
      </div>

      {state.data.locations.length > 0 ? (
        <ol className="overflow-hidden rounded-xl border border-border bg-card">
          {state.data.locations.map((location, index) => (
            <LocationRow
              index={index}
              key={`${location.labId}:${location.siteCode}`}
              location={location}
            />
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">
          Junction returned general coverage but no walk-in sites in this radius.
        </p>
      )}
    </div>
  );
}

function LocationRow({
  index,
  location,
}: {
  index: number;
  location: HostedRuntimeLabsLocation;
}) {
  const phoneHref = location.phoneNumber
    ? `tel:${location.phoneNumber.replace(/[^+\d]/gu, "")}`
    : null;

  return (
    <li className="grid gap-3 border-b border-border p-4 last:border-b-0 sm:grid-cols-[36px_minmax(0,1fr)_auto] sm:items-start sm:p-5">
      <span className="font-serif text-xl font-semibold text-muted-foreground">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="min-w-0">
        <h3 className="font-serif text-lg font-semibold text-foreground">{location.name}</h3>
        <p className="text-sm text-foreground">{formatAddress(location)}</p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {formatLabName(location.labSlug)}
        </p>
        {phoneHref && location.phoneNumber ? (
          <a
            className="mt-2 inline-block text-sm text-foreground underline underline-offset-4 hover:text-primary"
            href={phoneHref}
          >
            {location.phoneNumber}
          </a>
        ) : null}
      </div>
      <p className="font-serif text-lg font-semibold text-foreground sm:text-right">
        {formatDistance(location.distanceMiles)}
      </p>
    </li>
  );
}

function startTrackedRequest(tracker: RequestTracker): {
  controller: AbortController;
  id: number;
} {
  tracker.controller?.abort();
  const controller = new AbortController();
  tracker.controller = controller;
  tracker.id += 1;
  return { controller, id: tracker.id };
}

function isCurrentRequest(
  tracker: RequestTracker,
  request: { controller: AbortController; id: number },
): boolean {
  return tracker.id === request.id
    && tracker.controller === request.controller
    && !request.controller.signal.aborted;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isSearchKind(value: string): value is SearchKind {
  return value === "all" || value === "panel" || value === "biomarker";
}

function formatOfferingKind(kind: HostedRuntimeLabsOffering["kind"]): string {
  return kind === "panel" ? "Panel" : "Individual";
}

function formatIncludedMarkerPreview(offering: HostedRuntimeLabsOffering): string {
  if (offering.includedMarkerCount === 0) {
    return "Not provided";
  }

  const markerNames = offering.includedMarkers.slice(0, 3).map((marker) => marker.name);
  if (markerNames.length === 0) {
    return `${offering.includedMarkerCount} included`;
  }

  const remaining = offering.includedMarkerCount - markerNames.length;
  return remaining > 0
    ? `${markerNames.join(", ")} +${remaining}`
    : markerNames.join(", ");
}

function formatCatalogPrice(offering: HostedRuntimeLabsOffering): string {
  const price = offering.catalogPrice;
  if (!price) {
    return "Unavailable";
  }

  const numericAmount = Number(price.amount);
  if (!Number.isFinite(numericAmount)) {
    return `$${price.amount}`;
  }

  return new Intl.NumberFormat("en-US", {
    currency: price.currency,
    style: "currency",
  }).format(numericAmount);
}

function formatTurnaround(offering: HostedRuntimeLabsOffering): string {
  if (offering.commonTurnaroundDays !== null) {
    return `${offering.commonTurnaroundDays} ${offering.commonTurnaroundDays === 1 ? "day" : "days"} typical`;
  }

  if (offering.maximumTurnaroundDays !== null) {
    return `Up to ${offering.maximumTurnaroundDays} ${offering.maximumTurnaroundDays === 1 ? "day" : "days"}`;
  }

  return "Not provided";
}

function formatCheckedAt(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatAddress(location: HostedRuntimeLabsLocation): string {
  const { address } = location;
  return [
    address.line1,
    address.line2,
    `${address.city}, ${address.state} ${address.postalCode}`,
  ].filter((part): part is string => Boolean(part)).join(", ");
}

function formatLabName(value: string | null): string {
  if (!value) {
    return "Junction lab network";
  }

  return value
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function formatDistance(value: number): string {
  if (value < 0.05) {
    return "<0.1 mi";
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} mi`;
}

function catalogStatusText(state: SearchState): string {
  if (state.status === "loading") {
    return "Searching Junction's live catalog.";
  }
  if (state.status !== "success") {
    return "";
  }
  if (state.data.items.length === 0) {
    return "";
  }
  return `${state.data.items.length} ${catalogResultSummary(state.data)}.`;
}

function catalogResultSummary(data: HostedRuntimeLabsSearchResponse): string {
  const returned = `${data.items.length === 1 ? "result" : "results"} shown`;
  return data.provider.total !== null && data.provider.total > data.items.length
    ? `${returned} of ${data.provider.total} matching catalog items`
    : returned;
}

function locationsStatusText(state: LocationsState): string {
  if (state.status === "loading") {
    return "Checking nearby collection coverage.";
  }
  if (state.status !== "success") {
    return "";
  }
  if (state.data.status === "not_served") {
    return "";
  }
  const homeStatus = state.data.homeCollectionAvailable
    ? "Home collection listed."
    : "Home collection not listed.";
  const walkInLabel = state.data.locations.length === 1 ? "site" : "sites";
  return `${homeStatus} ${state.data.locations.length} walk-in ${walkInLabel} returned.`;
}

function LabsAuthAlert({ children }: { children: string }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Session needs attention</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

class LabsRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Labs request failed.");
    this.name = "LabsRequestError";
    this.status = status;
  }
}

function classifyLabsRequestFailure(error: unknown): LabsRequestFailure {
  if (!(error instanceof LabsRequestError)) {
    return "unavailable";
  }
  if (error.status === 401 || error.status === 403) {
    return "auth";
  }
  return "unavailable";
}

async function requestLabs(
  request: HostedRuntimeLabsSearchRequest,
  signal: AbortSignal,
): Promise<HostedRuntimeLabsSearchResponse>;
async function requestLabs(
  request: HostedRuntimeLabsLocationsRequest,
  signal: AbortSignal,
): Promise<HostedRuntimeLabsLocationsResponse>;
async function requestLabs(
  request: HostedRuntimeLabsSearchRequest | HostedRuntimeLabsLocationsRequest,
  signal: AbortSignal,
): Promise<HostedRuntimeLabsSearchResponse | HostedRuntimeLabsLocationsResponse> {
  const response = await fetch("/api/labs", {
    body: JSON.stringify(request),
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
    signal,
  });

  if (!response.ok) {
    throw new LabsRequestError(response.status);
  }

  const payload: unknown = await response.json();
  const parsed = parseHostedRuntimeLabsToolResponse(payload);
  if (parsed.action !== request.action) {
    throw new Error("Labs response action did not match the request.");
  }

  return parsed;
}
