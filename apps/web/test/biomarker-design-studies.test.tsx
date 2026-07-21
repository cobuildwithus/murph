import {
  act,
  createElement,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
      displayName,
      points,
      referenceRange,
    }: {
      displayName: string;
      points: readonly unknown[];
      referenceRange: { high: number | null; low: number | null };
      unit: string | null;
    }): ReactNode {
      return React.createElement("div", {
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
  BiomarkerDetailStudy,
  BiomarkerIndexStudy,
} from "@/src/components/biomarkers/biomarker-design-studies";
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
  expect(sectionsMarkup).toContain('data-design-study="biomarker-index"');
  expect(sectionsMarkup).toContain('data-design-study="biomarker-detail"');

  navigationMocks.tab = "components";
  const componentsMarkup = renderToStaticMarkup(createElement(DesignPage));

  expect(componentsMarkup).toContain(">Components<");
  expect(componentsMarkup).not.toContain('data-design-study="biomarker-index"');
  expect(componentsMarkup).not.toContain('data-design-study="biomarker-detail"');
});

test("biomarker index study keeps status filters and native area disclosures explicit", () => {
  const markup = renderToStaticMarkup(createElement(BiomarkerIndexStudy));

  expect(markup).toContain('data-design-study="biomarker-index"');
  expect(markup).toContain("Biomarkers");
  expect(markup).not.toContain("Illustrative data");
  expect(markup).toContain('type="search"');
  expect(markup).toContain('placeholder="Search biomarkers"');
  expect(markup).toContain("Review");
  expect(markup).not.toContain("Out of range");
  expect(markup).toContain('aria-pressed="true"');
  expect(markup).not.toContain("From your devices");
  expect(markup).not.toContain("From saved lab results");
  expect(markup).not.toContain("Showing 7 of 7 saved lab biomarkers");
  expect(markup).not.toContain("2 to review");
  expect(markup).toContain("Above range");
  expect(markup).toContain("In range");
  expect(markup).not.toContain("4 results");
  expect(markup).not.toContain("Jan 1, 2026");
  expect(markup).toContain('href="/biomarkers/results/hemoglobin"');
  expect(markup).toContain('href="/biomarkers/results/mean-corpuscular-hemoglobin"');
  expect(markup).toContain("sm:flex-row");
  expect(markup).toContain("sm:max-w-[50%]");
  expect(markup).not.toContain("md:grid-cols-2");
  expect(markup.indexOf("Hemoglobin")).toBeLessThan(markup.indexOf("Mean corpuscular hemoglobin"));
  expect(markup.match(/<details/g)).toHaveLength(3);
  expect(markup.match(/<details[^>]*open=""/g) ?? []).toHaveLength(3);
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
      "/biomarkers/results/hemoglobin",
      "/biomarkers/results/hematocrit",
    ]);
    expect(rendered.container.querySelectorAll("details")).toHaveLength(1);
  } finally {
    await rendered.cleanup();
  }
});

test("biomarker detail study keeps the result and history concise", () => {
  const markup = renderToStaticMarkup(createElement(BiomarkerDetailStudy));

  expect(markup).toContain('data-design-study="biomarker-detail"');
  expect(markup).toContain("Hemoglobin");
  expect(markup).toContain("18.0");
  expect(markup).toContain("Above range");
  expect(markup).not.toContain("Below range");
  expect(markup).toContain("Jan 1, 2026");
  expect(markup).not.toContain("Latest result");
  expect(markup).not.toContain("Collected");
  expect(markup).not.toContain("Why it matters");
  expect(markup).not.toContain("Home");
  expect(markup).toContain('aria-label="Illustrative hemoglobin results over time"');
  expect(markup).toContain('data-point-count="4"');
  expect(markup).toContain('data-low="13"');
  expect(markup).toContain('data-high="17"');
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

function readResultLinks(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLAnchorElement>('a[href^="/biomarkers/results/"]'),
    (link) => link.getAttribute("href") ?? "",
  );
}
