import assert from "node:assert/strict";

import {
  act,
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
import type {
  BrowserVaultEntity,
  BrowserVaultReplica,
} from "@murphai/query/browser-replica-client";
import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  BROWSER_VAULT_EXPERIMENT_RUN_CARD_SCHEMA,
  createBrowserVaultQueryClient,
} from "@murphai/query/browser-replica-client";

import type { ExperimentLibraryCard } from "@/src/lib/experiments/library-cards";
import type { ExperimentProtocol } from "@/src/types/experiments";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  useBrowserVault: vi.fn(),
}));

vi.mock("next/image", () => ({
  default(props: { alt?: string; className?: string; src: string }) {
    return createElement("img", {
      alt: props.alt ?? "",
      className: props.className,
      src: props.src,
    });
  },
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


test("BrowserVaultOnboardingStepsContent shows in-progress runs and hides the experiment step", async () => {
  mocks.useBrowserVault.mockReturnValue({
    client: createClient([], [experimentEntity({
      id: "exp:red-light-glasses",
      status: "active",
      title: "Red light glasses",
    })]),
    status: "ready",
  });

  const { BrowserVaultOnboardingStepsContent } = await import(
    "@/src/components/home/browser-vault-onboarding-steps"
  );
  const markup = renderToStaticMarkup(
    createElement(BrowserVaultOnboardingStepsContent, { protocols: [] }),
  );

  assert.match(markup, /In progress/);
  assert.match(markup, /Red light glasses/);
  assert.match(markup, /href="\/experiments\/runs\/exp%3Ared-light-glasses"/);
  assert.match(markup, /Collecting data/);
  assert.doesNotMatch(markup, /99%/);
  assert.doesNotMatch(markup, /Start an experiment/);
});

test("BrowserVaultOnboardingStepsContent treats tracked-only planned runs as in progress", async () => {
  mocks.useBrowserVault.mockReturnValue({
    client: createClient([], [experimentEntity({
      id: "exp:private-plan",
      status: "planned",
      title: "Private planned run",
    })]),
    status: "ready",
  });

  const { BrowserVaultOnboardingStepsContent } = await import(
    "@/src/components/home/browser-vault-onboarding-steps"
  );
  const markup = renderToStaticMarkup(
    createElement(BrowserVaultOnboardingStepsContent, { protocols: [] }),
  );

  assert.match(markup, /In progress/);
  assert.match(markup, /Private planned run/);
  assert.doesNotMatch(markup, /Your history/);
  assert.doesNotMatch(markup, /Start an experiment/);
});

test("BrowserVaultOnboardingStepsContent hides the experiment step and shows history for finished runs", async () => {
  mocks.useBrowserVault.mockReturnValue({
    client: createClient([], [experimentEntity({
      id: "exp:finnish-sauna",
      status: "completed",
      title: "Finnish sauna",
    })]),
    status: "ready",
  });

  const { BrowserVaultOnboardingStepsContent } = await import(
    "@/src/components/home/browser-vault-onboarding-steps"
  );
  const markup = renderToStaticMarkup(
    createElement(BrowserVaultOnboardingStepsContent, { protocols: [] }),
  );

  assert.match(markup, /Your history/);
  assert.match(markup, /Finnish sauna/);
  assert.doesNotMatch(markup, /Start an experiment/);
});

test("BrowserVaultOnboardingStepsContent keeps ambiguous tracked-only statuses in history and hides the experiment step", async () => {
  mocks.useBrowserVault.mockReturnValue({
    client: createClient([], [experimentEntity({
      id: "exp:private-ambiguous",
      status: "waiting-for-review",
      title: "Ambiguous private run",
    })]),
    status: "ready",
  });

  const { BrowserVaultOnboardingStepsContent } = await import(
    "@/src/components/home/browser-vault-onboarding-steps"
  );
  const markup = renderToStaticMarkup(
    createElement(BrowserVaultOnboardingStepsContent, { protocols: [] }),
  );

  assert.match(markup, /Your history/);
  assert.match(markup, /Ambiguous private run/);
  assert.doesNotMatch(markup, /In progress/);
  assert.doesNotMatch(markup, /Start an experiment/);
});

test("BrowserVaultOnboardingStepsContent shows a protocol-matched active run as the protocol card", async () => {
  // Resolving a protocol-matched private run needs a real query client, not just the replica.
  mocks.useBrowserVault.mockReturnValue({
    client: createBrowserVaultQueryClient(createClient([], [experimentEntity({
      id: "exp:sauna-run",
      slug: "sauna-protocol",
      status: "active",
      title: "My sauna run",
    })]).replica),
    status: "ready",
  });

  const { BrowserVaultOnboardingStepsContent } = await import(
    "@/src/components/home/browser-vault-onboarding-steps"
  );
  const markup = renderToStaticMarkup(
    createElement(BrowserVaultOnboardingStepsContent, { protocols: [createProtocol()] }),
  );

  assert.match(markup, /In progress/);
  assert.match(markup, /Finnish Dry Sauna/);
  assert.match(markup, /href="\/experiments\/sauna-protocol"/);
  assert.match(markup, /Private data/);
  // The matched run must not also render as a separate tracked-only card.
  assert.doesNotMatch(markup, /Private only/);
  assert.doesNotMatch(markup, /Start an experiment/);
});

test("BrowserVaultOnboardingStepsContent shows a protocol-matched finished run in history and hides the experiment step", async () => {
  // Resolving a protocol-matched private run needs a real query client, not just the replica.
  mocks.useBrowserVault.mockReturnValue({
    client: createBrowserVaultQueryClient(createClient([], [experimentEntity({
      id: "exp:sauna-run",
      slug: "sauna-protocol",
      status: "completed",
      title: "My sauna run",
    })]).replica),
    status: "ready",
  });

  const { BrowserVaultOnboardingStepsContent } = await import(
    "@/src/components/home/browser-vault-onboarding-steps"
  );
  const markup = renderToStaticMarkup(
    createElement(BrowserVaultOnboardingStepsContent, { protocols: [createProtocol()] }),
  );

  assert.match(markup, /Your history/);
  assert.match(markup, /Finnish Dry Sauna/);
  assert.match(markup, /href="\/experiments\/sauna-protocol"/);
  assert.match(markup, /Private data/);
  assert.doesNotMatch(markup, /In progress/);
  assert.doesNotMatch(markup, /Private only/);
  assert.doesNotMatch(markup, /Start an experiment/);
});

test("BrowserVaultOnboardingStepsContent caps history at the six most recent runs", async () => {
  // Distinct start dates, oldest letter first: A=2026-01-01 ... G=2026-01-07.
  mocks.useBrowserVault.mockReturnValue({
    client: createClient([], ["A", "B", "C", "D", "E", "F", "G"].map((letter, index) =>
      experimentEntity({
        date: `2026-01-0${index + 1}`,
        id: `exp:history-${letter}`,
        status: "completed",
        title: `History run ${letter}`,
      })
    )),
    status: "ready",
  });

  const { BrowserVaultOnboardingStepsContent } = await import(
    "@/src/components/home/browser-vault-onboarding-steps"
  );
  const markup = renderToStaticMarkup(
    createElement(BrowserVaultOnboardingStepsContent, { protocols: [] }),
  );

  assert.match(markup, /Your history/);
  // The newest run is kept and the oldest is the one the cap drops.
  assert.match(markup, /History run G/);
  assert.doesNotMatch(markup, /History run A/);
});

test("BrowserVaultOnboardingStepsContent hides the experiment step while the vault is loading", async () => {
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    status: "loading",
  });

  const { BrowserVaultOnboardingStepsContent } = await import(
    "@/src/components/home/browser-vault-onboarding-steps"
  );
  const markup = renderToStaticMarkup(
    createElement(BrowserVaultOnboardingStepsContent, { protocols: [] }),
  );

  assert.doesNotMatch(markup, /Start an experiment/);
  assert.match(markup, /Connect devices/);
});

test("BrowserVaultOnboardingStepsContent keeps the experiment step for empty vault status", async () => {
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    status: "empty",
  });

  const { BrowserVaultOnboardingStepsContent } = await import(
    "@/src/components/home/browser-vault-onboarding-steps"
  );
  const markup = renderToStaticMarkup(
    createElement(BrowserVaultOnboardingStepsContent, { protocols: [] }),
  );

  assert.match(markup, /Start an experiment/);
});

