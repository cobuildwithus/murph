import { readFileSync } from "node:fs";
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
}));

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();

  return {
    ...actual,
    useRouter: () => ({ replace: navigationMocks.replace }),
    useSearchParams: () => new URLSearchParams(),
  };
});

vi.mock("next/link", async () => {
  const React = await import("react");

  return {
    default({
      prefetch,
      replace,
      scroll,
      ...props
    }: ComponentPropsWithoutRef<"a"> & {
      prefetch?: boolean;
      replace?: boolean;
      scroll?: boolean;
    }) {
      void prefetch;
      void replace;
      void scroll;
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
      referenceRangeLabel,
      referenceRangeSourceLabel,
      referenceRangeTitle = "Latest lab range",
    }: {
      ariaDescribedBy?: string;
      displayName: string;
      points: readonly unknown[];
      referenceRange: { high: number | null; low: number | null };
      referenceRangeLabel?: string | null;
      referenceRangeSourceLabel?: string | null;
      referenceRangeTitle?: string;
      unit: string | null;
    }): ReactNode {
      return React.createElement("div", {
        "aria-describedby": ariaDescribedBy,
        "aria-label": `${displayName} results over time; ${referenceRangeTitle.toLowerCase()} ${referenceRangeLabel}${referenceRangeSourceLabel ? ` from ${referenceRangeSourceLabel}` : ""}`,
        "data-high": referenceRange.high,
        "data-low": referenceRange.low,
        "data-point-count": points.length,
        "data-reference-range-label": referenceRangeLabel,
        role: "img",
      });
    },
  };
});

import {
  BiomarkerBoundaryResultStudy,
  BiomarkerDetailStudy,
  BiomarkerIndexStudy,
  BiomarkerPreparingStateStudy,
  BiomarkerReferenceContextStudy,
} from "@/src/components/biomarkers/biomarker-design-studies";
import {
  BIOMARKER_DEVICE_STUDIES,
  BIOMARKER_STUDY_GROUPS,
} from "@/src/components/biomarkers/biomarker-design-data";
import { DesignPage } from "@/app/design/design-page";
import DesignRoute from "@/app/design/page";

beforeEach(() => {
  navigationMocks.replace.mockReset();
});

