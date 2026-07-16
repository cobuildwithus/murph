import assert from "node:assert/strict";

import { act, createElement, type InputHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  HostedRuntimeLabsLocation,
  HostedRuntimeLabsLocationsResponse,
  HostedRuntimeLabsOffering,
  HostedRuntimeLabsSearchResponse,
  HostedRuntimeLabsShowResponse,
} from "@murphai/hosted-execution/labs";

import { renderClientComponent } from "./render-client-component";

const fetchMock = vi.fn<typeof fetch>();
let cleanupRender: (() => Promise<void>) | null = null;

vi.mock("@/src/components/ui/responsive-select", () => ({
  ResponsiveSelect(props: {
    ariaLabel: string;
    onValueChange: (value: string) => void;
    options: Array<{ label: string; value: string }>;
    value: string;
  }) {
    return createElement(
      "select",
      {
        "aria-label": props.ariaLabel,
        onChange: (event: { currentTarget: { value: string } }) =>
          props.onValueChange(event.currentTarget.value),
        value: props.value,
      },
      props.options.map((option) =>
        createElement("option", { key: option.value, value: option.value }, option.label),
      ),
    );
  },
}));

vi.mock("@/src/components/ui/input", () => ({
  Input({
    inputSize,
    ...props
  }: InputHTMLAttributes<HTMLInputElement> & { inputSize?: string }) {
    void inputSize;
    return createElement("input", props);
  },
}));

import { LabsPageClient } from "../app/(dashboard)/labs/labs-page-client";

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
  vi.unstubAllGlobals();
});

