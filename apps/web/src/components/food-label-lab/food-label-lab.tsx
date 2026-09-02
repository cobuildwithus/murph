"use client";

import {
  publicProductDetailResponseSchema,
  publicProductSearchResponseSchema,
  type PublicProductDetail,
  type PublicProductSearchHit,
} from "@murphai/contracts";
import { SearchIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { FoodComparisonTable } from "@/src/components/food-label-lab/food-comparison-table";
import {
  FoodEvidenceSheet,
  type FoodEvidencePanel,
} from "@/src/components/food-label-lab/food-evidence-sheet";
import {
  FOOD_COMPARISON_LIMIT,
  compareFoodMetrics,
  dedupeFoodSearchHits,
  getFoodCategoryAsset,
  getFoodEvidenceSummary,
  getFoodProductIdentity,
  getFoodTopMatch,
  type FoodMetricBasis,
} from "@/src/components/food-label-lab/food-label-model";
import {
  FoodLabelWebMcp,
  type FoodLabelWebMcpActions,
  type FoodWebMcpComparisonResult,
  type FoodWebMcpSearchResult,
} from "@/src/components/food-label-lab/food-label-webmcp";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Skeleton } from "@/src/components/ui/skeleton";
import { Spinner } from "@/src/components/ui/spinner";
import { cn } from "@/src/lib/utils";

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; results: PublicProductSearchHit[] }
  | { status: "error"; message: string };

type EvidenceSelection = {
  panel: FoodEvidencePanel;
  product: PublicProductDetail;
} | null;

const SEARCH_ERROR = "Search is unavailable. Try again in a moment.";
const RATE_LIMIT_ERROR = "Too many searches. Wait a minute and try again.";
const SEARCH_REPLACED_ERROR = "Search was replaced by a newer search.";
const EXAMPLE_ERROR = "The example products are unavailable right now. Try a search instead.";
const SEARCH_DEBOUNCE_MS = 250;
const SUGGESTION_LIMIT = 6;

export const FOOD_EXAMPLES = [
  {
    label: "Greek yogurt",
    productRefs: [
      "food_ZmRjOjI2NDEwNzY",
      "food_ZmRjOjIxOTgwOTA",
      "food_ZmRjOjI1ODUyOTY",
    ],
  },
  {
    label: "Protein bars",
    productRefs: [
      "food_ZmRjOjEyMDM0MDQ",
      "food_ZmRjOjI2Nzc2NjQ",
      "food_cnhiYXI6bnV0LWJ1dHRlci1vYXQtcHJvdGVpbi1iYXItYmx1ZWJlcnJ5LWNhc2hldy1idXR0ZXI",
    ],
  },
  {
    label: "Protein shakes",
    productRefs: [
      "food_ZmRjOjI2NjM5NTU",
      "food_ZmRjOjI2NjM5NjI",
      "food_ZmRjOjE5NjU2MzY",
    ],
  },
] as const;

