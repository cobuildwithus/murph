import {
  act,
  createElement,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveLabResultMetricDefinition } from "@murphai/health-metrics";
import { beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const navigationMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  tab: "sections",
}));

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();

  return {
    ...actual,
    useRouter: () => ({ replace: navigationMocks.replace }),
    useSearchParams: () => new URLSearchParams(`tab=${navigationMocks.tab}`),
  };
});

vi.mock("next/link", async () => {
  const React = await import("react");

  return {
    default({
      prefetch,
      ...props
    }: ComponentPropsWithoutRef<"a"> & { prefetch?: boolean }) {
      void prefetch;
      return React.createElement("a", props);
    },
  };
});

vi.mock("@/src/components/biomarkers/lab-biomarker-history-chart", async () => {
  const React = await import("react");

  return {
    LabBiomarkerHistoryChart({
      ariaDescribedBy,
      displayName,
      points,
      referenceRange,
    }: {
      ariaDescribedBy?: string;
      displayName: string;
      points: readonly unknown[];
      referenceRange: { high: number | null; low: number | null };
      unit: string | null;
    }): ReactNode {
      return React.createElement("div", {
        "aria-describedby": ariaDescribedBy,
        "aria-label": `${displayName} results over time`,
        "data-high": referenceRange.high,
        "data-low": referenceRange.low,
        "data-point-count": points.length,
        role: "img",
      });
    },
  };
});

import {
  BiomarkerBoundaryResultStudy,
  BiomarkerDetailStudy,
  BiomarkerIndexStudy,
} from "@/src/components/biomarkers/biomarker-design-studies";
import {
  BIOMARKER_DEVICE_STUDIES,
  BIOMARKER_STUDY_GROUPS,
} from "@/src/components/biomarkers/biomarker-design-data";
import { DesignPage } from "@/app/design/design-page";

beforeEach(() => {
  navigationMocks.replace.mockReset();
  navigationMocks.tab = "sections";
});

test("design page routes the biomarker studies through the dedicated sections tab", () => {
  const sectionsMarkup = renderToStaticMarkup(createElement(DesignPage));

  expect(sectionsMarkup).toContain(">Sections<");
  expect(sectionsMarkup).toContain("Biomarker index");
  expect(sectionsMarkup).toContain("Biomarker detail");
  expect(sectionsMarkup).toContain("Boundary result detail");
  expect(sectionsMarkup).toContain('data-design-study="biomarker-index"');
  expect(sectionsMarkup).toContain('data-design-study="biomarker-detail"');
  expect(sectionsMarkup).toContain('data-design-study="biomarker-boundary-result"');
  expect(sectionsMarkup).toContain("max-w-7xl");

  navigationMocks.tab = "components";
  const componentsMarkup = renderToStaticMarkup(createElement(DesignPage));

  expect(componentsMarkup).toContain(">Components<");
  expect(componentsMarkup).not.toContain('data-design-study="biomarker-index"');
  expect(componentsMarkup).not.toContain('data-design-study="biomarker-detail"');
  expect(componentsMarkup).not.toContain('data-design-study="biomarker-boundary-result"');
  expect(componentsMarkup).toContain("max-w-5xl");
  expect(componentsMarkup).not.toContain("max-w-7xl");
});

test("biomarker design data covers the full synthetic catalog", () => {
  const results = BIOMARKER_STUDY_GROUPS.flatMap((group) => group.results);

  expect(BIOMARKER_DEVICE_STUDIES).toHaveLength(5);
  expect(BIOMARKER_STUDY_GROUPS).toHaveLength(13);
  expect(results).toHaveLength(117);
  expect(results.filter((result) => result.status === "review")).toHaveLength(20);
  expect(results.filter((result) => result.status === "in-range")).toHaveLength(84);
  expect(results.filter((result) => result.status === "reported")).toHaveLength(13);
  for (const result of results) {
    expect(resolveLabResultMetricDefinition(result.name)?.key).toBe(result.metricKey);
  }
});

test("biomarker index study keeps device context, source flags, and area disclosures explicit", () => {
  const markup = renderToStaticMarkup(createElement(BiomarkerIndexStudy));

  expect(markup).toContain('data-design-study="biomarker-index"');
  expect(markup).toContain("Your biomarkers");
  expect(markup).toContain("From your devices");
  expect(markup).toContain("From the lab");
  expect(markup).toContain('class="font-serif text-2xl font-semibold tracking-tight text-foreground" id="device-study-heading"');
  expect(markup).toContain('class="font-serif text-2xl font-semibold tracking-tight text-foreground" id="lab-study-heading"');
  expect(markup).not.toContain("Saved lab biomarkers");
  expect(markup).not.toContain("Status comes from the reporting lab");
  expect(markup).toContain("Deep sleep");
  expect(markup).toContain("HRV");
  expect(markup).toContain("SpO₂");
  expect(markup).toContain("growth-hormone release");
  expect(markup).toContain('class="hidden font-mono text-[9px] uppercase');
  expect(markup).toContain("md:block");
  expect(markup).toContain("line-clamp-2");
  expect(markup).toContain("md:line-clamp-none");
  expect(markup).toContain('type="search"');
  expect(markup).toContain('placeholder="Search biomarkers"');
  expect(markup).toContain("Review");
  expect(markup).not.toContain("Out of range");
  expect(markup).toContain('aria-pressed="true"');
  expect(markup).toContain("117 lab markers");
  expect(markup).not.toContain("reported without a flag");
  expect(markup).toContain('aria-label="All, 117"');
  expect(markup).toContain('aria-label="Review, 20"');
  expect(markup).toContain('aria-label="In range, 84"');
  expect(markup).toContain("Above range");
  expect(markup).toContain("In range");
  expect(markup).toContain('href="/biomarkers/results/hemoglobin"');
  expect(markup).toContain('href="/biomarkers/results/mean-corpuscular-hemoglobin"');
  expect(markup).not.toContain("md:grid-cols-2");
  expect(markup.indexOf('href="/biomarkers/results/eosinophil-percentage"')).toBeLessThan(
    markup.indexOf('href="/biomarkers/results/basophil-percentage"'),
  );
  expect(markup.match(/<details/g)).toHaveLength(13);
  expect(markup.match(/<details[^>]*open=""/g) ?? []).toHaveLength(13);
  expect(markup).not.toContain(">Other<");
});

