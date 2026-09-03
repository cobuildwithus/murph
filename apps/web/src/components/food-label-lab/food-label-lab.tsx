"use client";

import {
  publicProductDetailResponseSchema,
  publicProductSearchResponseSchema,
  type PublicProductDetail,
  type PublicProductSearchHit,
} from "@murphai/contracts";
import { ChevronRightIcon, SearchIcon, XIcon } from "lucide-react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { FoodComparisonTable } from "@/src/components/food-label-lab/food-comparison-table";
import { FoodBrandVisual } from "@/src/components/food-label-lab/food-brand-visual";
import {
  FoodEvidenceSheet,
  type FoodEvidencePanel,
} from "@/src/components/food-label-lab/food-evidence-sheet";
import {
  FOOD_COMPARISON_LIMIT,
  buildFoodComparisonUrl,
  cleanFoodSearchHits,
  compareFoodMetrics,
  dedupeFoodSearchHits,
  getFoodCategoryAsset,
  getFoodComparisonCategoryQuery,
  getFoodEvidenceSummary,
  getFoodProductIdentity,
  getFoodTopMatch,
  hasUsefulFoodComparisonData,
  orderFoodSearchHitsForDiversity,
  parseFoodComparisonUrl,
  selectDiverseFoodSearchHits,
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
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/src/components/ui/popover";
import { Skeleton } from "@/src/components/ui/skeleton";
import { Spinner } from "@/src/components/ui/spinner";
import { PRODUCT_DATABASE_STATS } from "@/src/lib/product-database-stats";
import { cn } from "@/src/lib/utils";

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; results: PublicProductSearchHit[] }
  | { status: "error"; message: string };

type FoodSearchPage = {
  hasMore: boolean;
  nextOffset: number;
  results: PublicProductSearchHit[];
};

type EvidenceSelection = {
  panel: FoodEvidencePanel;
  product: PublicProductDetail;
} | null;

const SEARCH_ERROR = "Search is unavailable. Try again in a moment.";
const RATE_LIMIT_ERROR = "Too many searches. Wait a minute and try again.";
const SEARCH_REPLACED_ERROR = "Search was replaced by a newer search.";
const NO_MATCHING_PRODUCTS_ERROR =
  "No comparison-ready products match. Try another search.";
const UNUSABLE_PRODUCT_ERROR =
  "This product does not report calories, protein, sugar, and fat for a useful comparison.";
const SEARCH_DEBOUNCE_MS = 250;
const SUGGESTION_LIMIT = 25;
const DEFAULT_COMPARISON_SIZE = 4;
const RELATED_ROWS_PER_BATCH = 4;
const RELATED_PRODUCTS_PER_BATCH = 12;
const RELATED_PRODUCT_CANDIDATE_LIMIT = 250;
const RELATED_PRODUCT_OFFSET_LIMIT = 220;
const INITIAL_CATEGORY_RESULT_SIZE = 30;
const DATABASE_COUNT_FORMATTER = new Intl.NumberFormat("en-US");

export const FOOD_EXAMPLES = [
  { label: "Greek yogurt" },
  { label: "Protein bars" },
  { label: "Protein shakes" },
] as const;