export function FoodLabelLab(input: {
  initialBasis?: FoodMetricBasis;
  initialEvidence?: EvidenceSelection;
  initialProducts?: PublicProductDetail[];
  webMcpEnabled?: boolean;
}) {
  const [basis, setBasis] = useState<FoodMetricBasis>(input.initialBasis ?? "per_100_g");
  const [products, setProducts] = useState<PublicProductDetail[]>(
    () => input.initialProducts?.slice(0, FOOD_COMPARISON_LIMIT) ?? [],
  );
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<SearchState>({ status: "idle" });
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [addingRef, setAddingRef] = useState<string | null>(null);
  const [loadingExample, setLoadingExample] = useState<string | null>(null);
  const [peers, setPeers] = useState<PublicProductSearchHit[]>([]);
  const [evidence, setEvidence] = useState<EvidenceSelection>(input.initialEvidence ?? null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchSequenceRef = useRef(0);
  const activeSearchRef = useRef<AbortController | null>(null);
  const lastQueryRef = useRef("");
  const listboxId = useId();

  const cancelSearch = useCallback(() => {
    searchSequenceRef.current += 1;
    activeSearchRef.current?.abort();
    activeSearchRef.current = null;
  }, []);

  useEffect(() => cancelSearch, [cancelSearch]);

  const requestSearch = useCallback(async (
    searchQuery: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<PublicProductSearchHit[]> => {
    const response = await fetch("/api/public/v1/products/search", {
      body: JSON.stringify({
        query: searchQuery,
        kinds: ["food"],
        limitPerKind: limit,
      }),
      cache: "no-store",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      referrerPolicy: "no-referrer",
      signal,
    });
    if (!response.ok) {
      throw new Error(response.status === 429 ? RATE_LIMIT_ERROR : SEARCH_ERROR);
    }
    const payload: unknown = await response.json();
    const parsed = publicProductSearchResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(SEARCH_ERROR);
    }
    return dedupeFoodSearchHits(parsed.data.results.foods).slice(0, limit);
  }, []);

  const searchFoods = useCallback(async (
    searchQuery: string,
    limit: number,
  ): Promise<FoodWebMcpSearchResult[]> => {
    const sequence = searchSequenceRef.current + 1;
    searchSequenceRef.current = sequence;
    activeSearchRef.current?.abort();
    const controller = new AbortController();
    activeSearchRef.current = controller;
    lastQueryRef.current = searchQuery;
    setSearchState({ status: "loading" });
    setSuggestionsOpen(true);
    try {
      const results = await requestSearch(searchQuery, limit, controller.signal);
      if (sequence !== searchSequenceRef.current) {
        throw new Error(SEARCH_REPLACED_ERROR);
      }
      setSearchState({ status: "success", results });
      setActiveIndex(-1);
      return results.map((result) => ({
        productRef: result.productRef,
        name: result.name,
        brand: result.brand,
        linkedObservations: result.productTests.total,
      }));
    } catch (error) {
      if (controller.signal.aborted || sequence !== searchSequenceRef.current) {
        throw new Error(SEARCH_REPLACED_ERROR);
      }
      const message = error instanceof Error && error.message === RATE_LIMIT_ERROR
        ? RATE_LIMIT_ERROR
        : SEARCH_ERROR;
      setSearchState({ status: "error", message });
      throw new Error(message);
    } finally {
      if (activeSearchRef.current === controller) {
        activeSearchRef.current = null;
      }
    }
  }, [requestSearch]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2 || normalizedQuery === lastQueryRef.current) {
      return;
    }
    const timer = setTimeout(() => {
      void searchFoods(normalizedQuery, SUGGESTION_LIMIT).catch(() => undefined);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, searchFoods]);

  const fetchProduct = useCallback(async (productRef: string) => {
    const response = await fetch(
      `/api/public/v1/products/${encodeURIComponent(productRef)}`,
      {
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      },
    );
    if (!response.ok) {
      throw new Error(response.status === 429 ? RATE_LIMIT_ERROR : SEARCH_ERROR);
    }
    const payload: unknown = await response.json();
    const parsed = publicProductDetailResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.product.kind !== "food") {
      throw new Error(SEARCH_ERROR);
    }
    return parsed.data.product;
  }, []);

  const clearSearch = useCallback(() => {
    cancelSearch();
    lastQueryRef.current = "";
    setQuery("");
    setSearchState({ status: "idle" });
    setSuggestionsOpen(false);
    setActiveIndex(-1);
  }, [cancelSearch]);

  const replaceProducts = useCallback((nextProducts: PublicProductDetail[]) => {
    clearSearch();
    setPeers([]);
    setProducts(nextProducts);
    setEvidence(null);
  }, [clearSearch]);

  const compareProducts = useCallback(async (
    productRefs: string[],
  ): Promise<FoodWebMcpComparisonResult> => {
    const nextProducts = await Promise.all(productRefs.map(fetchProduct));
    replaceProducts(nextProducts);
    return buildWebMcpComparison(nextProducts, basis);
  }, [basis, fetchProduct, replaceProducts]);

  const getCurrentComparison = useCallback(
    () => buildWebMcpComparison(products, basis),
    [basis, products],
  );

  const showEvidence = useCallback((
    productRef: string,
    view: FoodEvidencePanel,
  ) => {
    const product = products.find((candidate) => candidate.productRef === productRef);
    if (product) {
      setEvidence({ panel: view, product });
    }
    return { opened: Boolean(product), productRef, view };
  }, [products]);

  const webMcpActions = useMemo<FoodLabelWebMcpActions>(() => ({
    search: searchFoods,
    compare: compareProducts,
    getCurrentComparison,
    showEvidence,
  }), [compareProducts, getCurrentComparison, searchFoods, showEvidence]);

  const loadPeers = useCallback(async (product: PublicProductDetail) => {
    const identity = getFoodProductIdentity(product);
    const peerQuery = identity.title.replace(/[,(].*$/u, "").trim().slice(0, 64);
    if (peerQuery.length < 2) {
      return;
    }
    try {
      const hits = await requestSearch(peerQuery, SUGGESTION_LIMIT, new AbortController().signal);
      setPeers(hits.filter((hit) =>
        hit.productRef !== product.productRef
        && (!hit.upc || hit.upc !== product.upc),
      ).slice(0, 3));
    } catch {
      setPeers([]);
    }
  }, [requestSearch]);

  async function addProduct(productRef: string) {
    if (
      products.length >= FOOD_COMPARISON_LIMIT
      || products.some((product) => product.productRef === productRef)
    ) {
      return;
    }
    setAddingRef(productRef);
    try {
      const product = await fetchProduct(productRef);
      const wasEmpty = products.length === 0;
      setProducts((current) => current.length >= FOOD_COMPARISON_LIMIT || current.some(
        (candidate) => candidate.productRef === product.productRef,
      ) ? current : [...current, product]);
      clearSearch();
      if (wasEmpty) {
        void loadPeers(product);
      }
    } catch (error) {
      setSearchState({
        status: "error",
        message: error instanceof Error ? error.message : SEARCH_ERROR,
      });
      setSuggestionsOpen(true);
    } finally {
      setAddingRef(null);
    }
  }

  async function runExample(example: (typeof FOOD_EXAMPLES)[number]) {
    setLoadingExample(example.label);
    try {
      const settled = await Promise.allSettled(example.productRefs.map(fetchProduct));
      const loaded = settled.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      if (loaded.length === 0) {
        const rateLimited = settled.some((result) =>
          result.status === "rejected"
          && result.reason instanceof Error
          && result.reason.message === RATE_LIMIT_ERROR,
        );
        throw new Error(rateLimited ? RATE_LIMIT_ERROR : EXAMPLE_ERROR);
      }
      replaceProducts(loaded);
    } catch (error) {
      setSearchState({
        status: "error",
        message: error instanceof Error && error.message === RATE_LIMIT_ERROR
          ? RATE_LIMIT_ERROR
          : EXAMPLE_ERROR,
      });
      setSuggestionsOpen(true);
    } finally {
      setLoadingExample(null);
    }
  }

  function removeProduct(productRef: string) {
    setProducts((current) => current.filter((product) => product.productRef !== productRef));
    setEvidence((current) => current?.product.productRef === productRef ? null : current);
  }

  function focusSearch() {
    searchInputRef.current?.focus();
    if (typeof searchInputRef.current?.scrollIntoView === "function") {
      searchInputRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  async function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      setSearchState({ status: "error", message: "Enter at least two characters." });
      setSuggestionsOpen(true);
      searchInputRef.current?.focus();
      return;
    }
    if (searchState.status === "success" && normalizedQuery === lastQueryRef.current) {
      setSuggestionsOpen(true);
      return;
    }
    await searchFoods(normalizedQuery, SUGGESTION_LIMIT).catch(() => undefined);
  }

  const suggestions = searchState.status === "success" ? searchState.results : [];
  const selectedRefs = new Set(products.map((product) => product.productRef));
  const visiblePeers = peers.filter((peer) => !selectedRefs.has(peer.productRef));
  const comparisonFull = products.length >= FOOD_COMPARISON_LIMIT;

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setSuggestionsOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (suggestions.length === 0 || !suggestionsOpen) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      const active = suggestions[activeIndex];
      if (active && !selectedRefs.has(active.productRef)) {
        void addProduct(active.productRef);
      }
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {input.webMcpEnabled === false ? null : <FoodLabelWebMcp actions={webMcpActions} />}

      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center px-5 sm:px-8 lg:px-12">
          <Link
            href="/"
            className="rounded-sm font-serif text-2xl font-semibold tracking-[-0.025em] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            murph
          </Link>
          <span className="mx-3 text-muted-foreground" aria-hidden="true">/</span>
          <span className="text-sm text-muted-foreground">food</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
        <h1 className="max-w-3xl font-serif text-4xl font-semibold tracking-[-0.03em] text-foreground sm:text-5xl">
          Compare foods by the label and by the lab
        </h1>
        <p className="mt-3 max-w-2xl text-base text-muted-foreground">
          Calories, protein, sugars, and fat side by side, plus test results linked to the exact product where they exist.
        </p>

        <form
          role="search"
          aria-label="Find foods to compare"
          onSubmit={submitSearch}
          className="relative mt-7 max-w-3xl"
          onBlur={(event) => {
            const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
            if (!event.currentTarget.contains(next)) {
              setSuggestionsOpen(false);
            }
          }}
        >
          <label htmlFor="food-comparison-search" className="text-sm font-medium text-foreground">
            Product, brand, or UPC
          </label>
          <div className="mt-2 flex gap-2 rounded-xl border border-border bg-card p-1.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
            <div className="relative min-w-0 flex-1">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="food-comparison-search"
                ref={searchInputRef}
                value={query}
                role="combobox"
                aria-expanded={suggestionsOpen && searchState.status !== "idle"}
                aria-controls={listboxId}
                aria-autocomplete="list"
                aria-activedescendant={
                  activeIndex >= 0 && suggestions[activeIndex]
                    ? `${listboxId}-${activeIndex}`
                    : undefined
                }
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  setSuggestionsOpen(true);
                  if (searchState.status === "error") {
                    setSearchState({ status: "idle" });
                  }
                }}
                onFocus={() => {
                  if (searchState.status !== "idle") {
                    setSuggestionsOpen(true);
                  }
                }}
                onKeyDown={onSearchKeyDown}
                autoCapitalize="none"
                autoComplete="off"
                enterKeyHint="search"
                maxLength={128}
                placeholder="e.g. RXBAR Strawberry or UPC 894700010014"
                spellCheck={false}
                disabled={comparisonFull}
                className="min-h-11 border-0 bg-transparent pr-3 pl-10 shadow-none focus-visible:ring-0"
              />
            </div>
            <Button type="submit" size="lg" disabled={searchState.status === "loading" || comparisonFull}>
              {searchState.status === "loading" ? <Spinner /> : "Search"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {comparisonFull
              ? `Remove a product to add another. The comparison holds ${FOOD_COMPARISON_LIMIT}.`
              : "Suggestions appear as you type. Pick one to add it to the comparison."}
          </p>

          <SearchSuggestions
            id={listboxId}
            open={suggestionsOpen}
            state={searchState}
            activeIndex={activeIndex}
            selectedRefs={selectedRefs}
            addingRef={addingRef}
            onHover={setActiveIndex}
            onAdd={(productRef) => void addProduct(productRef)}
          />
        </form>

        {products.length === 0 ? (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Try an example:</span>
            {FOOD_EXAMPLES.map((example) => (
              <Button
                key={example.label}
                type="button"
                variant="outline"
                size="sm"
                disabled={loadingExample !== null}
                onClick={() => void runExample(example)}
              >
                {loadingExample === example.label ? <Spinner data-icon="inline-start" /> : null}
                {example.label}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="mt-6">
          {products.length > 0 ? (
            <FoodComparisonTable
              products={products}
              basis={basis}
              onBasisChange={setBasis}
              onRemoveProduct={removeProduct}
              onRequestAdd={focusSearch}
              onOpenEvidence={(product) => setEvidence({ product, panel: "tests" })}
            />
          ) : (
            <FoodEmptyState />
          )}
        </div>

        {products.length > 0 && !comparisonFull && visiblePeers.length > 0 ? (
          <div className="mt-4">
            <p className="text-xs text-muted-foreground">Similar by name</p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-3">
              {visiblePeers.map((peer) => (
                <li key={peer.productRef}>
                  <SuggestionButton
                    hit={peer}
                    state={addingRef === peer.productRef ? "loading" : "add"}
                    onClick={() => void addProduct(peer.productRef)}
                    className="rounded-lg border border-border bg-card"
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <details className="mt-8 max-w-3xl text-xs text-muted-foreground">
          <summary className="cursor-pointer underline decoration-border underline-offset-4 hover:text-foreground">
            Works with browser agents
          </summary>
          <p className="mt-2">
            While this page is open it registers four read-only WebMCP tools, so an agent in your browser can search, compare, read the visible result, and open evidence with the same data you see here.
          </p>
        </details>
      </main>

      <FoodEvidenceSheet
        focus={evidence?.panel ?? null}
        product={evidence?.product ?? null}
        onOpenChange={(open) => {
          if (!open) {
            setEvidence(null);
          }
        }}
      />
    </div>
  );
}

function SearchSuggestions(input: {
  activeIndex: number;
  addingRef: string | null;
  id: string;
  onAdd: (productRef: string) => void;
  onHover: (index: number) => void;
  open: boolean;
  selectedRefs: Set<string>;
  state: SearchState;
}) {
  if (!input.open || input.state.status === "idle") {
    return null;
  }

  const panelClassName = "absolute inset-x-0 top-full z-20 mt-2 rounded-xl border border-border bg-popover p-2 shadow-md";

  if (input.state.status === "loading") {
    return (
      <div className={panelClassName} aria-busy="true">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="mb-1 h-12 rounded-lg last:mb-0" />
        ))}
      </div>
    );
  }
  if (input.state.status === "error") {
    return (
      <p role="alert" className={cn(panelClassName, "px-3 py-3 text-sm text-destructive")}>
        {input.state.message}
      </p>
    );
  }
  if (input.state.results.length === 0) {
    return (
      <p className={cn(panelClassName, "px-3 py-3 text-sm text-muted-foreground")} role="status">
        No branded foods match. Try a brand name or the UPC from the barcode.
      </p>
    );
  }

  return (
    <ul
      id={input.id}
      role="listbox"
      aria-label="Product suggestions"
      className={panelClassName}
    >
      {input.state.results.map((result, index) => {
        const selected = input.selectedRefs.has(result.productRef);
        return (
          <li key={result.productRef} role="none">
            <SuggestionButton
              id={`${input.id}-${index}`}
              hit={result}
              role="option"
              active={index === input.activeIndex}
              state={
                selected ? "added" : input.addingRef === result.productRef ? "loading" : "add"
              }
              onHover={() => input.onHover(index)}
              onClick={() => input.onAdd(result.productRef)}
            />
          </li>
        );
      })}
    </ul>
  );
}

function SuggestionButton(input: {
  active?: boolean;
  className?: string;
  hit: PublicProductSearchHit;
  id?: string;
  onClick: () => void;
  onHover?: () => void;
  role?: "option";
  state: "add" | "added" | "loading";
}) {
  const identity = getFoodProductIdentity(input.hit);
  const secondary = [
    identity.size,
    input.hit.upc ? `UPC ${input.hit.upc}` : null,
    input.hit.productTests.total > 0
      ? `${input.hit.productTests.total} linked ${input.hit.productTests.total === 1 ? "test" : "tests"}`
      : null,
  ].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      id={input.id}
      role={input.role}
      aria-selected={input.role ? input.active : undefined}
      data-food-product-ref={input.hit.productRef}
      disabled={input.state !== "add"}
      onMouseEnter={input.onHover}
      onMouseDown={(event) => event.preventDefault()}
      onClick={input.onClick}
      className={cn(
        "grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60",
        input.active && "bg-muted",
        input.className,
      )}
    >
      <Image
        src={getFoodCategoryAsset(input.hit)}
        alt=""
        width={40}
        height={40}
        className="size-10 object-contain"
      />
      <span className="min-w-0">
        <span className="block truncate text-sm text-foreground">
          {identity.brand ? <span className="font-semibold">{identity.brand} · </span> : null}
          {identity.title}
        </span>
        {secondary ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{secondary}</span>
        ) : null}
      </span>
      <span className="text-xs font-medium text-primary">
        {input.state === "loading" ? "Adding" : input.state === "added" ? "Added" : "Add"}
      </span>
    </button>
  );
}

function FoodEmptyState() {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-dashed border-border px-5 py-5 text-sm text-muted-foreground">
      <span className="flex shrink-0 items-center" aria-hidden="true">
        <Image src="/design-assets/food-label-lab/yogurt.svg" alt="" width={40} height={40} className="size-10 object-contain" />
        <Image src="/design-assets/food-label-lab/bars.svg" alt="" width={40} height={40} className="-ml-2 size-10 object-contain" />
        <Image src="/design-assets/food-label-lab/protein-shake.svg" alt="" width={40} height={40} className="-ml-2 size-10 object-contain" />
      </span>
      <p>
        {`The comparison table appears here as soon as you add one product. It holds up to ${FOOD_COMPARISON_LIMIT}.`}
      </p>
    </div>
  );
}

function buildWebMcpComparison(
  products: PublicProductDetail[],
  basis: FoodMetricBasis,
): FoodWebMcpComparisonResult {
  const comparisons = compareFoodMetrics(products, basis);
  const topMatch = getFoodTopMatch(products, comparisons);
  return {
    basis,
    comparableMetricCount: topMatch.comparableMetricCount,
    metrics: comparisons.map((comparison) => ({
      metric: comparison.metric.id,
      preference: comparison.metric.preference,
      complete: comparison.complete,
      values: [...comparison.values].map(([productRef, metricValue]) => ({
        productRef,
        value: metricValue.value,
        unit: metricValue.unit,
      })),
      winnerProductRefs: [...comparison.winnerRefs],
    })),
    topMatchProductRefs: [...topMatch.productRefs],
    products: products.map((product) => {
      const evidence = getFoodEvidenceSummary(product);
      return {
        productRef: product.productRef,
        name: product.name,
        brand: product.brand,
        alertsShown: evidence.alertCount,
        alertsLowerBound: evidence.alertsLowerBound,
        observationTotal: evidence.observationCount,
        observationReturned: evidence.returnedObservationCount,
        observationsTruncated: evidence.observationsTruncated,
        evidence: evidence.level,
        wins: topMatch.winsByProductRef.get(product.productRef) ?? 0,
      };
    }),
  };
}
