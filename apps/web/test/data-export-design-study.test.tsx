import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  study: "",
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(
    mocks.study ? `study=${mocks.study}` : "",
  ),
}));

import { DataExportFlowStudy } from "@/app/design/data-export-study";
import {
  HealthDataConsentControlStudy,
  HealthDataConsentWithdrawalFlowStudy,
} from "@/app/design/health-data-consent-study";

beforeEach(() => {
  mocks.study = "";
});

test("renders the retained-export error study from the production content", () => {
  mocks.study = "data-export-error";

  const markup = renderToStaticMarkup(createElement(DataExportFlowStudy));

  expect(markup).toContain("Export your data");
  expect(markup).toContain("retained dashboard export available yet");
  expect(markup).toContain("hosted-data-export-description");
});

test("renders the retained-export pending study from the production content", () => {
  mocks.study = "data-export-pending";

  const markup = renderToStaticMarkup(createElement(DataExportFlowStudy));

  expect(markup).toContain("Preparing...");
  expect(markup).toContain("disabled");
});

test("renders the retained-export ready study from the production content", () => {
  mocks.study = "data-export-ready";

  const markup = renderToStaticMarkup(createElement(DataExportFlowStudy));

  expect(markup).toContain("Download my data");
  expect(markup).toContain("flex flex-col items-stretch gap-6");
  expect(markup).toContain("max-w-md");
  expect(markup).not.toContain("Preparing...");
});

test("renders consent status retry states from the production control", () => {
  const markup = renderToStaticMarkup(
    createElement(HealthDataConsentControlStudy),
  );

  expect(markup).toContain("lg:col-span-2");
  expect(markup).toContain("Checking status...");
  expect(markup).toContain("Status is still unavailable. Try again.");
  expect(markup).toContain("text-destructive");
});

test("renders an interactive, settings-width withdrawal flow study", () => {
  mocks.study = "health-data-withdrawal";

  const markup = renderToStaticMarkup(
    createElement(HealthDataConsentWithdrawalFlowStudy),
  );

  expect(markup).toContain("Consent active");
  expect(markup).toContain("Withdraw consent");
  expect(markup).toContain("max-w-2xl");
  expect(markup).not.toContain("Use study=");
});

test("renders pending renewed consent from the production prompt", () => {
  mocks.study = "health-data-resume-pending";

  const markup = renderToStaticMarkup(
    createElement(HealthDataConsentWithdrawalFlowStudy),
  );

  expect(markup).toContain("Saving...");
  expect(markup).toContain("Use Murph again");
  expect(markup).toContain("sm:grid-cols-[auto_minmax(0,1fr)_auto]");
});