test("BrowserVaultOnboardingStepsContent replaces misleading data steps with a retryable error", async () => {
  const refresh = vi.fn();
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    error: "Your dashboard data is not available right now.",
    refresh,
    status: "error",
  });

  const { BrowserVaultOnboardingStepsContent } = await import(
    "@/src/components/home/browser-vault-onboarding-steps"
  );
  const rendered = await renderClientComponent(
    createElement(BrowserVaultOnboardingStepsContent, {
      protocols: [],
      showDeviceStep: true,
    }),
    { requireButton: false },
  );

  assert.match(rendered.container.textContent ?? "", /Could not load your dashboard/u);
  assert.match(rendered.container.textContent ?? "", /Connect devices/u);
  assert.doesNotMatch(rendered.container.textContent ?? "", /Start an experiment/u);
  assert.doesNotMatch(rendered.container.textContent ?? "", /Sync labs/u);

  const retry = [...rendered.container.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry",
  );
  assert.ok(retry);
  await act(async () => {
    retry.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });
  assert.equal(refresh.mock.calls.length, 1);

  await rendered.cleanup();
});

test("OnboardingSteps renders nothing when every step is hidden", async () => {
  const { OnboardingSteps } = await import("@/src/components/home/onboarding-steps");

  const markup = renderToStaticMarkup(createElement(OnboardingSteps, {
    hideExperimentStep: true,
    hideLabsStep: true,
    showDeviceStep: false,
  }));

  assert.equal(markup, "");
});