describe("LabsPageClient", () => {
  it("starts read-only with two independent forms and performs no initial request", async () => {
    const rendered = await renderLabsPage();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(rendered.container.textContent).toContain("Discovery only");
    expect(rendered.container.textContent).toContain(
      "Ordering through Murph is not available yet",
    );
    expect(rendered.container.querySelectorAll("form")).toHaveLength(2);

    const actionLabels = [...rendered.container.querySelectorAll("button")]
      .map((button) => button.textContent?.trim());
    expect(actionLabels).not.toContain("Buy");
    expect(actionLabels).not.toContain("Book");
    expect(actionLabels).not.toContain("Order");
  });

  it("validates search and ZIP input without sending a request", async () => {
    const rendered = await renderLabsPage();

    await changeInput(rendered, "#labs-catalog-query", " ");
    await submitForm(rendered, 0);
    expect(rendered.container.textContent).toContain("Enter at least 2 characters.");
    expect(
      rendered.container.querySelector("#labs-catalog-query")?.getAttribute("aria-describedby"),
    ).toContain("labs-catalog-query-error");

    await changeInput(rendered, "#labs-location-zip", "12");
    await submitForm(rendered, 1);
    expect(rendered.container.textContent).toContain("Enter a 5-digit ZIP code.");
    expect(
      rendered.container.querySelector("#labs-location-zip")?.getAttribute("aria-describedby"),
    ).toContain("labs-location-zip-error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("trims a search, preserves provider relevance, and renders panels and missing prices", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(searchResponse([
      panelOffering,
      {
        ...biomarkerOffering,
        catalogPrice: null,
      },
    ], 42)));
    const rendered = await renderLabsPage();
    const persistentStatus = rendered.container.querySelector("#labs-catalog-status");
    assert.ok(persistentStatus);

    await changeInput(rendered, "#labs-catalog-query", "  cholesterol  ");
    await submitForm(rendered, 0);

    expect(readRequestBody(0)).toEqual({
      action: "search",
      kind: "all",
      limit: 20,
      query: "cholesterol",
    });
    expect(rendered.container.textContent).toContain("Broad Heart Panel");
    expect(rendered.container.textContent).toContain("Apolipoprotein B");
    expect(rendered.container.textContent).toContain("$149.00");
    expect(rendered.container.textContent).toContain("Unavailable");
    expect(rendered.container.textContent).toContain(
      "2 results shown of 42 matching catalog items",
    );
    expect(rendered.container.querySelector("#labs-catalog-status")).toBe(persistentStatus);
    expect(persistentStatus.textContent).toContain(
      "2 results shown of 42 matching catalog items",
    );

    const text = rendered.container.textContent ?? "";
    expect(text.indexOf("Broad Heart Panel")).toBeLessThan(text.indexOf("Apolipoprotein B"));
  });

  it("shows loading, empty, error, and retry states", async () => {
    const first = createDeferred<Response>();
    fetchMock
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(jsonResponse(searchResponse([])))
      .mockResolvedValueOnce(jsonResponse(searchResponse([panelOffering])));
    const rendered = await renderLabsPage();

    await changeInput(rendered, "#labs-catalog-query", "lipids");
    await submitFormWithoutWaiting(rendered, 0);
    expect(rendered.container.textContent).toContain("Searching Junction's live catalog");

    await resolveDeferred(first, jsonResponse({}, 503));
    expect(rendered.container.textContent).toContain("Catalog temporarily unavailable");

    await clickButton(rendered, "Retry");
    expect(rendered.container.textContent).toContain("No matching tests");

    await submitForm(rendered, 0);
    expect(rendered.container.textContent).toContain("Broad Heart Panel");
  });

  it("distinguishes expired session failures from retryable provider failures", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({}, 403));
    const rendered = await renderLabsPage();

    await changeInput(rendered, "#labs-catalog-query", "lipids");
    await submitForm(rendered, 0);
    expect(rendered.container.textContent).toContain("Session needs attention");
    expect(rendered.container.textContent).toContain("Your search was not saved");
    expect(rendered.container.textContent).not.toContain("Catalog temporarily unavailable");

    await changeInput(rendered, "#labs-location-zip", "10001");
    await submitForm(rendered, 1);
    expect(rendered.container.textContent).toContain("Your ZIP was not saved");
    expect(rendered.container.textContent).not.toContain("Locations temporarily unavailable");
  });

  it("prevents an aborted older catalog response from replacing a newer search", async () => {
    const older = createDeferred<Response>();
    const newer = createDeferred<Response>();
    fetchMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const rendered = await renderLabsPage();

    await changeInput(rendered, "#labs-catalog-query", "older query");
    await submitFormWithoutWaiting(rendered, 0);
    const olderSignal = readRequestSignal(0);

    await changeInput(rendered, "#labs-catalog-query", "newer query");
    await submitFormWithoutWaiting(rendered, 0);
    expect(olderSignal.aborted).toBe(true);

    await resolveDeferred(newer, jsonResponse(searchResponse([
      { ...biomarkerOffering, name: "Newer result" },
    ])));
    expect(rendered.container.textContent).toContain("Newer result");

    await resolveDeferred(older, jsonResponse(searchResponse([
      { ...panelOffering, name: "Older result" },
    ])));
    expect(rendered.container.textContent).toContain("Newer result");
    expect(rendered.container.textContent).not.toContain("Older result");
  });

  it("loads one accessible inline detail, retries an error, and clears it on a new search", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(searchResponse([panelOffering])))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse(showResponse({
        ...panelOffering,
        description: "A provider-authored cardiovascular panel description.",
      })))
      .mockResolvedValueOnce(jsonResponse(searchResponse([biomarkerOffering])));
    const rendered = await renderLabsPage();

    await changeInput(rendered, "#labs-catalog-query", "heart panel");
    await submitForm(rendered, 0);

    const detailsButton = buttonByLabel(rendered, "View details for Broad Heart Panel");
    expect(detailsButton.getAttribute("aria-expanded")).toBe("false");
    expect(detailsButton.getAttribute("aria-controls")).toBeNull();
    await clickButtonElement(rendered, detailsButton);
    expect(detailsButton.getAttribute("aria-expanded")).toBe("true");
    expect(detailsButton.getAttribute("aria-controls")).toBeTruthy();
    expect(rendered.container.textContent).toContain("Details temporarily unavailable");

    await clickButton(rendered, "Retry");
    expect(rendered.container.textContent).toContain(
      "A provider-authored cardiovascular panel description.",
    );
    expect(readRequestBody(1)).toEqual({
      action: "show",
      labId: panelOffering.labId,
      providerId: panelOffering.providerId,
    });

    await changeInput(rendered, "#labs-catalog-query", "apob");
    await submitForm(rendered, 0);
    expect(rendered.container.textContent).not.toContain(
      "A provider-authored cardiovascular panel description.",
    );
    expect(rendered.container.querySelector('[aria-expanded="true"]')).toBeNull();
  });

  it("renders home collection and walk-in details without claiming test-level availability", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(locationsResponse({
      homeCollectionAvailable: true,
      locations: [
        { ...locationFixture, distanceMiles: 0.01, name: "Adjacent Collection Center" },
        locationFixture,
      ],
      status: "available",
    })));
    const rendered = await renderLabsPage();
    const persistentStatus = rendered.container.querySelector("#labs-locations-status");
    assert.ok(persistentStatus);

    await changeInput(rendered, "#labs-location-zip", "10001");
    await submitForm(rendered, 1);

    expect(readRequestBody(0)).toEqual({
      action: "locations",
      limit: 8,
      radiusMiles: 25,
      zipCode: "10001",
    });
    expect(rendered.container.textContent).toContain("Home collection listed");
    expect(rendered.container.textContent).toContain("Fixture Collection Center");
    expect(rendered.container.textContent).toContain("<0.1 mi");
    expect(rendered.container.textContent).toContain("1.7 mi");
    expect(rendered.container.querySelector("#labs-locations-status")).toBe(persistentStatus);
    expect(persistentStatus.textContent).toContain("2 walk-in sites returned");
    expect(rendered.container.textContent).toContain(
      "does not confirm that a particular test can be collected there",
    );
    expect(rendered.container.textContent).not.toContain("supports Broad Heart Panel");
  });

  it("keeps catalog results while locations fail, then renders a clean not-served result on retry", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(searchResponse([panelOffering])))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse(locationsResponse({
        homeCollectionAvailable: false,
        locations: [],
        status: "not_served",
      })));
    const rendered = await renderLabsPage();

    await changeInput(rendered, "#labs-catalog-query", "lipids");
    await submitForm(rendered, 0);
    await changeInput(rendered, "#labs-location-zip", "10001");
    await submitForm(rendered, 1);

    expect(rendered.container.textContent).toContain("Broad Heart Panel");
    expect(rendered.container.textContent).toContain("Locations temporarily unavailable");

    await clickButton(rendered, "Retry");
    expect(rendered.container.textContent).toContain("Broad Heart Panel");
    expect(rendered.container.textContent).toContain("No collection coverage found");
  });

  it("prevents an aborted older location response from replacing a newer ZIP result", async () => {
    const older = createDeferred<Response>();
    const newer = createDeferred<Response>();
    fetchMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const rendered = await renderLabsPage();

    await changeInput(rendered, "#labs-location-zip", "10001");
    await submitFormWithoutWaiting(rendered, 1);
    const olderSignal = readRequestSignal(0);

    await changeInput(rendered, "#labs-location-zip", "94105");
    await submitFormWithoutWaiting(rendered, 1);
    expect(olderSignal.aborted).toBe(true);

    await resolveDeferred(newer, jsonResponse(locationsResponse({
      homeCollectionAvailable: true,
      locations: [{ ...locationFixture, name: "Newer collection site" }],
      status: "available",
      zipCode: "94105",
    })));
    expect(rendered.container.textContent).toContain("Newer collection site");

    await resolveDeferred(older, jsonResponse(locationsResponse({
      homeCollectionAvailable: true,
      locations: [{ ...locationFixture, name: "Older collection site" }],
      status: "available",
    })));
    expect(rendered.container.textContent).toContain("Newer collection site");
    expect(rendered.container.textContent).not.toContain("Older collection site");
  });
});

