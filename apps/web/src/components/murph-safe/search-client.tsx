"use client";

import {
  publicProductSearchResponseSchema,
  type PublicProductSearchHit,
  type PublicProductSearchResponse,
} from "@murphai/contracts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Skeleton } from "@/src/components/ui/skeleton";
import { Spinner } from "@/src/components/ui/spinner";

const EMPTY_SEARCH_MESSAGE =
  "Enter a product, brand, ingredient, or UPC.";
const NO_RESULTS_MESSAGE =
  "No matching product found. Try an exact product name, brand, ingredient, or UPC.";
const RATE_LIMIT_MESSAGE =
  "Too many searches. Please wait a minute before trying again.";
const SEARCH_FAILURE_MESSAGE =
  "Search is unavailable right now. Your search was not completed. Try again in a moment.";

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; response: PublicProductSearchResponse }
  | { status: "error"; message: string; source: "input" | "request" };

export function MurphSafeSearchClient() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const requestSequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const resultsHeading = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    return () => activeRequest.current?.abort();
  }, []);

  function focusResults() {
    requestAnimationFrame(() => resultsHeading.current?.focus());
  }

  function updateQuery(value: string) {
    setQuery(value);

    if (activeRequest.current) {
      requestSequence.current += 1;
      activeRequest.current.abort();
      activeRequest.current = null;
      setState({ status: "idle" });
    } else if (state.status === "error") {
      setState({ status: "idle" });
    }
  }

  async function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedQuery = query.trim();

    requestSequence.current += 1;
    const sequence = requestSequence.current;
    activeRequest.current?.abort();

    if (normalizedQuery.length < 2) {
      activeRequest.current = null;
      setState({
        status: "error",
        message: EMPTY_SEARCH_MESSAGE,
        source: "input",
      });
      requestAnimationFrame(() => searchInput.current?.focus());
      return;
    }

    const controller = new AbortController();
    activeRequest.current = controller;
    setState({ status: "loading" });

    try {
      const response = await fetch("/api/public/v1/products/search", {
        body: JSON.stringify({
          kinds: ["supplement", "food"],
          limitPerKind: 6,
          query: normalizedQuery,
        }),
        cache: "no-store",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        method: "POST",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });

      if (sequence !== requestSequence.current) {
        return;
      }

      if (!response.ok) {
        setState({
          status: "error",
          message: response.status === 429
            ? RATE_LIMIT_MESSAGE
            : SEARCH_FAILURE_MESSAGE,
          source: "request",
        });
        focusResults();
        return;
      }

      const payload: unknown = await response.json();
      const parsed = publicProductSearchResponseSchema.safeParse(payload);

      if (sequence !== requestSequence.current) {
        return;
      }

      if (!parsed.success) {
        setState({
          status: "error",
          message: SEARCH_FAILURE_MESSAGE,
          source: "request",
        });
        focusResults();
        return;
      }

      setState({ status: "success", response: parsed.data });
      focusResults();
    } catch (error) {
      if (sequence !== requestSequence.current || isAbortError(error)) {
        return;
      }

      setState({
        status: "error",
        message: SEARCH_FAILURE_MESSAGE,
        source: "request",
      });
      focusResults();
    } finally {
      if (sequence === requestSequence.current) {
        activeRequest.current = null;
      }
    }
  }

  const counts = state.status === "success"
    ? {
        foods: state.response.results.foods.length,
        supplements: state.response.results.supplements.length,
      }
    : null;
  const resultCount = counts ? counts.foods + counts.supplements : 0;
  const inputError = state.status === "error" && state.source === "input";
  const showResultsHeading =
    state.status === "loading" ||
    state.status === "success" ||
    (state.status === "error" && state.source === "request");

  return (
    <div className="w-full">
      <form
        role="search"
        aria-label="Search Murph Safe"
        onSubmit={submitSearch}
        className="mx-auto max-w-2xl"
      >
        <label htmlFor="murph-safe-product-search" className="sr-only">
          Search products
        </label>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            id="murph-safe-product-search"
            ref={searchInput}
            value={query}
            onChange={(event) => updateQuery(event.currentTarget.value)}
            aria-describedby={inputError
              ? "murph-safe-search-hint murph-safe-search-error"
              : "murph-safe-search-hint"}
            aria-invalid={inputError}
            inputSize="xl"
            autoCapitalize="none"
            autoComplete="off"
            enterKeyHint="search"
            maxLength={128}
            name="product-search"
            placeholder="Product, brand, ingredient, UPC"
            spellCheck={false}
            className="border-border bg-card text-foreground placeholder:text-muted-foreground"
          />
          <Button
            type="submit"
            size="xl"
            disabled={state.status === "loading"}
            className="min-h-14 w-full px-7 sm:w-auto"
          >
            {state.status === "loading" ? (
              <>
                <Spinner aria-hidden="true" />
                Searching
              </>
            ) : "Check product"}
          </Button>
        </div>
        <p id="murph-safe-search-hint" className="mt-4 text-center text-sm leading-6 text-muted-foreground">
          Try: AG1 · RXBAR · creatine monohydrate · 123456789012
        </p>
        {inputError ? (
          <p
            id="murph-safe-search-error"
            role="alert"
            className="mt-3 text-center text-sm leading-6 text-destructive sm:text-base"
          >
            {state.message}
          </p>
        ) : null}
      </form>

      <section
        aria-busy={state.status === "loading"}
        aria-labelledby="murph-safe-results-heading"
        className={showResultsHeading ? "mt-10 border-t border-border pt-7" : undefined}
      >
        {showResultsHeading ? (
          <h2
            id="murph-safe-results-heading"
            ref={resultsHeading}
            tabIndex={-1}
            className="font-serif text-2xl font-semibold tracking-[-0.025em] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background sm:text-3xl"
          >
            Search results
          </h2>
        ) : null}

        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {state.status === "loading" ? "Searching products…" : null}
          {state.status === "success"
            ? `Search complete. ${resultCount} matching ${resultCount === 1 ? "product" : "products"}.`
            : null}
        </div>

        {state.status === "loading" ? <SearchSkeleton /> : null}

        {state.status === "error" && state.source === "request" ? (
          <p
            id="murph-safe-search-error"
            role="alert"
            className="mt-5 max-w-2xl text-sm leading-6 text-destructive sm:text-base"
          >
            {state.message}
          </p>
        ) : null}

        {state.status === "success" && resultCount === 0 ? (
          <p className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            {NO_RESULTS_MESSAGE}
          </p>
        ) : null}

        {state.status === "success" && resultCount > 0 ? (
          <div className="mt-7 grid gap-10">
            {state.response.results.supplements.length > 0 ? (
              <ProductResultGroup
                heading="Supplements"
                results={state.response.results.supplements}
              />
            ) : null}
            {state.response.results.foods.length > 0 ? (
              <ProductResultGroup
                heading="Branded foods"
                results={state.response.results.foods}
              />
            ) : null}
            <p className="text-sm leading-6 text-muted-foreground">
              Showing the closest matches. Refine your search if the product is
              not listed.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ProductResultGroup(input: {
  heading: string;
  results: PublicProductSearchHit[];
}) {
  return (
    <section aria-label={input.heading}>
      <h3 className="font-mono text-[10px] font-medium tracking-[0.12em] text-muted-foreground">
        {input.heading.toUpperCase()}
      </h3>
      <div className="mt-3 border-t border-border">
        {input.results.map((result) => (
          <Link
            key={result.productRef}
            href={`/search/products/${encodeURIComponent(result.productRef)}`}
            prefetch={false}
            className="group grid min-h-24 gap-4 border-b border-border py-5 outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.38fr)] sm:items-center sm:px-3"
          >
            <span className="min-w-0">
              <span className="block font-mono text-[10px] font-medium tracking-[0.11em] text-muted-foreground">
                {result.source.name.toUpperCase()}
              </span>
              <span className="mt-2 block break-words font-serif text-xl font-semibold leading-tight tracking-[-0.02em] text-foreground group-hover:text-primary sm:text-2xl">
                {result.name}
              </span>
              <span className="mt-1 block break-words text-sm text-muted-foreground">
                {result.brand ?? "Brand not reported"}
              </span>
            </span>
            <span className="flex min-h-11 items-center text-sm leading-6 text-foreground sm:justify-end sm:text-right">
              {formatProductTestSummary(result)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function formatProductTestSummary(result: PublicProductSearchHit): string {
  const total = result.productTests.total;

  if (result.productTests.status === "no_known_product_tests") {
    return "No product tests found";
  }

  return `${total} product test${total === 1 ? "" : "s"}`;
}

function SearchSkeleton() {
  return (
    <div className="mt-7" aria-hidden="true">
      <p className="text-sm text-muted-foreground">Searching products…</p>
      <div className="mt-5 grid gap-5 border-t border-border pt-5">
        {[0, 1, 2].map((index) => (
          <div key={index} className="grid gap-3 border-b border-border pb-5 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <div className="grid gap-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-7 w-4/5" />
              <Skeleton className="h-4 w-2/5" />
            </div>
            <Skeleton className="h-5 w-40 sm:justify-self-end" />
          </div>
        ))}
      </div>
    </div>
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
