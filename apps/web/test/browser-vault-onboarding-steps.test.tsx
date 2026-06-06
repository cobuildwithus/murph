import assert from "node:assert/strict";

import {
  cloneElement,
  createElement,
  isValidElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";
import type {
  BrowserVaultMetricRow,
  BrowserVaultQueryClient,
} from "@murphai/query/browser-biomarkers";
import type { BrowserVaultReplica } from "@murphai/query/browser-replica-client";
import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
} from "@murphai/query/browser-replica-client";

const mocks = vi.hoisted(() => ({
  useBrowserVault: vi.fn(),
}));

vi.mock("next/link", () => ({
  default(props: {
    children?: ReactNode;
    className?: string;
    href: string;
    "data-slot"?: string;
  }) {
    return createElement(
      "a",
      {
        className: props.className,
        "data-slot": props["data-slot"],
        href: props.href,
      },
      props.children,
    );
  },
}));

vi.mock("@/src/components/ui/auth-button", () => ({
  AuthButton(props: {
    children?: ReactNode;
    className?: string;
    render?: ReactNode;
  }) {
    if (isValidElement<{ children?: ReactNode; className?: string; "data-slot"?: string }>(props.render)) {
      return cloneElement(
        props.render,
        {
          className: props.className,
          "data-slot": "auth-button",
        },
        props.children,
      );
    }

    return createElement(
      "button",
      {
        className: props.className,
        "data-slot": "auth-button",
        type: "button",
      },
      props.children,
    );
  },
}));

vi.mock("@/src/lib/browser-vault/context", () => ({
  BrowserVaultProvider({ children }: { children: ReactNode }) {
    return createElement("section", { "data-browser-vault-provider": true }, children);
  },
  useBrowserVault: mocks.useBrowserVault,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    status: "empty",
  });
});

test("hasBrowserVaultLabBiomarkers only accepts lab test-result biomarker values", async () => {
  const { hasBrowserVaultLabBiomarkers } = await import(
    "@/src/components/home/browser-vault-onboarding-steps"
  );

  assert.equal(
    hasBrowserVaultLabBiomarkers(createClient([metricRow({
      biomarkerKey: "biomarker:hba1c",
      metricKey: "hba1c",
      sourceKind: "test-result",
      value: 5.3,
    })])),
    true,
  );
  assert.equal(
    hasBrowserVaultLabBiomarkers(createClient([metricRow({
      biomarkerKey: "biomarker:resting-heart-rate",
      metricKey: "resting-heart-rate",
      sourceKind: "wearable-summary",
      value: 58,
    })])),
    false,
  );
  assert.equal(
    hasBrowserVaultLabBiomarkers(createClient([metricRow({
      biomarkerKey: "biomarker:hba1c",
      metricKey: "hba1c",
      sourceKind: "test-result",
      value: null,
    })])),
    false,
  );
});

test("BrowserVaultOnboardingStepsContent hides labs after lab biomarkers are in browser vault", async () => {
  mocks.useBrowserVault.mockReturnValue({
    client: createClient([metricRow({
      biomarkerKey: "biomarker:hba1c",
      metricKey: "hba1c",
      sourceKind: "test-result",
      value: 5.3,
    })]),
    status: "ready",
  });

  const { BrowserVaultOnboardingStepsContent } = await import(
    "@/src/components/home/browser-vault-onboarding-steps"
  );
  const markup = renderToStaticMarkup(createElement(BrowserVaultOnboardingStepsContent));

  assert.match(markup, /Connect devices/);
  assert.doesNotMatch(markup, /Sync labs/);
  assert.match(markup, /Start an experiment/);
});

test("BrowserVaultOnboardingStepsContent keeps labs visible for wearable biomarker values", async () => {
  mocks.useBrowserVault.mockReturnValue({
    client: createClient([metricRow({
      biomarkerKey: "biomarker:resting-heart-rate",
      metricKey: "resting-heart-rate",
      sourceKind: "wearable-summary",
      value: 58,
    })]),
    status: "ready",
  });

  const { BrowserVaultOnboardingStepsContent } = await import(
    "@/src/components/home/browser-vault-onboarding-steps"
  );
  const markup = renderToStaticMarkup(createElement(BrowserVaultOnboardingStepsContent));

  assert.match(markup, /Sync labs/);
});

function createClient(metricRows: BrowserVaultMetricRow[]): Pick<BrowserVaultQueryClient, "replica"> {
  return {
    replica: {
      assistantSummary: {
        highlights: [],
        latestDate: null,
      },
      entities: [],
      generatedAt: "2026-06-06T12:00:00.000Z",
      metricGoalProgressRows: [],
      metricRows,
      metricSelectionRows: [],
      policy: {
        bodyPreviewChars: 280,
        excludedFamilies: [],
        id: BROWSER_VAULT_REPLICA_POLICY_ID,
        includedFamilies: [],
        metricLookbackDays: 365,
      },
      schema: BROWSER_VAULT_REPLICA_SCHEMA,
      searchRows: [],
      source: {
        dataVersion: "test-version",
        sourceBundleHash: "test-bundle",
      },
      sourceHealthRows: [],
      timelineRows: [],
      weeklySampleSummaries: [],
    } satisfies BrowserVaultReplica,
  };
}

function metricRow(input: {
  biomarkerKey: string | null;
  metricKey: string;
  sourceKind: string | null;
  value: number | null;
}): BrowserVaultMetricRow {
  return {
    biomarkerKey: input.biomarkerKey,
    confidence: "high",
    context: {},
    date: "2026-06-01",
    grain: "day",
    id: `metric-row:${input.metricKey}`,
    metricKey: input.metricKey,
    observedAt: "2026-06-01T12:00:00.000Z",
    pointIds: [`point:${input.metricKey}`],
    recordIds: [`record:${input.metricKey}`],
    rowSchema: "murph.browser-vault.metric-row.v1",
    sourceFamily: input.sourceKind === "test-result" ? "event" : "derived",
    sourceKind: input.sourceKind,
    sourceLabel: input.sourceKind === "test-result" ? "Lab report" : "Wearable summary",
    statistic: "value",
    unit: null,
    value: input.value,
    valueLabel: input.value === null ? null : String(input.value),
  };
}