const panelOffering: HostedRuntimeLabsOffering = {
  catalogPrice: {
    amount: "149.00",
    currency: "USD",
    source: "junction_catalog",
  },
  commonTurnaroundDays: 3,
  description: "A synthetic panel used for interface coverage.",
  includedMarkerCount: 4,
  includedMarkers: [
    { name: "Total cholesterol", slug: "total-cholesterol" },
    { name: "HDL cholesterol", slug: "hdl-cholesterol" },
    { name: "LDL cholesterol", slug: "ldl-cholesterol" },
  ],
  junctionOrderable: true,
  kind: "panel",
  labId: 7,
  maximumTurnaroundDays: 7,
  name: "Broad Heart Panel",
  offeringId: "fixture:panel:heart",
  providerId: "fixture-panel-heart",
  slug: "broad-heart-panel",
  unit: null,
};

const biomarkerOffering: HostedRuntimeLabsOffering = {
  catalogPrice: {
    amount: "39.00",
    currency: "USD",
    source: "junction_catalog",
  },
  commonTurnaroundDays: 2,
  description: "A synthetic biomarker used for interface coverage.",
  includedMarkerCount: 0,
  includedMarkers: [],
  junctionOrderable: true,
  kind: "biomarker",
  labId: 7,
  maximumTurnaroundDays: 5,
  name: "Apolipoprotein B",
  offeringId: "fixture:biomarker:apob",
  providerId: "fixture-biomarker-apob",
  slug: "apolipoprotein-b",
  unit: "mg/dL",
};