test("design page routes the biomarker studies through the dedicated sections tab", () => {
  const sectionsMarkup = renderToStaticMarkup(
    createElement(DesignPage, { activeTab: "sections" }),
  );

  expect(sectionsMarkup).toContain(">Sections<");
  expect(sectionsMarkup).toContain('data-design-section="catalog-navigation"');
  expect(sectionsMarkup).toContain("Homepage security and privacy");
  expect(sectionsMarkup).toContain("Consumer Health Data Privacy Notice");
  expect(sectionsMarkup).toContain(
    'href="/consumer-health-data-privacy-policy"',
  );
  expect(sectionsMarkup).toContain("Homepage experiment flow");
  expect(sectionsMarkup).toContain("Homepage personas");
  expect(sectionsMarkup).toContain("Homepage footer");
  expect(sectionsMarkup).toContain('data-design-section="homepage-footer"');
  expect(sectionsMarkup).toContain("Changelog archive with explanatory visuals");
  expect(sectionsMarkup).toContain('data-design-study="changelog-archive"');
  expect(sectionsMarkup).toContain("A week that closes its own loops");
  expect(sectionsMarkup.match(/Illustrative examples\./g)).toHaveLength(2);
  expect(sectionsMarkup).toContain("Biomarker preparing state");
  expect(sectionsMarkup).toContain("Biomarker index");
  expect(sectionsMarkup).toContain(
    "Group sponsorship with optional creative response",
  );
  expect(sectionsMarkup).toContain(
    "Overall AI usage, referral-link sharing, purchase reset, Family owner action, credits, and referrals",
  );
  expect(sectionsMarkup).toContain(
    "Reusable signup referral link, shared authentication, recipient claim, and signed-in recovery states",
  );
  expect(sectionsMarkup).toMatch(
    /<[^>]*(?=[^>]*\bdata-design-contract="origin-only-referral-claim")(?=[^>]*\bdata-design-section="signup-referral-flow")[^>]*>/,
  );
  expect(sectionsMarkup).toContain("Settings · Messaging");
  expect(sectionsMarkup).toContain("Recipient landing states");
  expect(sectionsMarkup).toContain("Meet Murph");
  expect(sectionsMarkup).toContain("Try again soon");
  expect(sectionsMarkup).toContain("This link isn’t available");
  expect(sectionsMarkup).toContain("Biomarker result detail");
  expect(sectionsMarkup).toContain("Biomarker reference context");
  expect(sectionsMarkup).toContain(
    "Biomarker boundary result · published comparator provenance",
  );
  expect(sectionsMarkup).toContain('data-design-study="biomarker-preparing"');
  expect(sectionsMarkup).toContain('data-design-study="biomarker-index"');
  expect(sectionsMarkup).toContain('data-design-study="biomarker-detail"');
  expect(sectionsMarkup).toContain('data-design-study="biomarker-boundary-result"');
  expect(sectionsMarkup).toContain('data-design-study="group-usage-funding"');
  expect(sectionsMarkup).toContain("Sunday sleep crew");
  expect(sectionsMarkup).toContain("Support Murph in Sunday sleep crew");
  expect(sectionsMarkup).not.toContain("Keep Murph going");
  expect(sectionsMarkup).toContain("Sponsor this chat");
  expect(sectionsMarkup).toContain('data-design-state="monthly-activation"');
  expect(sectionsMarkup).toContain('data-design-state="ordinary-sponsored-one-time"');
  expect(sectionsMarkup).toContain('id="group-one-time-contribution"');
  expect(sectionsMarkup).toContain('data-design-state="monthly-active"');
  expect(sectionsMarkup).toContain('data-design-state="monthly-paused"');
  expect(sectionsMarkup).toContain('data-design-state="monthly-recovery"');
  expect(sectionsMarkup).toContain('data-design-state="sponsored-one-time-recovery"');
  expect(sectionsMarkup).toContain("Monthly sponsorship is the primary flow");
  expect(sectionsMarkup).toContain("One-time contribution");
  expect(sectionsMarkup).toContain("personal-usage-credit-owner");
  expect(sectionsMarkup).toContain("Pulse AI usage");
  expect(sectionsMarkup).toContain("Static owner-layout preview");
  expect(sectionsMarkup).toContain("Overall usage active");
  expect(sectionsMarkup).toContain("Plan usage exhausted, credit remains");
  expect(sectionsMarkup).toContain("Fresh purchase starts at zero used");
  expect(sectionsMarkup).toContain("All available usage exhausted");
  expect(sectionsMarkup).toContain(
    "Family owner can add usage for their own seat",
  );
  expect(sectionsMarkup).toContain("76% used");
  expect(sectionsMarkup).toContain("24% remaining");
  expect(sectionsMarkup).toContain("0% used");
  expect(sectionsMarkup).toContain("Fulfilled top-up with refreshed usage");
  expect(sectionsMarkup).toContain("Preview fulfilled top-up");
  expect(sectionsMarkup).toContain("Add usage to continue");
  expect(sectionsMarkup).not.toContain("$8.42");
  expect(sectionsMarkup).not.toContain("remaining usage credit");
  expect(sectionsMarkup).not.toContain("usage credit remaining");
  expect(sectionsMarkup).toContain("inert=\"\"");
  expect(sectionsMarkup).toContain("max-w-7xl");

  const componentsMarkup = renderToStaticMarkup(
    createElement(DesignPage, { activeTab: "components" }),
  );

  expect(componentsMarkup).toContain(">Components<");
  expect(componentsMarkup).toContain("WHOOP Completion Dialog");
  expect(componentsMarkup).toContain("Preview WHOOP completion");
  expect(componentsMarkup).toContain("Preview capacity fallback");
  expect(componentsMarkup).toContain("Preview capacity fallback without contact route");
  expect(componentsMarkup).not.toContain('data-design-study="biomarker-preparing"');
  expect(componentsMarkup).not.toContain('data-design-study="biomarker-index"');
  expect(componentsMarkup).not.toContain('data-design-study="biomarker-detail"');
  expect(componentsMarkup).not.toContain('data-design-study="biomarker-boundary-result"');
  expect(componentsMarkup).toContain('data-design-component="group-usage-funding"');
  expect(componentsMarkup).toContain(
    'data-design-component="signup-referral-link-states"',
  );
  expect(componentsMarkup).toContain("Clipboard write failed");
  expect(componentsMarkup).toContain(
    'data-design-component="group-sponsorship-management"',
  );
  expect(componentsMarkup).toContain("This month");
  expect(componentsMarkup).toContain("Monthly limit");
  expect(componentsMarkup).toContain("Sunday sleep crew");
  expect(componentsMarkup).toContain("Support Murph in Sunday sleep crew");
  expect(componentsMarkup).not.toContain("Keep Murph going");
  expect(componentsMarkup).toContain("Sponsor this chat");
  expect(componentsMarkup).toMatch(
    /data-slot="radio-group-item"[^>]*class="[^"]*sr-only/u,
  );
  expect(componentsMarkup).toContain(
    "group-has-data-checked/choice-card:text-primary-foreground",
  );
  expect(componentsMarkup).toContain("max-w-5xl");
  expect(componentsMarkup).not.toContain("max-w-7xl");

  const designPageSource = readFileSync(
    new URL("../app/design/design-page.tsx", import.meta.url),
    "utf8",
  );
  expect(designPageSource).not.toContain('"use client"');
  expect(designPageSource).not.toContain("useSearchParams");
  expect(designPageSource).toContain('import Link from "next/link"');

  for (const clientStudy of [
    "environment-progress-study.tsx",
    "experiment-results-share-study.tsx",
    "homepage-auth-warm-runtime-study.tsx",
    "settings-custom-inference-study.tsx",
  ]) {
    const clientStudySource = readFileSync(
      new URL(`../app/design/${clientStudy}`, import.meta.url),
      "utf8",
    );
    expect(clientStudySource).toMatch(/^"use client";/u);
  }

  const groupFundingStudySource = readFileSync(
    new URL("../app/design/group-usage-funding-study.tsx", import.meta.url),
    "utf8",
  );
  expect(groupFundingStudySource.match(/\binitialOpen\b/gu)).toHaveLength(1);
  expect(groupFundingStudySource).toContain(
    "<GroupSponsorshipManagementCard",
  );
  expect(groupFundingStudySource).toContain(
    'mode="one_time"',
  );
});

