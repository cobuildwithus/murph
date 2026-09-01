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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FoodComparisonTable } from "@/src/components/food-label-lab/food-comparison-table";
import {
  FoodEvidenceSheet,
  type FoodEvidencePanel,
} from "@/src/components/food-label-lab/food-evidence-sheet";
import {
  compareFoodMetrics,
  getFoodEvidenceSummary,
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/src/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/src/components/ui/field";
import { Input } from "@/src/components/ui/input";
import { Skeleton } from "@/src/components/ui/skeleton";
import { Spinner } from "@/src/components/ui/spinner";

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

export function FoodLabelLab(input: {
  initialBasis?: FoodMetricBasis;
  initialEvidence?: EvidenceSelection;
  initialProducts?: PublicProductDetail[];
  webMcpEnabled?: boolean;
}) {
  const [basis, setBasis] = useState<FoodMetricBasis>(input.initialBasis ?? "per_100_g");
  const [products, setProducts] = useState<PublicProductDetail[]>(
    () => input.initialProducts?.slice(0, 4) ?? [],
  );
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<SearchState>({ status: "idle" });
  const [addingRef, setAddingRef] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<EvidenceSelection>(input.initialEvidence ?? null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchSequenceRef = useRef(0);
  const activeSearchRef = useRef<AbortController | null>(null);

  const cancelSearch = useCallback(() => {
    searchSequenceRef.current += 1;
    activeSearchRef.current?.abort();
    activeSearchRef.current = null;
  }, []);

  useEffect(() => cancelSearch, [cancelSearch]);

  const searchFoods = useCallback(async (
    searchQuery: string,
    limit: number,
  ): Promise<FoodWebMcpSearchResult[]> => {
    const sequence = searchSequenceRef.current + 1;
    searchSequenceRef.current = sequence;
    activeSearchRef.current?.abort();
    const controller = new AbortController();
    activeSearchRef.current = controller;
    setSearchState({ status: "loading" });
    try {
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
        signal: controller.signal,
      });

      if (sequence !== searchSequenceRef.current) {
        throw new Error(SEARCH_REPLACED_ERROR);
      }

      if (!response.ok) {
        const message = response.status === 429 ? RATE_LIMIT_ERROR : SEARCH_ERROR;
        setSearchState({ status: "error", message });
        throw new Error(message);
      }

      const payload: unknown = await response.json();
      if (sequence !== searchSequenceRef.current) {
        throw new Error(SEARCH_REPLACED_ERROR);
      }
      const parsed = publicProductSearchResponseSchema.safeParse(payload);
      if (!parsed.success) {
        setSearchState({ status: "error", message: SEARCH_ERROR });
        throw new Error(SEARCH_ERROR);
      }

      const results = parsed.data.results.foods.slice(0, limit);
      setSearchState({ status: "success", results });
      return results.map((result) => ({
        productRef: result.productRef,
        name: result.name,
        brand: result.brand,
        linkedTests: result.productTests.total,
      }));
    } catch (error) {
      if (controller.signal.aborted || sequence !== searchSequenceRef.current) {
        throw new Error(SEARCH_REPLACED_ERROR);
      }
      if (!(error instanceof Error) || (error.message !== SEARCH_ERROR && error.message !== RATE_LIMIT_ERROR)) {
        setSearchState({ status: "error", message: SEARCH_ERROR });
        throw new Error(SEARCH_ERROR);
      }
      throw error;
    } finally {
      if (activeSearchRef.current === controller) {
        activeSearchRef.current = null;
      }
    }
  }, []);

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

  const compareProducts = useCallback(async (
    productRefs: string[],
  ): Promise<FoodWebMcpComparisonResult> => {
    const nextProducts = await Promise.all(productRefs.map(fetchProduct));
    cancelSearch();
    setProducts(nextProducts);
    setQuery("");
    setSearchState({ status: "idle" });
    setEvidence(null);
    return buildWebMcpComparison(nextProducts, basis);
  }, [basis, cancelSearch, fetchProduct]);

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

  async function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      setSearchState({ status: "error", message: "Enter at least two characters." });
      searchInputRef.current?.focus();
      return;
    }
    try {
      await searchFoods(normalizedQuery, 6);
    } catch {
      // The visible state already carries a privacy-safe message.
    }
  }

  async function addProduct(productRef: string) {
    if (products.length >= 4 || products.some((product) => product.productRef === productRef)) {
      return;
    }
    setAddingRef(productRef);
    try {
      const product = await fetchProduct(productRef);
      setProducts((current) => current.length >= 4 || current.some(
        (candidate) => candidate.productRef === product.productRef,
      ) ? current : [...current, product]);
      if (products.length === 1) {
        setQuery("");
        setSearchState({ status: "idle" });
      }
    } catch (error) {
      setSearchState({
        status: "error",
        message: error instanceof Error ? error.message : SEARCH_ERROR,
      });
    } finally {
      setAddingRef(null);
    }
  }

  function runExample(example: string) {
    setQuery(example);
    void searchFoods(example, 6).catch(() => undefined);
  }

  function focusSearch() {
    searchInputRef.current?.focus();
    searchInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {input.webMcpEnabled === false ? null : <FoodLabelWebMcp actions={webMcpActions} />}

      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-20 max-w-[1400px] items-center px-5 sm:px-8 lg:px-12">
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

      <main className="mx-auto w-full max-w-[1400px] px-5 py-10 sm:px-8 sm:py-14 lg:px-12">
        <div className="flex items-end justify-between gap-8">
          <h1 className="font-serif text-5xl font-semibold tracking-[-0.04em] text-foreground sm:text-6xl">
            Food
          </h1>
          <Image
            src="/design-assets/food-label-lab/prepared-meals.svg"
            alt=""
            width={80}
            height={80}
            className="hidden size-20 object-contain sm:block"
          />
        </div>

        <form role="search" aria-label="Find foods to compare" onSubmit={submitSearch} className="mt-9">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="food-comparison-search" className="sr-only">
                Product, brand, or UPC
              </FieldLabel>
              <div className="grid gap-3 rounded-xl border border-border bg-card p-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="relative">
                  <SearchIcon
                    className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-primary"
                    aria-hidden="true"
                  />
                  <Input
                    id="food-comparison-search"
                    ref={searchInputRef}
                    value={query}
                    onChange={(event) => {
                      if (searchState.status === "loading") {
                        cancelSearch();
                        setSearchState({ status: "idle" });
                      }
                      setQuery(event.currentTarget.value);
                      if (searchState.status === "error") {
                        setSearchState({ status: "idle" });
                      }
                    }}
                    autoCapitalize="none"
                    autoComplete="off"
                    enterKeyHint="search"
                    maxLength={128}
                    placeholder="Compare plain Greek yogurts"
                    spellCheck={false}
                    className="min-h-12 border-0 bg-transparent pr-4 pl-11 shadow-none focus-visible:ring-0"
                  />
                </div>
                <Button type="submit" size="lg" disabled={searchState.status === "loading"}>
                  {searchState.status === "loading" ? (
                    <>
                      <Spinner data-icon="inline-start" />
                      Searching
                    </>
                  ) : "Find products"}
                </Button>
              </div>
            </Field>
          </FieldGroup>
        </form>

        <SearchResults
          state={searchState}
          selectedRefs={new Set(products.map((product) => product.productRef))}
          addingRef={addingRef}
          onAdd={addProduct}
        />

        <div className="mt-5">
          {products.length >= 2 ? (
            <FoodComparisonTable
              products={products}
              basis={basis}
              onBasisChange={setBasis}
              onRemoveProduct={(productRef) => {
                setProducts((current) => current.filter(
                  (product) => product.productRef !== productRef,
                ));
                setEvidence((current) => current?.product.productRef === productRef ? null : current);
              }}
              onRequestAdd={focusSearch}
              onOpenEvidence={(product, panel) => setEvidence({ product, panel })}
            />
          ) : (
            <FoodEmptyState
              selectedCount={products.length}
              onExample={runExample}
            />
          )}
        </div>
      </main>

      <FoodEvidenceSheet
        panel={evidence?.panel ?? null}
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

function SearchResults(input: {
  addingRef: string | null;
  onAdd: (productRef: string) => void;
  selectedRefs: Set<string>;
  state: SearchState;
}) {
  if (input.state.status === "idle") {
    return null;
  }
  if (input.state.status === "loading") {
    return (
      <div className="mt-4 grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-16 rounded-lg" />
        ))}
      </div>
    );
  }
  if (input.state.status === "error") {
    return (
      <p role="alert" className="mt-3 px-2 text-sm text-destructive">
        {input.state.message}
      </p>
    );
  }
  if (input.state.results.length === 0) {
    return (
      <p className="mt-3 px-2 text-sm text-muted-foreground">
        No matching branded foods.
      </p>
    );
  }

  return (
    <div className="mt-4 grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-3">
      {input.state.results.map((result) => {
        const selected = input.selectedRefs.has(result.productRef);
        const loading = input.addingRef === result.productRef;
        return (
          <button
            key={result.productRef}
            type="button"
            data-food-product-ref={result.productRef}
            disabled={selected || input.addingRef !== null}
            onClick={() => input.onAdd(result.productRef)}
            className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">
                {result.name}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {result.brand ?? "Brand not reported"} · {result.productTests.total} tests
              </span>
            </span>
            <span className="text-sm font-medium text-primary">
              {loading ? "Loading" : selected ? "Added" : "Add"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function FoodEmptyState(input: {
  onExample: (query: string) => void;
  selectedCount: number;
}) {
  return (
    <Empty className="min-h-[420px] border border-border bg-card px-6 py-14">
      <EmptyMedia className="relative h-28 w-64" aria-hidden="true">
        <Image
          src="/design-assets/food-label-lab/yogurt.svg"
          alt=""
          width={80}
          height={80}
          className="absolute left-4 top-5 size-20 -rotate-6 object-contain"
        />
        <Image
          src="/design-assets/food-label-lab/plant-milk.svg"
          alt=""
          width={96}
          height={96}
          className="absolute left-1/2 top-0 size-24 -translate-x-1/2 object-contain"
        />
        <Image
          src="/design-assets/food-label-lab/bars.svg"
          alt=""
          width={80}
          height={80}
          className="absolute right-4 top-6 size-20 rotate-6 object-contain"
        />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle className="font-serif text-3xl font-semibold tracking-[-0.025em] text-foreground">
          {input.selectedCount === 1 ? "Add one more food" : "Choose foods to compare"}
        </EmptyTitle>
        <EmptyDescription>
          {input.selectedCount === 1 ? "The comparison starts with two products." : "Search a product, brand, or UPC."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="mt-2 max-w-xl flex-row flex-wrap justify-center gap-2">
        {["plain Greek yogurt", "protein bars", "oat milk"].map((example) => (
          <Button
            key={example}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => input.onExample(example)}
          >
            {example}
          </Button>
        ))}
      </EmptyContent>
    </Empty>
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
    topMatchProductRefs: [...topMatch.productRefs],
    products: products.map((product) => {
      const evidence = getFoodEvidenceSummary(product);
      return {
        productRef: product.productRef,
        name: product.name,
        brand: product.brand,
        alerts: evidence.alertCount,
        evidence: evidence.level,
      };
    }),
  };
}
