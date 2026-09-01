import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { PUBLIC_PRODUCTS_SCHEMA_VERSION } from "@murphai/contracts";

import { FOOD_LABEL_DESIGN_PRODUCTS } from "@/app/design/food-label-lab-study";
import { FoodLabelLab } from "@/src/components/food-label-lab/food-label-lab";

import { renderClientComponent } from "./render-client-component";

vi.mock("next/image", () => ({
  default: (props: {
    alt?: string;
    className?: string;
    height?: number;
    src: string;
    width?: number;
  }) => createElement("img", props),
}));

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

describe("FoodLabelLab", () => {
  test("keeps the query in a private POST and builds the visible comparison", async () => {
    const [first, second] = FOOD_LABEL_DESIGN_PRODUCTS;
    if (!first || !second) {
      throw new Error("Food Label Lab design products are missing.");
    }
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
        results: {
          supplements: [],
          foods: [searchHit(first), searchHit(second)],
        },
      }))
      .mockResolvedValueOnce(detailResponse(first))
      .mockResolvedValueOnce(detailResponse(second));

    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, { webMcpEnabled: false }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;
    await click(findButton(rendered.container, "plain Greek yogurt"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [searchUrl, searchInit] = fetchMock.mock.calls[0] ?? [];
    expect(searchUrl).toBe("/api/public/v1/products/search");
    expect(searchInit?.method).toBe("POST");
    expect(searchInit?.credentials).toBe("omit");
    expect(searchInit?.referrerPolicy).toBe("no-referrer");
    expect(searchInit?.cache).toBe("no-store");
    expect(JSON.parse(String(searchInit?.body))).toEqual({
      query: "plain Greek yogurt",
      kinds: ["food"],
      limitPerKind: 6,
    });
    expect(rendered.replaceState).not.toHaveBeenCalled();

    const addButtons = findProductButtons(rendered.container);
    expect(addButtons).toHaveLength(2);

    await click(addButtons[0]);
    await click(findProductButtons(rendered.container).find(
      (button) => !button.disabled,
    ));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(rendered.container.textContent).toContain("Top match · 3 of 4");
    expect(rendered.container.textContent).toContain("Evidence: partial");
    expect(rendered.container.textContent).toContain("0 alerts");
    expect(rendered.container.querySelector('section[aria-label="Food comparison"]'))
      .not.toBeNull();
  });

  test("shows a short rate-limit recovery state", async () => {
    fetchMock.mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, { webMcpEnabled: false }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;
    await click(findButton(rendered.container, "plain Greek yogurt"));

    expect(rendered.container.textContent).toContain(
      "Too many searches. Wait a minute and try again.",
    );
  });
});

function searchHit(product: (typeof FOOD_LABEL_DESIGN_PRODUCTS)[number]) {
  return {
    productRef: product.productRef,
    kind: "food" as const,
    name: product.name,
    brand: product.brand,
    upc: product.upc,
    source: { key: product.source.key, name: product.source.name },
    productTests: {
      status: product.productTests.status,
      total: product.productTests.total,
    },
  };
}

function detailResponse(product: (typeof FOOD_LABEL_DESIGN_PRODUCTS)[number]) {
  return jsonResponse({
    schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
    product,
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function findProductButtons(container: HTMLElement): HTMLButtonElement[] {
  return [
    ...container.querySelectorAll<HTMLButtonElement>(
      "button[data-food-product-ref]",
    ),
  ];
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === text,
  );
}

async function click(button: HTMLButtonElement | undefined) {
  if (!button) {
    throw new Error("Expected button did not render.");
  }
  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}
