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
  assert.doesNotMatch(markup, /Start an experiment/);
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


test.each(["active", "planned", "paused", "completed", "stopped"])(
  "Home omits %s experiment runs while preserving remaining setup",
  async (status) => {
    mocks.useBrowserVault.mockReturnValue({
      client: createClient([], [experimentEntity({
        id: "exp:sample-run",
        status,
        title: "Sample experiment run",
      })]),
      status: "ready",
    });
    const { BrowserVaultOnboardingStepsContent } = await import(
      "@/src/components/home/browser-vault-onboarding-steps"
    );
    const markup = renderToStaticMarkup(createElement(BrowserVaultOnboardingStepsContent));

    assert.match(markup, /Connect devices/);
    assert.match(markup, /Sync labs/);
    assert.doesNotMatch(markup, /Sample experiment run|In progress|Your history|Start an experiment|data-home-empty-state/);
  },
);

test("Home shows Message Murph after device and lab setup even with an active experiment", async () => {
  mocks.useBrowserVault.mockReturnValue({
    client: createClient([metricRow({
      biomarkerKey: "biomarker:hba1c",
      metricKey: "hba1c",
      sourceKind: "test-result",
      value: 5.3,
    })], [experimentEntity({ id: "exp:sample-run", status: "active", title: "Sample experiment run" })]),
    status: "ready",
  });
  const { BrowserVaultOnboardingStepsContent } = await import(
    "@/src/components/home/browser-vault-onboarding-steps"
  );
  const markup = renderToStaticMarkup(createElement(BrowserVaultOnboardingStepsContent, {
    showDeviceStep: false,
    emptyStateAction: createElement("button", null, "Message Murph"),
  }));

  assert.match(markup, /<button>Message Murph<\/button>/);
  assert.doesNotMatch(markup, /data-onboarding-step|Sample experiment run/);

  const awaitingMessage = renderToStaticMarkup(createElement(BrowserVaultOnboardingStepsContent, {
    showDeviceStep: false,
    emptyStateAction: createElement("button", null, "Message Murph"),
    messageMurphAction: createElement("button", null, "Message"),
  }));
  assert.match(awaitingMessage, /Murph can&#x27;t message you first/);
  assert.doesNotMatch(awaitingMessage, /data-home-empty-state/);
});

test.each(["loading", "error"])("Home does not show completed setup while vault is %s", async (status) => {
  mocks.useBrowserVault.mockReturnValue({ client: null, status, error: null });
  const { BrowserVaultOnboardingStepsContent } = await import(
    "@/src/components/home/browser-vault-onboarding-steps"
  );
  const markup = renderToStaticMarkup(createElement(BrowserVaultOnboardingStepsContent, {
    hideLabsStep: true,
    showDeviceStep: false,
    emptyStateAction: createElement("button", null, "Message Murph"),
  }));
  assert.doesNotMatch(markup, /data-home-empty-state/);
  if (status === "error") assert.match(markup, /Could not load your dashboard/);
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
    createElement(BrowserVaultOnboardingStepsContent),
  );

  assert.doesNotMatch(markup, /Start an experiment/);
  assert.match(markup, /Connect devices/);
});

test("BrowserVaultOnboardingStepsContent keeps setup cards for empty vault status", async () => {
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    status: "empty",
  });

  const { BrowserVaultOnboardingStepsContent } = await import(
    "@/src/components/home/browser-vault-onboarding-steps"
  );
  const markup = renderToStaticMarkup(
    createElement(BrowserVaultOnboardingStepsContent),
  );

  assert.doesNotMatch(markup, /Start an experiment/);
});

test("BrowserVaultOnboardingStepsContent replaces misleading data steps with a stable error", async () => {
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
      showDeviceStep: true,
    }),
    { requireButton: false },
  );

  assert.match(rendered.container.textContent ?? "", /Could not load your dashboard/u);
  assert.match(rendered.container.textContent ?? "", /Connect devices/u);
  assert.doesNotMatch(rendered.container.textContent ?? "", /Start an experiment/u);
  assert.doesNotMatch(rendered.container.textContent ?? "", /Sync labs/u);

  assert.equal(
    [...rendered.container.querySelectorAll("button")].some(
      (button) => button.textContent === "Retry",
    ),
    false,
  );
  assert.equal(refresh.mock.calls.length, 0);

  await rendered.cleanup();
});

test("OnboardingSteps offers Message Murph when every step is complete", async () => {
  const { OnboardingSteps } = await import("@/src/components/home/onboarding-steps");

  const markup = renderToStaticMarkup(createElement(OnboardingSteps, {
    hideLabsStep: true,
    showDeviceStep: false,
    emptyStateAction: createElement("button", null, "Message Murph"),
  }));

  assert.match(markup, /<button>Message Murph<\/button>/);
  assert.doesNotMatch(markup, /data-onboarding-step/);
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
