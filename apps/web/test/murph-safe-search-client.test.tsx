import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { PUBLIC_PRODUCTS_SCHEMA_VERSION } from "@murphai/contracts";

import { renderClientComponent } from "./render-client-component";

vi.mock("next/link", () => ({
  default(input: {
    children?: ReactNode;
    className?: string;
    href: string;
    prefetch?: boolean;
  }) {
    return createElement("a", {
      className: input.className,
      "data-prefetch": String(input.prefetch),
      href: input.href,
    }, input.children);
  },
}));

vi.mock("@/src/components/ui/button", () => ({
  Button({ size, ...props }: ComponentProps<"button"> & { size?: string }) {
    void size;
    return createElement("button", props);
  },
}));

vi.mock("@/src/components/ui/input", () => ({
  Input({ inputSize, onChange, ...props }: ComponentProps<"input"> & {
    inputSize?: string;
  }) {
    void inputSize;
    return createElement("input", { ...props, onInput: onChange });
  },
}));

vi.mock("@/src/components/ui/skeleton", () => ({
  Skeleton(props: ComponentProps<"div">) {
    return createElement("div", props);
  },
}));

vi.mock("@/src/components/ui/spinner", () => ({
  Spinner(props: ComponentProps<"span">) {
    return createElement("span", { ...props, "data-slot": "spinner" });
  },
}));

import { MurphSafeSearchClient } from "@/src/components/murph-safe/search-client";

const fetchMock = vi.fn<typeof fetch>();
let cleanup: (() => Promise<void>) | null = null;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  if (cleanup) {
    await cleanup();
    cleanup = null;
  }
  vi.unstubAllGlobals();
});

describe("MurphSafeSearchClient", () => {
  test("keeps the submitted term in a private POST body and renders grouped results", async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeSearchResponse({
      foodName: "Cocoa Protein Bar",
      supplementName: "Creatine Monohydrate",
    })));
    const rendered = await renderClientComponent(
      createElement(MurphSafeSearchClient),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;

    await changeSearchValue(rendered.window, rendered.container, "creatine");
    await submitSearch(rendered.window, rendered.container);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/public/v1/products/search");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("omit");
    expect(init?.referrerPolicy).toBe("no-referrer");
    expect(init?.cache).toBe("no-store");
    expect(JSON.parse(String(init?.body))).toEqual({
      kinds: ["supplement", "food"],
      limitPerKind: 6,
      query: "creatine",
    });
    expect(rendered.replaceState).not.toHaveBeenCalled();
    expect(rendered.container.textContent).toContain("SUPPLEMENTS");
    expect(rendered.container.textContent).toContain("BRANDED FOODS");
    expect(rendered.container.textContent).toContain("Creatine Monohydrate");
    expect(rendered.container.textContent).toContain("Cocoa Protein Bar");
    expect(rendered.container.textContent).toContain("2 linked test observations");
    expect(rendered.container.textContent).not.toContain("SUPPLEMENT ·");

    const resultLink = rendered.container.querySelector(
      'a[href="/search/products/supplement_c3VwcGxlbWVudC0x"]',
    );
    expect(resultLink?.getAttribute("data-prefetch")).toBe("false");
  });

  test("validates a blank submission without making a request", async () => {
    const rendered = await renderClientComponent(
      createElement(MurphSafeSearchClient),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;
    const input = rendered.container.querySelector<HTMLInputElement>(
      "#murph-safe-product-search",
    );
    if (!input) {
      throw new Error("Murph Safe search input was not rendered.");
    }
    const focus = vi.spyOn(input, "focus");

    await submitSearch(rendered.window, rendered.container);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(rendered.container.textContent).toContain(
      "Enter a product, brand, ingredient, or UPC.",
    );
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain(
      "murph-safe-search-error",
    );
    expect(input.className).toContain("placeholder:text-muted-foreground");
    expect(input.className).not.toContain("placeholder:text-muted-foreground/80");
    expect(
      rendered.container.querySelector('form[role="search"] #murph-safe-search-error'),
    ).not.toBeNull();
    expect(
      rendered.container.querySelector("section #murph-safe-search-error"),
    ).toBeNull();
    expect(rendered.container.querySelector("h2")?.textContent).toBe(
      "Search the product record",
    );
    expect(focus).toHaveBeenCalledOnce();
  });

  test("uses the dedicated rate-limit recovery copy", async () => {
    fetchMock.mockResolvedValue(new Response("Too many requests", { status: 429 }));
    const rendered = await renderClientComponent(
      createElement(MurphSafeSearchClient),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;

    await changeSearchValue(rendered.window, rendered.container, "protein");
    await submitSearch(rendered.window, rendered.container);

    expect(rendered.container.textContent).toContain(
      "Too many searches. Please wait a minute before trying again.",
    );
  });

  test("renders the explicit empty-result state", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
      results: { foods: [], supplements: [] },
    }));
    const rendered = await renderClientComponent(
      createElement(MurphSafeSearchClient),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;

    await changeSearchValue(rendered.window, rendered.container, "missing product");
    await submitSearch(rendered.window, rendered.container);

    expect(rendered.container.textContent).toContain(
      "No matching product found. Try an exact product name, brand, ingredient, or UPC.",
    );
  });

  test("uses the generic recovery state for ordinary server failures", async () => {
    fetchMock.mockResolvedValue(new Response("Unavailable", { status: 503 }));
    const rendered = await renderClientComponent(
      createElement(MurphSafeSearchClient),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;

    await changeSearchValue(rendered.window, rendered.container, "protein bar");
    await submitSearch(rendered.window, rendered.container);

    expect(rendered.container.textContent).toContain(
      "Search is unavailable right now. Your search was not completed. Try again in a moment.",
    );
  });

  test("allows only the newest overlapping request to update results", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    fetchMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const rendered = await renderClientComponent(
      createElement(MurphSafeSearchClient),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;

    await changeSearchValue(rendered.window, rendered.container, "first product");
    await submitSearchWithoutWaiting(rendered.window, rendered.container);
    const firstSignal = fetchMock.mock.calls[0]?.[1]?.signal;

    await changeSearchValue(rendered.window, rendered.container, "second product");
    await submitSearchWithoutWaiting(rendered.window, rendered.container);

    expect(firstSignal?.aborted).toBe(true);

    await act(async () => {
      second.resolve(jsonResponse(makeSearchResponse({
        foodName: "Second Food",
        supplementName: "Second Supplement",
      })));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      first.resolve(jsonResponse(makeSearchResponse({
        foodName: "Stale Food",
        supplementName: "Stale Supplement",
      })));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.container.textContent).toContain("Second Supplement");
    expect(rendered.container.textContent).not.toContain("Stale Supplement");
  });

  test("clears and aborts an in-flight search when the visible query changes", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const rendered = await renderClientComponent(
      createElement(MurphSafeSearchClient),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;

    await changeSearchValue(rendered.window, rendered.container, "first product");
    await submitSearchWithoutWaiting(rendered.window, rendered.container);
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(rendered.container.querySelector('[data-slot="spinner"]')).not.toBeNull();

    await changeSearchValue(rendered.window, rendered.container, "edited product");

    expect(signal?.aborted).toBe(true);
    expect(rendered.container.textContent).toContain("Search the product record");

    await act(async () => {
      pending.resolve(jsonResponse(makeSearchResponse({
        foodName: "Stale Food",
        supplementName: "Stale Supplement",
      })));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.container.textContent).not.toContain("Stale Supplement");
  });

  test("keeps completed results visible while the user refines the query", async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeSearchResponse({
      foodName: "Original Food",
      supplementName: "Original Supplement",
    })));
    const rendered = await renderClientComponent(
      createElement(MurphSafeSearchClient),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;

    await changeSearchValue(rendered.window, rendered.container, "original product");
    await submitSearch(rendered.window, rendered.container);
    await changeSearchValue(rendered.window, rendered.container, "refined product");

    expect(rendered.container.textContent).toContain("Original Supplement");
    expect(rendered.container.querySelector("h2")?.textContent).toBe("Search results");
  });
});

