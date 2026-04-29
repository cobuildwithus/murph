import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

import type { BrowserVaultContextValue } from "@/src/lib/browser-vault/context";
import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";

type ResultsTabMockProps = {
  experiment: { privateRun?: unknown };
  onPrivateRunRetry?: () => unknown;
  privateRunError: string | null;
  privateRunStatus: string;
};

type ResolvePrivateRunInput = {
  client: BrowserVaultContextValue["client"];
  protocol: unknown;
};

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  resolveBrowserVaultExperimentRun: vi.fn((input: ResolvePrivateRunInput) => {
    void input;
    return null;
  }),
  resultsTab: vi.fn((props: ResultsTabMockProps) =>
    createElement(
      "div",
      null,
      `${props.privateRunStatus}|${props.privateRunError ?? "no-error"}|${props.experiment.privateRun ? "private" : "no-private"}`,
    )
  ),
  searchParamsGet: vi.fn((key: string) => key === "mock" ? "finished" : null),
  useBrowserVault: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: mocks.searchParamsGet,
  }),
}));

vi.mock("@/src/components/experiments/experiment-detail/results-tab", () => ({
  ResultsTab: mocks.resultsTab,
}));

vi.mock("@/src/lib/browser-vault/context", () => ({
  useBrowserVault: mocks.useBrowserVault,
}));

vi.mock("@/src/lib/browser-vault/experiment-run", () => ({
  resolveBrowserVaultExperimentRun: mocks.resolveBrowserVaultExperimentRun,
}));

import { ResultsTabClient } from "../app/(dashboard)/experiments/[experimentId]/results/results-tab-client";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    dataVersion: null,
    error: "Browser vault failed",
    ref: null,
    refresh: mocks.refresh,
    status: "error",
  } satisfies BrowserVaultContextValue);
});

test("production Results ignores mock query params and preserves browser-vault state", () => {
  const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

  assert.ok(protocol);

  const markup = renderToStaticMarkup(
    createElement(ResultsTabClient, {
      protocol,
    }),
  );

  assert.equal(markup, "<div>error|Browser vault failed|no-private</div>");
  assert.equal(mocks.searchParamsGet.mock.calls.length, 0);
  assert.equal(mocks.resultsTab.mock.calls[0]?.[0]?.privateRunStatus, "error");
  assert.equal(mocks.resultsTab.mock.calls[0]?.[0]?.privateRunError, "Browser vault failed");
  assert.equal(mocks.resultsTab.mock.calls[0]?.[0]?.onPrivateRunRetry, mocks.refresh);
  assert.equal(mocks.resolveBrowserVaultExperimentRun.mock.calls[0]?.[0]?.client, null);
});