test("design sections keep the route footer as the sole canonical footer target", async () => {
  const route = await DesignRoute({
    searchParams: Promise.resolve({ tab: "sections" }),
  });
  const routeMarkup = renderToStaticMarkup(route);

  expect(routeMarkup.match(/id="site-footer"/g)).toHaveLength(1);
  expect(routeMarkup).toContain('id="design-site-footer-preview"');
  expect(routeMarkup).toContain('data-design-section="homepage-footer"');
  expect(routeMarkup).toContain("inert=");
});

test("biomarker preparing study reassures members and previews the index structure", () => {
  const markup = renderToStaticMarkup(createElement(BiomarkerPreparingStateStudy));

  expect(markup).toContain('data-design-study="biomarker-preparing"');
  expect(markup).toContain("Murph is organizing your health records.");
  expect(markup).toContain("This page will update when your biomarkers are ready.");
  expect(markup).not.toContain("one history");
  expect(markup).toContain("Updating your biomarkers");
  expect(markup).toContain('aria-live="polite"');
  expect(markup).toContain('role="status"');
  expect(markup).toContain("What appears next");
  expect(markup).toContain("From your devices");
  expect(markup).toContain("From the lab");
  expect(markup).toContain(">Biomarkers<");
  expect(markup).not.toContain("Future results update the same index");
  expect(markup).toContain("motion-reduce:animate-none");
  expect(markup).toContain("lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)]");
  expect(markup).not.toContain("Preparing your lab history");
  expect(markup).not.toContain("rounded-xl");
  expect(markup).not.toContain("shadow");
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
  expect(markup).toContain('class="flex items-baseline justify-between gap-4 border-b border-border/70 py-4"');
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
  expect(markup).toContain("border-y border-border/70");
  expect(markup).toContain("h-12 w-1 shrink-0 rounded-full");
  expect(markup).not.toContain("h-8 w-1 shrink-0 rounded-full");
  expect(markup).toContain("overflow-hidden rounded-xl border border-border/70 bg-card/70");
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
    const study = rendered.container.querySelector('[data-design-study="biomarker-index"]');
    expect(study).not.toBeNull();
    const studyClassTokens = study?.className.split(/\s+/u) ?? [];
    expect(studyClassTokens).not.toContain("rounded-xl");
    expect(studyClassTokens).not.toContain("border");
    expect(studyClassTokens).not.toContain("bg-card/70");

    const deviceSection = rendered.container.querySelector(
      'section[aria-labelledby="device-study-heading"]',
    );
    const deviceSectionClassTokens = deviceSection?.className.split(/\s+/u) ?? [];
    expect(deviceSectionClassTokens).toContain("border-y");
    expect(deviceSectionClassTokens).not.toContain("rounded-xl");
    expect(deviceSectionClassTokens).not.toContain("bg-card/70");

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
  expect(markup).not.toContain("<dl");
  expect(markup).not.toContain(">Lab range</dt>");
  expect(markup).not.toContain("4 comparable results");
  expect(markup).toContain("Example laboratory");
  expect(markup).not.toContain("Results over time");
  expect(markup).not.toContain("Numeric history");
  expect(markup).not.toContain("A steady rise");
  expect(markup).not.toContain("exact results plotted");
  expect(markup).not.toContain("shaded band");
  expect(markup).not.toContain('aria-describedby="illustrative-biomarker-chart-caption"');
  expect(markup).toContain(
    'aria-label="Illustrative hemoglobin results over time; latest lab range 13.0 to 17.0 g/dL from Example laboratory"',
  );
  expect(markup).toContain('data-reference-range-label="13.0 to 17.0 g/dL"');
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
  expect(markup).toContain("Published comparator — not the reporting lab&#x27;s range");
  expect(markup).not.toContain('role="img"');
});

test("reference context study covers an exact source limit and published comparator", () => {
  const markup = renderToStaticMarkup(createElement(BiomarkerReferenceContextStudy));

  expect(markup).toContain('data-design-study="biomarker-reference-context"');
  expect(markup).toContain("latest lab range");
  expect(markup).toContain("&lt;5.7%");
  expect(markup).toContain("published adult comparator");
  expect(markup).toContain("98 to 107 mmol/L");
  expect(markup).toContain("Mayo Clinic Laboratories adult serum reference interval");
  expect(markup).toContain("not the reporting lab&#x27;s range");
  expect(markup).not.toContain("Results over time");
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