function makeSearchResponse(input: {
  foodName: string;
  supplementName: string;
}) {
  return {
    schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
    results: {
      foods: [
        {
          brand: "Example Foods",
          kind: "food",
          name: input.foodName,
          productRef: "food_Zm9vZC0x",
          productTests: {
            status: "no_known_product_tests",
            total: 0,
          },
          source: {
            key: "usda_branded",
            name: "USDA FoodData Central",
          },
          upc: "123456789012",
        },
      ],
      supplements: [
        {
          brand: "Example Labs",
          kind: "supplement",
          name: input.supplementName,
          productRef: "supplement_c3VwcGxlbWVudC0x",
          productTests: {
            status: "known_product_tests",
            total: 2,
          },
          source: {
            key: "dsld",
            name: "Dietary Supplement Label Database",
          },
          upc: null,
        },
      ],
    },
  };
}

async function changeSearchValue(
  window: Window & typeof globalThis,
  container: HTMLElement,
  value: string,
) {
  const input = container.querySelector<HTMLInputElement>(
    "#murph-safe-product-search",
  );
  if (!input) {
    throw new Error("Murph Safe search input was not rendered.");
  }

  await act(async () => {
    input.value = value;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

async function submitSearch(
  window: Window & typeof globalThis,
  container: HTMLElement,
) {
  await act(async () => {
    getSearchForm(container).dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function submitSearchWithoutWaiting(
  window: Window & typeof globalThis,
  container: HTMLElement,
) {
  await act(async () => {
    getSearchForm(container).dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

function getSearchForm(container: HTMLElement): HTMLFormElement {
  const form = container.querySelector<HTMLFormElement>('form[role="search"]');
  if (!form) {
    throw new Error("Murph Safe search form was not rendered.");
  }
  return form;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