test("splitHomeExperimentCards keeps only the member's runs and splits by run status", async () => {
  const { splitHomeExperimentCards } = await import(
    "@/src/lib/experiments/library-cards"
  );

  const { history, inProgress } = splitHomeExperimentCards([
    libraryCard({ hasPrivateData: false, id: "protocol-only" }),
    libraryCard({ hasPrivateData: true, id: "active-run", runStatus: "active" }),
    libraryCard({ hasPrivateData: true, id: "paused-run", runStatus: "paused" }),
    libraryCard({ hasPrivateData: true, id: "finished-run", runStatus: "finished" }),
    libraryCard({ hasPrivateData: true, id: "stopped-run", runStatus: "stopped" }),
  ]);

  assert.deepEqual(inProgress.map((card) => card.id), ["active-run", "paused-run"]);
  assert.deepEqual(history.map((card) => card.id), ["finished-run", "stopped-run"]);
});

test("splitHomeExperimentCards orders history most recent first with non-dates last", async () => {
  const { splitHomeExperimentCards } = await import(
    "@/src/lib/experiments/library-cards"
  );

  const { history } = splitHomeExperimentCards([
    libraryCard({ hasPrivateData: true, id: "old-run", runStatus: "finished", startedOn: "2026-01-05" }),
    libraryCard({ hasPrivateData: true, id: "undated-run", runStatus: "finished", startedOn: "Undated" }),
    libraryCard({ hasPrivateData: true, id: "new-run", runStatus: "finished", startedOn: "2026-06-01" }),
  ]);

  assert.deepEqual(history.map((card) => card.id), ["new-run", "old-run", "undated-run"]);
});

test("BrowserVaultOnboardingStepsContent without protocols never renders experiment sections", async () => {
  mocks.useBrowserVault.mockReturnValue({
    client: createClient([], [experimentEntity({
      id: "exp:red-light-glasses",
      status: "active",
      title: "Red light glasses",
    })]),
    status: "ready",
  });

  const { BrowserVaultOnboardingStepsContent } = await import(
    "@/src/components/home/browser-vault-onboarding-steps"
  );
  const markup = renderToStaticMarkup(createElement(BrowserVaultOnboardingStepsContent));

  assert.doesNotMatch(markup, /In progress/);
  assert.match(markup, /Start an experiment/);
});