const locationFixture: HostedRuntimeLabsLocation = {
  address: {
    city: "Example City",
    line1: "100 Example Avenue",
    line2: null,
    postalCode: "10001",
    state: "NY",
  },
  capabilities: ["blood_draw"],
  coordinates: {
    latitude: 40.75,
    longitude: -73.99,
  },
  distanceMiles: 1.7,
  labId: 7,
  labSlug: "fixture-lab",
  name: "Fixture Collection Center",
  phoneNumber: "(555) 010-0100",
  siteCode: "fixture-site-1",
};

function searchResponse(
  items: HostedRuntimeLabsOffering[],
  total = items.length,
): HostedRuntimeLabsSearchResponse {
  return {
    action: "search",
    checkedAt: "2026-07-16T15:00:00.000Z",
    items,
    orderableThroughMurph: false,
    orderingStatus: "discovery_only",
    provider: {
      page: 1,
      pages: 1,
      total,
    },
    source: "junction",
  };
}

function showResponse(offering: HostedRuntimeLabsOffering): HostedRuntimeLabsShowResponse {
  return {
    action: "show",
    checkedAt: "2026-07-16T15:01:00.000Z",
    offering,
    orderableThroughMurph: false,
    orderingStatus: "discovery_only",
    source: "junction",
  };
}

function locationsResponse(
  overrides: Partial<HostedRuntimeLabsLocationsResponse> = {},
): HostedRuntimeLabsLocationsResponse {
  return {
    action: "locations",
    checkedAt: "2026-07-16T15:02:00.000Z",
    homeCollectionAvailable: false,
    locations: [],
    orderableThroughMurph: false,
    orderingStatus: "discovery_only",
    radiusMiles: 25,
    source: "junction",
    status: "available",
    zipCode: "10001",
    ...overrides,
  };
}

async function renderLabsPage() {
  const rendered = await renderClientComponent(createElement(LabsPageClient), {
    requireButton: false,
  });
  cleanupRender = rendered.cleanup;
  return rendered;
}

async function changeInput(
  rendered: Awaited<ReturnType<typeof renderLabsPage>>,
  selector: string,
  value: string,
) {
  const input = rendered.container.querySelector(selector);
  assert.ok(input instanceof rendered.window.HTMLInputElement);

  await act(async () => {
    input.value = value;
    input.dispatchEvent(new rendered.window.Event("input", { bubbles: true }));
    input.dispatchEvent(new rendered.window.Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

async function submitForm(
  rendered: Awaited<ReturnType<typeof renderLabsPage>>,
  index: number,
) {
  await act(async () => {
    requireForm(rendered, index).dispatchEvent(
      new rendered.window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
  });
}

async function submitFormWithoutWaiting(
  rendered: Awaited<ReturnType<typeof renderLabsPage>>,
  index: number,
) {
  await act(async () => {
    requireForm(rendered, index).dispatchEvent(
      new rendered.window.Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

function requireForm(
  rendered: Awaited<ReturnType<typeof renderLabsPage>>,
  index: number,
): Element {
  const form = rendered.container.querySelectorAll("form").item(index);
  assert.equal(form?.localName, "form");
  return form;
}

async function clickButton(
  rendered: Awaited<ReturnType<typeof renderLabsPage>>,
  label: string,
) {
  await clickButtonElement(rendered, buttonByText(rendered, label));
}

async function clickButtonElement(
  rendered: Awaited<ReturnType<typeof renderLabsPage>>,
  button: Element,
) {
  await act(async () => {
    button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });
}

function buttonByText(
  rendered: Awaited<ReturnType<typeof renderLabsPage>>,
  label: string,
): Element {
  const button = [...rendered.container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  assert.equal(button?.localName, "button");
  return button;
}

function buttonByLabel(
  rendered: Awaited<ReturnType<typeof renderLabsPage>>,
  label: string,
): Element {
  const button = rendered.container.querySelector(`button[aria-label="${label}"]`);
  assert.equal(button?.localName, "button");
  return button;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function readRequestBody(index: number): unknown {
  const init = fetchMock.mock.calls[index]?.[1];
  if (!init || typeof init.body !== "string") {
    throw new Error("Expected a JSON request body.");
  }
  return JSON.parse(init.body) as unknown;
}

function readRequestSignal(index: number): AbortSignal {
  const init = fetchMock.mock.calls[index]?.[1];
  if (!init?.signal) {
    throw new Error("Expected an abort signal.");
  }
  return init.signal;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function resolveDeferred<T>(
  deferred: ReturnType<typeof createDeferred<T>>,
  value: T,
) {
  await act(async () => {
    deferred.resolve(value);
    await deferred.promise;
    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve();
    }
  });
}