test("biomarker index study applies the status control to the visible rows", async () => {
  const rendered = await renderClientComponent(
    createElement(BiomarkerIndexStudy),
    { requireButton: false },
  );

  try {
    const reviewButton = getButton(rendered.container, "Review");
    await click(rendered.window, reviewButton);

    expect(reviewButton.getAttribute("aria-pressed")).toBe("true");
    expect(readResultLinks(rendered.container)).toEqual([
      "/biomarkers/results/c-peptide",
      "/biomarkers/results/insulin",
      "/biomarkers/results/hdl-c",
      "/biomarkers/results/homocysteine",
      "/biomarkers/results/ldl-chol-calc-nih",
      "/biomarkers/results/egfr-ckd-epi",
      "/biomarkers/results/total-bilirubin",
      "/biomarkers/results/free-t4",
      "/biomarkers/results/eosinophil-percentage",
      "/biomarkers/results/absolute-immature-granulocytes",
      "/biomarkers/results/lymphocyte-percentage",
      "/biomarkers/results/mean-corpuscular-hemoglobin-concentration",
      "/biomarkers/results/cortisol",
      "/biomarkers/results/sex-hormone-binding-globulin",
      "/biomarkers/results/epa",
      "/biomarkers/results/iron-saturation",
      "/biomarkers/results/omega-6-3-ratio",
      "/biomarkers/results/chloride",
      "/biomarkers/results/potassium",
      "/biomarkers/results/psa-total",
    ]);
    expect(rendered.container.querySelectorAll("details")).toHaveLength(10);
  } finally {
    await rendered.cleanup();
  }
});

test("biomarker index study searches across marker names and health areas", async () => {
  const rendered = await renderClientComponent(
    createElement(BiomarkerIndexStudy),
    { requireButton: false },
  );

  try {
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]');
    if (!input) {
      throw new Error("Expected biomarker search input.");
    }

    await typeIntoInput(rendered.window, input, "rheumatoid");

    expect(readResultLinks(rendered.container)).toEqual([
      "/biomarkers/results/rheumatoid-factor",
    ]);
    expect(rendered.container.querySelectorAll("details")).toHaveLength(1);
    expect(rendered.container.querySelector("details")?.hasAttribute("open")).toBe(true);
  } finally {
    await rendered.cleanup();
  }
});

test("biomarker detail study keeps the result and history concise", () => {
  const markup = renderToStaticMarkup(createElement(BiomarkerDetailStudy));

  expect(markup).toContain('data-design-study="biomarker-detail"');
  expect(markup).toContain("Hemoglobin");
  expect(markup).toContain(">18.0<");
  expect(markup).toContain("18.0 g/dL");
  expect(markup).toContain('href="#biomarker-index-study-heading"');
  expect(markup).toContain("Above range");
  expect(markup).not.toContain("Below range");
  expect(markup).toContain("Feb 17, 2026");
  expect(markup).toContain("Latest reading");
  expect(markup).toContain("Lab range");
  expect(markup).toContain("Results over time");
  expect(markup).not.toContain("Numeric history");
  expect(markup).not.toContain("A steady rise");
  expect(markup).not.toContain("exact results plotted");
  expect(markup).not.toContain("shaded band");
  expect(markup).not.toContain('aria-describedby="illustrative-biomarker-chart-caption"');
  expect(markup).toContain('aria-label="Illustrative hemoglobin results over time"');
  expect(markup).toContain('data-point-count="4"');
  expect(markup).toContain('data-low="13"');
  expect(markup).toContain('data-high="17"');
});

test("boundary result study keeps comparator data out of the numeric chart", () => {
  const markup = renderToStaticMarkup(createElement(BiomarkerBoundaryResultStudy));

  expect(markup).toContain('data-design-study="biomarker-boundary-result"');
  expect(markup).toContain("Rheumatoid Factor");
  expect(markup).toContain("&lt;10");
  expect(markup).not.toContain("Why there is no line chart");
  expect(markup).not.toContain("invented midpoint");
  expect(markup).toContain("Source range not listed");
  expect(markup).not.toContain('role="img"');
});

function getButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(label),
  );
  if (!button) {
    throw new Error(`Expected button containing ${label}.`);
  }
  return button;
}

async function click(
  window: Window & typeof globalThis,
  button: HTMLButtonElement,
): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}

async function typeIntoInput(
  window: Window & typeof globalThis,
  input: HTMLInputElement,
  value: string,
): Promise<void> {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    if (valueSetter) {
      valueSetter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

function readResultLinks(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLAnchorElement>('a[href^="/biomarkers/results/"]'),
    (link) => link.getAttribute("href") ?? "",
  );
}