function createClient(
  metricRows: BrowserVaultMetricRow[],
  entities: BrowserVaultEntity[] = [],
): BrowserVaultQueryClient {
  return createBrowserVaultQueryClient({
      assistantSummary: {
        highlights: [],
        latestDate: null,
      },
      entities,
      experimentRunCards: entities
        .filter((entity) => entity.family === "experiment")
        .map((entity) => {
          const status = entity.status === "paused"
            ? "paused" as const
            : entity.status === "active" || entity.status === "planned"
              ? "active" as const
              : entity.status === "closed" || entity.status === "stopped"
                ? "stopped" as const
                : "finished" as const;
          return {
            id: entity.id,
            lookupKeys: {
              experimentIds: [entity.id, ...entity.lookupIds],
              protocolKeys: [],
              slugs: [entity.experimentSlug, ...entity.lookupIds]
                .filter((value): value is string => value !== null),
            },
            runSummary: { metrics: [] },
            requiredMetricBuckets: [],
            schema: BROWSER_VAULT_EXPERIMENT_RUN_CARD_SCHEMA,
            slug: entity.experimentSlug,
            startedOn: entity.date,
            status,
            statusLabel: status === "finished" ? "Completed" : status === "paused" ? "Paused" : "Active",
            summary: null,
            summaryDetail: null,
            tags: entity.tags,
            title: entity.title ?? entity.id,
          };
        }),
      generatedAt: "2026-06-06T12:00:00.000Z",
      hasLabBiomarkers: metricRows.some((row) =>
        row.sourceKind === "test-result" && row.biomarkerKey !== null && row.value !== null
      ),
      labResultRows: [],
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
    } satisfies BrowserVaultReplica);
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

function experimentEntity(input: {
  date?: string;
  id: string;
  slug?: string;
  status: string;
  title: string;
}): BrowserVaultEntity {
  return {
    attributes: {},
    bodyPreview: null,
    date: input.date ?? "2026-06-01",
    experimentSlug: input.slug ?? input.id,
    family: "experiment",
    id: input.id,
    kind: "experiment",
    links: [],
    lookupIds: [input.id, ...(input.slug ? [input.slug] : [])],
    occurredAt: "2026-06-01T12:00:00.000Z",
    recordClass: "ledger",
    status: input.status,
    stream: null,
    tags: [],
    title: input.title,
  };
}

function libraryCard(input: {
  hasPrivateData: boolean;
  id: string;
  runStatus?: ExperimentLibraryCard["runStatus"];
  startedOn?: string | null;
}): ExperimentLibraryCard {
  return {
    category: "Recovery",
    description: "Test card.",
    hasPrivateData: input.hasPrivateData,
    href: null,
    id: input.id,
    image: "/design-assets/hero-sauna.png",
    runStatus: input.runStatus,
    searchText: input.id,
    startedOn: input.startedOn,
    title: input.id,
  };
}

function createProtocol(): ExperimentProtocol {
  return {
    baselineDays: 7,
    category: "Recovery",
    description: "Simple heat exposure experiment.",
    durationDays: 21,
    evidenceLabel: "Field testing · Usable",
    evidenceLevel: 3,
    expectedSignals: [],
    experts: [],
    id: "sauna-protocol",
    image: "/design-assets/hero-sauna.png",
    measurementPaths: [],
    mechanismChain: [],
    protocol: [],
    protocolContractVersion: 1,
    protocolFacts: [],
    protocolKeepInMind: [],
    protocolLogFields: [],
    protocolTips: [],
    researchStats: [],
    researchSummaryLabel: "81 studies",
    safety: {
      cautionLevel: 3,
      precautions: [],
      whoShouldAvoid: [],
    },
    studies: [],
    studyCount: 81,
    title: "Finnish Dry Sauna",
    whyItWorks: "Heat load can act as a stressor.",
  };
}