export function FoodLabelLab(input: {
  brandfetchClientId?: string | null;
  initialBasis?: FoodMetricBasis;
  initialEvidence?: EvidenceSelection;
  initialProducts?: PublicProductDetail[];
  webMcpEnabled?: boolean;
}) {
  const [basis, setBasis] = useState<FoodMetricBasis>(
    input.initialBasis ?? "per_100_g",
  );
  const [products, setProducts] = useState<PublicProductDetail[]>(
    () => input.initialProducts?.slice(0, FOOD_COMPARISON_LIMIT) ?? [],
  );
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<SearchState>({
    status: "idle",
  });
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [addingRef, setAddingRef] = useState<string | null>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [loadingExample, setLoadingExample] = useState<string | null>(null);
  const [relatedProducts, setRelatedProducts] = useState<
    PublicProductSearchHit[]
  >([]);
  const [comparisonCategoryQuery, setComparisonCategoryQuery] = useState("");
  const [relatedOffset, setRelatedOffset] = useState(0);
  const [relatedHasMore, setRelatedHasMore] = useState(false);
  const [relatedVisibleRows, setRelatedVisibleRows] = useState(
    RELATED_ROWS_PER_BATCH,
  );
  const [loadingMoreRelated, setLoadingMoreRelated] = useState(false);
  const [relatedError, setRelatedError] = useState<string | null>(null);
  const [shareRecoveryMessage, setShareRecoveryMessage] = useState<
    string | null
  >(null);
  const [urlStateReady, setUrlStateReady] = useState(
    () => (input.initialProducts?.length ?? 0) > 0,
  );
  const [evidence, setEvidence] = useState<EvidenceSelection>(
    input.initialEvidence ?? null,
  );
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchSequenceRef = useRef(0);
  const activeSearchRef = useRef<AbortController | null>(null);
  const activeRelatedSearchRef = useRef<AbortController | null>(null);
  const lastQueryRef = useRef("");
  const listboxId = useId();

  const cancelSearch = useCallback(() => {
    searchSequenceRef.current += 1;
    activeSearchRef.current?.abort();
    activeSearchRef.current = null;
  }, []);

  useEffect(
    () => () => {
      cancelSearch();
      activeRelatedSearchRef.current?.abort();
    },
    [cancelSearch],
  );

  const requestSearch = useCallback(
    async (
      searchQuery: string,
      limit: number,
      signal: AbortSignal,
      offset = 0,
      foodSearchOrder: "relevance" | "evidence" | "popular" = "relevance",
    ): Promise<FoodSearchPage> => {
      const response = await fetch("/api/public/v1/products/search", {
        body: JSON.stringify({
          query: searchQuery,
          kinds: ["food"],
          limitPerKind: limit,
          offsetPerKind: offset,
          foodComparisonReadyOnly: true,
          ...(foodSearchOrder !== "relevance" ? { foodSearchOrder } : {}),
        }),
        cache: "no-store",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        method: "POST",
        referrerPolicy: "no-referrer",
        signal,
      });
      if (!response.ok) {
        throw new Error(
          response.status === 429 ? RATE_LIMIT_ERROR : SEARCH_ERROR,
        );
      }
      const payload: unknown = await response.json();
      const parsed = publicProductSearchResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(SEARCH_ERROR);
      }
      const rawResults = parsed.data.results.foods;
      return {
        hasMore: rawResults.length === limit,
        nextOffset: offset + rawResults.length,
        results: cleanFoodSearchHits(
          dedupeFoodSearchHits(parsed.data.results.foods),
          searchQuery,
          foodSearchOrder,
        ).slice(0, limit),
      };
    },
    [],
  );

  const searchFoods = useCallback(
    async (
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
        const page = await requestSearch(searchQuery, limit, controller.signal);
        if (sequence !== searchSequenceRef.current) {
          throw new Error(SEARCH_REPLACED_ERROR);
        }
        setSearchState({ status: "success", results: page.results });
        setActiveIndex(-1);
        return page.results.map((result) => ({
          productRef: result.productRef,
          name: result.name,
          brand: result.brand,
          linkedObservations: result.productTests.total,
        }));
      } catch (error) {
        if (
          controller.signal.aborted ||
          sequence !== searchSequenceRef.current
        ) {
          throw new Error(SEARCH_REPLACED_ERROR);
        }
        const message =
          error instanceof Error && error.message === RATE_LIMIT_ERROR
            ? RATE_LIMIT_ERROR
            : SEARCH_ERROR;
        setSearchState({ status: "error", message });
        throw new Error(message);
      } finally {
        if (activeSearchRef.current === controller) {
          activeSearchRef.current = null;
        }
      }
    },
    [requestSearch],
  );

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (
      normalizedQuery.length < 2 ||
      normalizedQuery === lastQueryRef.current
    ) {
      return;
    }
    const timer = setTimeout(() => {
      void searchFoods(normalizedQuery, SUGGESTION_LIMIT).catch(
        () => undefined,
      );
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
      throw new Error(
        response.status === 429 ? RATE_LIMIT_ERROR : SEARCH_ERROR,
      );
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

  const closeSearchMenu = useCallback(() => {
    cancelSearch();
    setSuggestionsOpen(false);
    setActiveIndex(-1);
  }, [cancelSearch]);

  const replaceProducts = useCallback(
    (nextProducts: PublicProductDetail[]) => {
      clearSearch();
      setRelatedProducts([]);
      setComparisonCategoryQuery("");
      setRelatedOffset(0);
      setRelatedHasMore(false);
      setRelatedVisibleRows(RELATED_ROWS_PER_BATCH);
      setRelatedError(null);
      setShareRecoveryMessage(null);
      setProducts(nextProducts);
      setEvidence(null);
    },
    [clearSearch],
  );

  const loadRelatedProducts = useCallback(
    async (
      categoryQuery: string,
      excludedProductRefs: Set<string>,
      controller: AbortController,
    ) => {
      const page = await requestSearch(
        categoryQuery,
        INITIAL_CATEGORY_RESULT_SIZE,
        controller.signal,
        0,
        "popular",
      );
      if (activeRelatedSearchRef.current !== controller) {
        return;
      }
      setRelatedProducts(
        orderFoodSearchHitsForDiversity(
          page.results.filter(
            (result) => !excludedProductRefs.has(result.productRef),
          ),
        ),
      );
      setComparisonCategoryQuery(categoryQuery);
      setRelatedOffset(page.nextOffset);
      setRelatedHasMore(page.hasMore);
      setRelatedVisibleRows(RELATED_ROWS_PER_BATCH);
      setRelatedError(null);
    },
    [requestSearch],
  );

  useEffect(() => {
    if ((input.initialProducts?.length ?? 0) > 0) {
      return;
    }

    let cancelled = false;
    const relatedController = new AbortController();
    const restoreTimer = window.setTimeout(() => {
      const restored = parseFoodComparisonUrl(window.location.search);
      setBasis(restored.basis);
      if (restored.productRefs.length === 0) {
        setUrlStateReady(true);
        return;
      }

      activeRelatedSearchRef.current?.abort();
      activeRelatedSearchRef.current = relatedController;
      setLoadingComparison(true);

      void Promise.allSettled(restored.productRefs.map(fetchProduct))
        .then(async (settled) => {
          if (cancelled) {
            return;
          }
          const loaded = settled.flatMap((result) =>
            result.status === "fulfilled" &&
            hasUsefulFoodComparisonData(result.value)
              ? [result.value]
              : [],
          );
          const missingCount = restored.productRefs.length - loaded.length;
          setShareRecoveryMessage(
            missingCount > 0
              ? loaded.length > 0
                ? `${missingCount} ${
                    missingCount === 1 ? "product" : "products"
                  } from this shared comparison could not be loaded.`
                : "This shared comparison is no longer available."
              : null,
          );
          setProducts(loaded);
          const categoryQuery = loaded[0]
            ? getFoodComparisonCategoryQuery(loaded[0])
            : null;
          if (categoryQuery) {
            await loadRelatedProducts(
              categoryQuery,
              new Set(loaded.map((product) => product.productRef)),
              relatedController,
            );
          }
        })
        .catch(() => {
          if (!cancelled) {
            setRelatedError("Matching products are unavailable. Try again.");
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoadingComparison(false);
            setUrlStateReady(true);
          }
          if (activeRelatedSearchRef.current === relatedController) {
            activeRelatedSearchRef.current = null;
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(restoreTimer);
      relatedController.abort();
    };
  }, [fetchProduct, input.initialProducts, loadRelatedProducts]);

  useEffect(() => {
    if (!urlStateReady) {
      return;
    }
    const currentUrl = `${window.location.pathname || "/food"}${
      window.location.search || ""
    }${window.location.hash || ""}`;
    const nextUrl = buildFoodComparisonUrl(
      currentUrl,
      products.map((product) => product.productRef),
      basis,
    );
    if (nextUrl !== currentUrl) {
      const historyUrl = new URL(
        nextUrl,
        window.location.origin || "https://www.withmurph.ai",
      );
      window.history.replaceState(window.history.state, "", historyUrl);
    }
  }, [basis, products, urlStateReady]);

  const compareProducts = useCallback(
    async (productRefs: string[]): Promise<FoodWebMcpComparisonResult> => {
      const nextProducts = await Promise.all(productRefs.map(fetchProduct));
      if (
        nextProducts.some((product) => !hasUsefulFoodComparisonData(product))
      ) {
        throw new Error(UNUSABLE_PRODUCT_ERROR);
      }
      replaceProducts(nextProducts);
      return buildWebMcpComparison(nextProducts, basis);
    },
    [basis, fetchProduct, replaceProducts],
  );

  const getCurrentComparison = useCallback(
    () => buildWebMcpComparison(products, basis),
    [basis, products],
  );

  const showEvidence = useCallback(
    (productRef: string, view: FoodEvidencePanel) => {
      const product = products.find(
        (candidate) => candidate.productRef === productRef,
      );
      if (product) {
        setEvidence({ panel: view, product });
      }
      return { opened: Boolean(product), productRef, view };
    },
    [products],
  );

  const webMcpActions = useMemo<FoodLabelWebMcpActions>(
    () => ({
      search: searchFoods,
      compare: compareProducts,
      getCurrentComparison,
      showEvidence,
    }),
    [compareProducts, getCurrentComparison, searchFoods, showEvidence],
  );

  async function addProduct(productRef: string) {
    if (
      products.length >= FOOD_COMPARISON_LIMIT ||
      products.some((product) => product.productRef === productRef)
    ) {
      return;
    }
    const startsNewComparison = products.length === 0;
    setAddingRef(productRef);
    try {
      const product = await fetchProduct(productRef);
      if (!hasUsefulFoodComparisonData(product)) {
        setSearchState({ status: "error", message: UNUSABLE_PRODUCT_ERROR });
        setSuggestionsOpen(true);
        return;
      }
      setProducts((current) =>
        current.length >= FOOD_COMPARISON_LIMIT ||
        current.some((candidate) => candidate.productRef === product.productRef)
          ? current
          : [...current, product],
      );
      closeSearchMenu();
      if (startsNewComparison) {
        const categoryQuery =
          getFoodComparisonCategoryQuery(product) ?? query.trim();
        if (categoryQuery.length >= 2) {
          activeRelatedSearchRef.current?.abort();
          const controller = new AbortController();
          activeRelatedSearchRef.current = controller;
          setComparisonCategoryQuery(categoryQuery);
          setRelatedProducts([]);
          setRelatedOffset(0);
          setRelatedHasMore(false);
          setRelatedVisibleRows(RELATED_ROWS_PER_BATCH);
          setRelatedError(null);
          void loadRelatedProducts(
            categoryQuery,
            new Set([product.productRef]),
            controller,
          )
            .catch(() => {
              if (!controller.signal.aborted) {
                setRelatedError(
                  "Matching products are unavailable. Try again.",
                );
              }
            })
            .finally(() => {
              if (activeRelatedSearchRef.current === controller) {
                activeRelatedSearchRef.current = null;
              }
            });
        }
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

  async function showTopSearchResults(searchQuery: string) {
    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery.length < 2) {
      return;
    }

    lastQueryRef.current = normalizedQuery;
    cancelSearch();
    setLoadingComparison(true);
    const controller = new AbortController();
    activeSearchRef.current = controller;
    try {
      const page = await requestSearch(
        normalizedQuery,
        INITIAL_CATEGORY_RESULT_SIZE,
        controller.signal,
        0,
        "popular",
      );
      if (page.results.length === 0) {
        throw new Error(NO_MATCHING_PRODUCTS_ERROR);
      }
      setSearchState({
        status: "success",
        results: page.results.slice(0, SUGGESTION_LIMIT),
      });

      const orderedResults = orderFoodSearchHitsForDiversity(page.results);
      const comparisonHits = selectDiverseFoodSearchHits(
        orderedResults,
        DEFAULT_COMPARISON_SIZE,
      );
      const settled = await Promise.allSettled(
        comparisonHits.map((result) => fetchProduct(result.productRef)),
      );
      const loaded = settled
        .flatMap((result) =>
          result.status === "fulfilled" &&
          hasUsefulFoodComparisonData(result.value)
            ? [result.value]
            : [],
        )
        .slice(0, DEFAULT_COMPARISON_SIZE);
      if (loaded.length === 0) {
        const rateLimited = settled.some(
          (result) =>
            result.status === "rejected" &&
            result.reason instanceof Error &&
            result.reason.message === RATE_LIMIT_ERROR,
        );
        throw new Error(
          rateLimited ? RATE_LIMIT_ERROR : NO_MATCHING_PRODUCTS_ERROR,
        );
      }

      setProducts(loaded);
      const loadedRefs = new Set(loaded.map((product) => product.productRef));
      setRelatedProducts(
        orderedResults.filter((result) => !loadedRefs.has(result.productRef)),
      );
      setComparisonCategoryQuery(normalizedQuery);
      setRelatedOffset(page.nextOffset);
      setRelatedHasMore(page.hasMore);
      setRelatedVisibleRows(RELATED_ROWS_PER_BATCH);
      setRelatedError(null);
      setEvidence(null);
      closeSearchMenu();
    } catch (error) {
      setSearchState({
        status: "error",
        message: error instanceof Error ? error.message : SEARCH_ERROR,
      });
      setSuggestionsOpen(true);
    } finally {
      if (activeSearchRef.current === controller) {
        activeSearchRef.current = null;
      }
      setLoadingComparison(false);
    }
  }

  async function runExample(example: (typeof FOOD_EXAMPLES)[number]) {
    setLoadingExample(example.label);
    setQuery(example.label);
    try {
      await showTopSearchResults(example.label);
    } finally {
      setLoadingExample(null);
    }
  }

  function removeProduct(productRef: string) {
    setProducts((current) =>
      current.filter((product) => product.productRef !== productRef),
    );
    setEvidence((current) =>
      current?.product.productRef === productRef ? null : current,
    );
  }

  function resetComparison() {
    activeRelatedSearchRef.current?.abort();
    activeRelatedSearchRef.current = null;
    setBasis("per_100_g");
    replaceProducts([]);
  }

  async function loadMoreRelated() {
    const columns = window.matchMedia("(min-width: 1024px)").matches
      ? 3
      : window.matchMedia("(min-width: 640px)").matches
      ? 2
      : 1;
    const visibleLoadedCount = relatedProducts.length;
    const visibleProductCount = relatedVisibleRows * columns;
    const nextVisibleProductCount =
      (relatedVisibleRows + RELATED_ROWS_PER_BATCH) * columns;

    if (visibleLoadedCount >= nextVisibleProductCount || !relatedHasMore) {
      if (visibleProductCount < visibleLoadedCount) {
        setRelatedVisibleRows((current) => current + RELATED_ROWS_PER_BATCH);
      }
      return;
    }
    if (comparisonCategoryQuery.length < 2 || loadingMoreRelated) {
      return;
    }
    const nextRequestLimit =
      relatedOffset === RELATED_PRODUCT_OFFSET_LIMIT
        ? RELATED_PRODUCT_CANDIDATE_LIMIT - RELATED_PRODUCT_OFFSET_LIMIT
        : Math.min(
            RELATED_PRODUCTS_PER_BATCH,
            RELATED_PRODUCT_OFFSET_LIMIT - relatedOffset,
          );
    if (nextRequestLimit <= 0) {
      setRelatedHasMore(false);
      return;
    }

    activeRelatedSearchRef.current?.abort();
    const controller = new AbortController();
    activeRelatedSearchRef.current = controller;
    setLoadingMoreRelated(true);
    setRelatedError(null);
    try {
      const page = await requestSearch(
        comparisonCategoryQuery,
        nextRequestLimit,
        controller.signal,
        relatedOffset,
        "popular",
      );
      setRelatedProducts((current) =>
        orderFoodSearchHitsForDiversity(
          dedupeFoodSearchHits([...current, ...page.results]),
        ),
      );
      setRelatedOffset(page.nextOffset);
      setRelatedHasMore(
        page.hasMore && page.nextOffset < RELATED_PRODUCT_CANDIDATE_LIMIT,
      );
      setRelatedVisibleRows((current) => current + RELATED_ROWS_PER_BATCH);
    } catch {
      if (!controller.signal.aborted) {
        setRelatedError("More products are unavailable. Try again.");
      }
    } finally {
      if (activeRelatedSearchRef.current === controller) {
        activeRelatedSearchRef.current = null;
      }
      setLoadingMoreRelated(false);
    }
  }

  async function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      setSearchState({
        status: "error",
        message: "Enter at least two characters.",
      });
      setSuggestionsOpen(true);
      searchInputRef.current?.focus();
      return;
    }
    await showTopSearchResults(normalizedQuery);
  }

  const suggestions =
    searchState.status === "success" ? searchState.results : [];
  const searchButtonLoading = shouldShowSearchButtonLoading(
    searchState,
    loadingExample,
  );
  const selectedRefs = new Set(products.map((product) => product.productRef));
  const visibleRelatedProducts = relatedProducts;
  const hasComparison = products.length > 0;
  const comparisonFull = products.length >= FOOD_COMPARISON_LIMIT;
  const categoryOptionAvailable =
    suggestions.length > 0 && !isUpcSearchQuery(query);
  const categoryOptionOffset = Number(categoryOptionAvailable);
  const searchOptionCount = suggestions.length + categoryOptionOffset;

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setSuggestionsOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (searchOptionCount === 0 || !suggestionsOpen) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % searchOptionCount);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        current <= 0 ? searchOptionCount - 1 : current - 1,
      );
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      if (categoryOptionAvailable && activeIndex === 0) {
        void showTopSearchResults(query);
        return;
      }
      const active = suggestions[activeIndex - categoryOptionOffset];
      if (active && !comparisonFull && !selectedRefs.has(active.productRef)) {
        void addProduct(active.productRef);
      }
    }
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <FoodWebMcpBridge
        enabled={input.webMcpEnabled !== false}
        actions={webMcpActions}
      />

      <main className="mx-auto w-full max-w-[1400px] px-5 pt-28 pb-12 sm:px-8 sm:pt-32 sm:pb-20 lg:px-12">
        <section
          data-compact={String(hasComparison)}
          data-suggestions-open={String(
            suggestionsOpen && searchState.status !== "idle",
          )}
          className="group/search relative mx-auto flex min-h-[calc(100svh-15rem)] max-w-4xl -translate-y-16 flex-col items-center justify-center text-center data-[compact=true]:grid data-[compact=true]:min-h-0 data-[compact=true]:max-w-none data-[compact=true]:translate-y-0 data-[compact=true]:grid-cols-1 data-[compact=true]:items-center data-[compact=true]:text-left data-[suggestions-open=true]:z-30 xl:data-[compact=true]:grid-cols-[minmax(16rem,1fr)_minmax(0,45rem)] xl:data-[compact=true]:gap-8"
        >
          <FoodHeroVisual />
          <div className="group-data-[compact=true]/search:w-full">
            <h1 className="font-serif text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-5xl group-data-[compact=true]/search:text-2xl sm:group-data-[compact=true]/search:text-3xl">
              Find the healthier choice
            </h1>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base group-data-[compact=true]/search:hidden">
              Compare <DatabaseStatsPopover />, see what’s inside, and choose
              what works for you.
            </p>
          </div>

          <form
            role="search"
            aria-label="Find foods to compare"
            onSubmit={submitSearch}
            className="relative mt-7 w-full max-w-[45rem] group-data-[compact=true]/search:mt-4 xl:group-data-[compact=true]/search:mt-0"
            onBlur={(event) => {
              const next =
                event.relatedTarget instanceof Node
                  ? event.relatedTarget
                  : null;
              if (!event.currentTarget.contains(next)) {
                setSuggestionsOpen(false);
              }
            }}
          >
            <label htmlFor="food-comparison-search" className="sr-only">
              Search by product name, category, brand, or UPC
            </label>
            <div className="flex gap-2 rounded-xl border border-border bg-card p-1.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
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
                  aria-expanded={
                    suggestionsOpen && searchState.status !== "idle"
                  }
                  aria-controls={listboxId}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    activeIndex < 0
                      ? undefined
                      : categoryOptionAvailable && activeIndex === 0
                      ? `${listboxId}-compare`
                      : suggestions[activeIndex - categoryOptionOffset]
                      ? `${listboxId}-${activeIndex - categoryOptionOffset}`
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
                  placeholder="Product, category, or UPC"
                  spellCheck={false}
                  className="min-h-11 border-0 bg-transparent pr-3 pl-10 shadow-none focus-visible:ring-0"
                />
              </div>
              <Button
                type="submit"
                size="lg"
                disabled={searchState.status === "loading" || loadingComparison}
                className="relative min-w-24"
              >
                <StableLoadingLabel
                  label="Search"
                  loading={searchButtonLoading}
                />
              </Button>
              {hasComparison ? (
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  onClick={resetComparison}
                  aria-label="Clear comparison"
                  className="border-foreground/20 bg-transparent hover:border-foreground/35 hover:bg-muted/50 sm:min-w-20"
                >
                  <XIcon aria-hidden="true" className="sm:hidden" />
                  <span className="hidden sm:inline">Clear</span>
                </Button>
              ) : null}
            </div>
            <SearchSuggestions
              key={query.trim()}
              id={listboxId}
              open={suggestionsOpen}
              state={searchState}
              query={query}
              activeIndex={activeIndex}
              selectedRefs={selectedRefs}
              addingRef={addingRef}
              comparisonFull={comparisonFull}
              loadingComparison={loadingComparison}
              brandfetchClientId={input.brandfetchClientId}
              onHover={setActiveIndex}
              onAdd={(productRef) => void addProduct(productRef)}
              onCompareAll={() => void showTopSearchResults(query)}
            />
          </form>

          <FoodExampleButtons
            loadingExample={loadingExample}
            onExample={(example) => void runExample(example)}
          />
        </section>

        <FoodComparisonArea
          products={products}
          basis={basis}
          brandfetchClientId={input.brandfetchClientId}
          onBasisChange={setBasis}
          onOpenProduct={(product) =>
            setEvidence({ product, panel: "product" })
          }
          onRemoveProduct={removeProduct}
        />
        {shareRecoveryMessage ? (
          <p role="status" className="mt-3 text-sm text-muted-foreground">
            {shareRecoveryMessage}
          </p>
        ) : null}

        {products.length > 0 && visibleRelatedProducts.length > 0 ? (
          <MoreMatchingProducts
            products={visibleRelatedProducts}
            query={comparisonCategoryQuery}
            addingRef={addingRef}
            error={relatedError}
            hasMore={relatedHasMore}
            loadingMore={loadingMoreRelated}
            brandfetchClientId={input.brandfetchClientId}
            comparisonFull={comparisonFull}
            selectedRefs={selectedRefs}
            visibleRows={relatedVisibleRows}
            onAdd={(productRef) => void addProduct(productRef)}
            onLoadMore={() => void loadMoreRelated()}
          />
        ) : null}

        <FoodFooter />
      </main>

      <FoodEvidenceSheet
        focus={evidence?.panel ?? null}
        brandfetchClientId={input.brandfetchClientId}
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

function FoodWebMcpBridge(input: {
  actions: FoodLabelWebMcpActions;
  enabled: boolean;
}) {
  if (!input.enabled) {
    return null;
  }
  return <FoodLabelWebMcp actions={input.actions} />;
}

function shouldShowSearchButtonLoading(
  state: SearchState,
  loadingExample: string | null,
): boolean {
  return state.status === "loading" && loadingExample === null;
}

function StableLoadingLabel(input: { label: string; loading: boolean }) {
  return (
    <>
      <span className={cn(input.loading && "opacity-0")}>{input.label}</span>
      {input.loading ? <Spinner className="absolute" /> : null}
    </>
  );
}

function FoodComparisonArea(input: {
  basis: FoodMetricBasis;
  brandfetchClientId?: string | null;
  onBasisChange: (basis: FoodMetricBasis) => void;
  onOpenProduct: (product: PublicProductDetail) => void;
  onRemoveProduct: (productRef: string) => void;
  products: PublicProductDetail[];
}) {
  if (input.products.length === 0) {
    return null;
  }

  return (
    <div className="mt-6">
      <FoodComparisonTable
        products={input.products}
        basis={input.basis}
        brandfetchClientId={input.brandfetchClientId}
        onBasisChange={input.onBasisChange}
        onOpenProduct={input.onOpenProduct}
        onRemoveProduct={input.onRemoveProduct}
      />
    </div>
  );
}

function FoodFooter() {
  return (
    <p className="mt-16 text-center text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Available via WebMCP</span>
      <span aria-hidden="true"> · </span>
      Open this page in the ChatGPT browser
    </p>
  );
}

function DatabaseStatsPopover() {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={100}
        closeDelay={120}
        render={
          <button
            type="button"
            className="inline whitespace-nowrap border-b border-dotted border-muted-foreground/50 font-normal text-inherit outline-none transition-colors hover:border-foreground/50 hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
          >
            2M+ foods
          </button>
        }
      />
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="w-80 gap-0 overflow-hidden rounded-xl border border-border bg-popover p-0 shadow-md ring-0"
      >
        <div className="px-4 py-3">
          <PopoverTitle className="text-sm font-semibold text-foreground">
            Murph food database
          </PopoverTitle>
        </div>

        <div className="grid grid-cols-2 border-y border-border">
          <DatabaseStat
            label="Food labels"
            value={PRODUCT_DATABASE_STATS.foodLabels}
          />
          <DatabaseStat
            label="Product tests"
            value={PRODUCT_DATABASE_STATS.productTests}
            className="border-l border-border"
          />
        </div>

        <div className="space-y-2 px-4 py-3 text-xs text-muted-foreground">
          <p className="flex items-center gap-2">
            <span
              className="size-1.5 rounded-full bg-primary"
              aria-hidden="true"
            />
            USDA FoodData Central
          </p>
          <p className="flex items-center gap-2">
            <span
              className="size-1.5 rounded-full bg-primary"
              aria-hidden="true"
            />
            Independent labs and public agencies
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DatabaseStat(input: {
  className?: string;
  label: string;
  value: number;
}) {
  return (
    <div className={cn("px-4 py-3", input.className)}>
      <p className="font-serif text-xl font-semibold tabular-nums text-foreground">
        {DATABASE_COUNT_FORMATTER.format(input.value)}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{input.label}</p>
    </div>
  );
}

function MoreMatchingProducts(input: {
  addingRef: string | null;
  comparisonFull: boolean;
  error: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  brandfetchClientId?: string | null;
  onAdd: (productRef: string) => void;
  onLoadMore: () => void;
  products: PublicProductSearchHit[];
  query: string;
  selectedRefs: Set<string>;
  visibleRows: number;
}) {
  const normalizedQuery = input.query.trim();
  const label =
    normalizedQuery && !/^\d+$/u.test(normalizedQuery)
      ? `Add more ${normalizedQuery} to compare`
      : "Add more matching products to compare";

  return (
    <section aria-label={label} className="mt-8 sm:mt-10">
      <h2 className="text-base font-semibold text-foreground sm:text-lg">
        {label}
      </h2>
      <ul
        data-food-related-products
        className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
      >
        {input.products.map((product, index) => {
          const selected = input.selectedRefs.has(product.productRef);
          return (
            <li
              key={product.productRef}
              className={cn(
                index >= input.visibleRows && "hidden",
                index >= input.visibleRows &&
                  index < input.visibleRows * 2 &&
                  "sm:block",
                index >= input.visibleRows * 2 &&
                  index < input.visibleRows * 3 &&
                  "lg:block",
              )}
            >
              <SuggestionButton
                hit={product}
                brandfetchClientId={input.brandfetchClientId}
                state={
                  selected
                    ? "added"
                    : input.addingRef === product.productRef
                    ? "loading"
                    : input.comparisonFull
                    ? "full"
                    : "add"
                }
                onClick={() => input.onAdd(product.productRef)}
                className="h-full min-h-20 rounded-xl border border-border bg-card"
                contextQuery={normalizedQuery}
                presentation="related"
                wrapText
              />
            </li>
          );
        })}
      </ul>
      {input.error ? (
        <p role="alert" className="mt-3 text-center text-sm text-destructive">
          {input.error}
        </p>
      ) : null}
      <RelatedLoadMoreButton
        className="flex sm:hidden"
        visible={input.visibleRows < input.products.length || input.hasMore}
        {...input}
      />
      <RelatedLoadMoreButton
        className="hidden sm:flex lg:hidden"
        visible={input.visibleRows * 2 < input.products.length || input.hasMore}
        {...input}
      />
      <RelatedLoadMoreButton
        className="hidden lg:flex"
        visible={input.visibleRows * 3 < input.products.length || input.hasMore}
        {...input}
      />
    </section>
  );
}

function RelatedLoadMoreButton(input: {
  className: string;
  loadingMore: boolean;
  onLoadMore: () => void;
  visible: boolean;
}) {
  if (!input.visible) {
    return null;
  }

  return (
    <div className={cn("mt-4 justify-center", input.className)}>
      <Button
        type="button"
        variant="outline"
        disabled={input.loadingMore}
        onClick={input.onLoadMore}
      >
        {input.loadingMore ? (
          <>
            <Spinner /> Loading
          </>
        ) : (
          "Load more"
        )}
      </Button>
    </div>
  );
}

function SearchSuggestions(input: {
  activeIndex: number;
  addingRef: string | null;
  comparisonFull: boolean;
  id: string;
  loadingComparison: boolean;
  brandfetchClientId?: string | null;
  onAdd: (productRef: string) => void;
  onCompareAll: () => void;
  onHover: (index: number) => void;
  open: boolean;
  query: string;
  selectedRefs: Set<string>;
  state: SearchState;
}) {
  if (!input.open || input.state.status === "idle") {
    return null;
  }

  const panelClassName =
    "absolute inset-x-0 top-full z-20 mt-2 max-h-[min(21rem,calc(50dvh-6rem))] overflow-y-auto group-data-[compact=true]/search:max-h-[min(21rem,calc(100dvh-16rem))] overscroll-contain rounded-xl border border-border bg-popover p-2 shadow-md";

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
      <p
        role="alert"
        className={cn(panelClassName, "px-3 py-3 text-sm text-destructive")}
      >
        {input.state.message}
      </p>
    );
  }
  if (input.state.results.length === 0) {
    return (
      <p
        className={cn(
          panelClassName,
          "px-3 py-3 text-sm text-muted-foreground",
        )}
        role="status"
      >
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
      {!isUpcSearchQuery(input.query) ? (
        <li role="none" className="mb-1 border-b border-border pb-1">
          <button
            id={`${input.id}-compare`}
            type="button"
            role="option"
            aria-selected={input.activeIndex === 0}
            data-food-category-option
            disabled={input.loadingComparison}
            onMouseEnter={() => input.onHover(0)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={input.onCompareAll}
            className={cn(
              "flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
              input.activeIndex === 0 && "bg-muted",
            )}
          >
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">
              Compare “{input.query.trim()}” products
            </span>
            {input.loadingComparison ? (
              <Spinner className="shrink-0" />
            ) : (
              <ChevronRightIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
            )}
          </button>
        </li>
      ) : null}
      {input.state.results.map((result, index) => {
        const selected = input.selectedRefs.has(result.productRef);
        const optionIndex = index + (isUpcSearchQuery(input.query) ? 0 : 1);
        return (
          <li key={result.productRef} role="none">
            <SuggestionButton
              id={`${input.id}-${index}`}
              hit={result}
              brandfetchClientId={input.brandfetchClientId}
              role="option"
              active={optionIndex === input.activeIndex}
              state={
                selected
                  ? "added"
                  : input.addingRef === result.productRef
                  ? "loading"
                  : input.comparisonFull
                  ? "full"
                  : "add"
              }
              onHover={() => input.onHover(optionIndex)}
              onClick={() => input.onAdd(result.productRef)}
              contextQuery={input.query}
            />
          </li>
        );
      })}
    </ul>
  );
}

type SuggestionButtonInput = {
  active?: boolean;
  brandfetchClientId?: string | null;
  className?: string;
  contextQuery?: string;
  hit: PublicProductSearchHit;
  id?: string;
  onClick: () => void;
  onHover?: () => void;
  presentation?: "default" | "related";
  role?: "option";
  state: "add" | "added" | "full" | "loading";
  wrapText?: boolean;
};

function getSuggestionStateLabel(
  state: SuggestionButtonInput["state"],
): string {
  const labels: Record<SuggestionButtonInput["state"], string> = {
    add: "Add",
    added: "Added",
    full: "10 selected",
    loading: "Adding",
  };
  return labels[state];
}

function getSuggestionSecondaryText(
  input: SuggestionButtonInput,
  size: string | null,
  related: boolean,
): string {
  const showUpc = !related && isUpcSearchQuery(input.contextQuery ?? "");
  const linkedTestLabel =
    input.hit.productTests.total > 0
      ? `${input.hit.productTests.total} linked ${
          input.hit.productTests.total === 1 ? "test" : "tests"
        }`
      : null;
  return [
    size,
    showUpc && input.hit.upc ? `UPC ${input.hit.upc}` : null,
    linkedTestLabel,
  ]
    .filter(Boolean)
    .join(" · ");
}

function SuggestionProductText(input: {
  brand: string | null;
  fallbackTitle: string;
  related: boolean;
  secondary: string;
  title: string;
  wrapText: boolean;
}) {
  const textOverflowClass = input.wrapText ? "break-words" : "truncate";
  if (input.related) {
    const relatedTitle = input.title || input.fallbackTitle;
    return (
      <span className="min-w-0">
        <span
          className={cn(
            "block text-sm font-semibold text-foreground",
            textOverflowClass,
          )}
        >
          {input.brand ?? relatedTitle}
        </span>
        {input.brand && relatedTitle ? (
          <span
            className={cn(
              "mt-0.5 block text-xs text-foreground",
              textOverflowClass,
            )}
          >
            {relatedTitle}
          </span>
        ) : null}
        {input.secondary ? (
          <span
            className={cn(
              "mt-0.5 block text-xs text-muted-foreground",
              textOverflowClass,
            )}
          >
            {input.secondary}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="min-w-0">
      <span className={cn("block text-sm text-foreground", textOverflowClass)}>
        {input.brand ? (
          <span className="font-semibold">{input.brand}</span>
        ) : null}
        {input.brand && (input.title || input.fallbackTitle) ? " · " : null}
        {input.title || input.fallbackTitle}
      </span>
      {input.secondary ? (
        <span
          className={cn(
            "mt-0.5 block text-xs text-muted-foreground",
            textOverflowClass,
          )}
        >
          {input.secondary}
        </span>
      ) : null}
    </span>
  );
}

function SuggestionAction(input: {
  related: boolean;
  state: SuggestionButtonInput["state"];
}) {
  return (
    <span
      className={cn(
        "rounded-full bg-primary px-2 py-1 text-xs font-medium text-primary-foreground transition-opacity",
        input.related &&
          input.state === "add" &&
          "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
      )}
    >
      {getSuggestionStateLabel(input.state)}
    </span>
  );
}

function SuggestionButton(input: SuggestionButtonInput) {
  const identity = getFoodProductIdentity(input.hit);
  const related = input.presentation === "related";
  const displayTitle = related
    ? removeRepeatedQuery(identity.title, input.contextQuery ?? "")
    : identity.title;
  const secondary = getSuggestionSecondaryText(input, identity.size, related);

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
        "group grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60",
        input.active && "bg-muted",
        input.className,
      )}
    >
      <FoodBrandVisual
        asset={getFoodCategoryAsset(input.hit)}
        brand={identity.brand}
        brandfetchClientId={input.brandfetchClientId}
        searchContext={getFoodComparisonCategoryQuery(input.hit)}
        size="sm"
      />
      <SuggestionProductText
        brand={identity.brand}
        fallbackTitle={identity.title}
        related={related}
        secondary={secondary}
        title={displayTitle}
        wrapText={Boolean(input.wrapText)}
      />
      <SuggestionAction related={related} state={input.state} />
    </button>
  );
}

function isUpcSearchQuery(query: string): boolean {
  return /^\d+$/u.test(query.trim());
}

function removeRepeatedQuery(title: string, query: string): string {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2 || /^\d+$/u.test(normalizedQuery)) {
    return title;
  }

  const singularQuery = normalizedQuery.replace(/s$/iu, "");
  const pattern = singularQuery
    .split(/\s+/u)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("\\s+");
  const withoutQuery = title.replace(
    new RegExp(`\\b${pattern}s?\\b`, "giu"),
    "",
  );
  return withoutQuery
    .replace(/\s*[·,:/–-]\s*/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function FoodExampleButtons(input: {
  loadingExample: string | null;
  onExample: (example: (typeof FOOD_EXAMPLES)[number]) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap justify-center gap-2 group-data-[compact=true]/search:hidden">
      {FOOD_EXAMPLES.map((example) => (
        <Button
          key={example.label}
          type="button"
          variant="outline"
          size="sm"
          disabled={input.loadingExample !== null}
          onClick={() => input.onExample(example)}
          className="relative"
        >
          <StableLoadingLabel
            label={example.label}
            loading={input.loadingExample === example.label}
          />
        </Button>
      ))}
    </div>
  );
}

function FoodHeroVisual() {
  return (
    <div
      className="relative mb-7 h-28 w-64 group-data-[compact=true]/search:hidden"
      aria-hidden="true"
    >
      <Image
        src="/design-assets/food-label-lab/yogurt.svg"
        alt=""
        width={80}
        height={80}
        className="absolute top-5 left-4 size-20 -rotate-6 object-contain"
      />
      <Image
        src="/design-assets/food-label-lab/protein-shake.svg"
        alt=""
        width={96}
        height={96}
        className="absolute top-0 left-1/2 size-24 -translate-x-1/2 object-contain"
      />
      <Image
        src="/design-assets/food-label-lab/bars.svg"
        alt=""
        width={80}
        height={80}
        className="absolute top-6 right-4 size-20 rotate-6 object-contain"
      />
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
