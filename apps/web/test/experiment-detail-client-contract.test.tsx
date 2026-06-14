import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION } from "@/src/lib/experiments/experiment-detail";
import type {
  ExperimentResultsPublicProjection,
  ExperimentShellProjection,
} from "@/src/lib/health-commons/experiment-projections";
import type { BrowserVaultContextValue } from "@/src/lib/browser-vault/context";
import type {
  ExperimentProtocol,
  ExperimentRunProjection,
} from "@/src/types/experiments";

const mocks = vi.hoisted(() => ({
  experimentHeader: vi.fn(() => createElement("div", null, "header")),
  experimentHero: vi.fn(() => createElement("div", null, "hero")),
  getHostedPageAuthSnapshot: vi.fn(),
  getPrisma: vi.fn(() => ({ prisma: true })),
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
  protocolTab: vi.fn(() => createElement("div", null, "protocol tab")),
  readHostedAccountSettingsSnapshot: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  refresh: vi.fn(),
  resolveBrowserVaultExperimentRun: vi.fn<() => ExperimentRunProjection | null>(() => null),
  resultsTab: vi.fn(() => createElement("div", null, "results tab")),
  useBrowserVault: vi.fn<() => BrowserVaultContextValue>(() => ({
    client: null,
    dataVersion: null,
    deviceSyncImportPending: false,
    error: null,
    freshness: "fresh",
    ref: null,
    refreshPending: false,
    refresh: vi.fn(async () => {}),
    status: "ready",
    workspaceVersion: null,
  })),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  useRouter: () => ({
    refresh: mocks.refresh,
  }),
  usePathname: () => "/experiments/finnish-sauna",
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement("a", { href }, children),
}));

vi.mock("@/src/components/ui/tabs", () => ({
  Tabs({ children }: { children: ReactNode }) {
    return createElement("div", { "data-testid": "tabs" }, children);
  },
  TabsContent({ children }: { children: ReactNode }) {
    return createElement("div", null, children);
  },
  TabsList({ children }: { children: ReactNode }) {
    return createElement("div", null, children);
  },
  TabsTrigger({ children }: { children: ReactNode }) {
    return createElement("button", { type: "button" }, children);
  },
}));

vi.mock("@/src/components/experiments/experiment-detail/experiment-hero", () => ({
  ExperimentHero: mocks.experimentHero,
}));

vi.mock("@/src/components/experiments/experiment-detail/experiment-header", () => ({
  ExperimentHeader: mocks.experimentHeader,
}));

vi.mock("@/src/components/experiments/experiment-detail/protocol-tab", () => ({
  ProtocolTab: mocks.protocolTab,
}));

vi.mock("@/src/components/experiments/experiment-detail/results-tab", () => ({
  ResultsTab: mocks.resultsTab,
}));

vi.mock("@/src/lib/browser-vault/context", () => ({
  BrowserVaultProvider({ children }: { children: ReactNode }) {
    return createElement("div", null, children);
  },
  useBrowserVault: mocks.useBrowserVault,
}));

vi.mock("@/src/lib/browser-vault/experiment-run", () => ({
  resolveBrowserVaultExperimentRun: mocks.resolveBrowserVaultExperimentRun,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/hosted-onboarding/account-settings-snapshot", () => ({
  readHostedAccountSettingsSnapshot: mocks.readHostedAccountSettingsSnapshot,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

import { ExperimentLayoutClient } from "../app/(dashboard)/experiments/[experimentId]/experiment-layout-client";

const activeCleanups = new Set<() => Promise<void> | void>();
const requireFromExperimentDetailClientTest = createRequire(import.meta.url);
const { parseHTML } = loadLinkedom();

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
    authenticatedMember: null,
    linkedAccounts: [],
  });
  mocks.readHostedAccountSettingsSnapshot.mockResolvedValue(null);
  mocks.readHostedMemberRoutingState.mockResolvedValue(null);
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    dataVersion: null,
    deviceSyncImportPending: false,
    error: null,
    freshness: "fresh",
    ref: null,
    refreshPending: false,
    refresh: vi.fn(async () => {}),
    status: "ready",
    workspaceVersion: null,
  });
});

afterEach(async () => {
  for (const cleanup of [...activeCleanups].reverse()) {
    await cleanup();
  }
  activeCleanups.clear();
});

test("pins the experiment protocol contract to greenfield v1", () => {
  expect(CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION).toBe(1);
});

test("refreshes instead of hydrating the new protocol UI against a stale contract payload", async () => {
  const view = await renderClient(
    createElement(
      ExperimentLayoutClient,
      {
        shell: createShell(createProtocol({
          protocolContractVersion: CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION - 1,
        })),
      },
      createElement("div", null, "child content"),
    ),
  );

  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(mocks.protocolTab).not.toHaveBeenCalled();
  assert.match(view.container.textContent ?? "", /Refreshing experiment/);

  await view.cleanup();
});

test("passes the hosted start action slot into the experiment header", async () => {
  const startAction = createElement("button", { type: "button" }, "server start action");
  const view = await renderClient(
    createElement(
      ExperimentLayoutClient,
      {
        headerStartAction: startAction,
        shell: createShell(),
      },
      createElement("div", null, "child content"),
    ),
  );

  expect(mocks.experimentHeader).toHaveBeenCalledTimes(1);
  const headerProps = (mocks.experimentHeader.mock.calls.at(-1) as
    | [{
        startAction?: ReactNode;
      }]
    | undefined)?.[0];
  expect(headerProps?.startAction).toBe(startAction);

  await view.cleanup();
});

test("hosted experiment start context resolves the assigned member phone", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      id: "member_123",
    },
    linkedAccounts: [
      {
        latest_verified_at: 1771977600,
        phone_number: "+14045550123",
        type: "phone",
      },
      {
        address: "member@example.test",
        latest_verified_at: 1771977600,
        type: "email",
      },
    ],
    memberLookup: null,
    session: null,
  });
  const prisma = { prisma: true };
  mocks.getPrisma.mockReturnValue(prisma);
  mocks.readHostedMemberRoutingState.mockResolvedValue({
    linqChatId: null,
    linqRecipientPhone: "+15550100001",
    memberId: "member_123",
    pendingLinqChatId: null,
    pendingLinqRecipientPhone: null,
    telegramThreadId: null,
    telegramUserId: null,
    telegramUserLookupKey: null,
  });
  mocks.readHostedAccountSettingsSnapshot.mockResolvedValue({
    email: {
      address: "member@example.test",
      murphEmailAddress: "murph+alias123@mail.withmurph.ai",
      verifiedAt: new Date("2026-02-26T00:00:00.000Z"),
    },
    phone: {
      number: "+14045550123",
      verifiedAt: new Date("2026-02-26T00:00:00.000Z"),
    },
    telegram: null,
  });

  const { readHostedExperimentStartContactContext } = await import(
    "../app/(dashboard)/experiments/[experimentId]/experiment-start-button-server"
  );
  const context = await readHostedExperimentStartContactContext();

  expect(mocks.getHostedPageAuthSnapshot).toHaveBeenCalledTimes(1);
  expect(mocks.getPrisma).toHaveBeenCalledTimes(1);
  expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
    memberId: "member_123",
    prisma,
  });
  expect(context.initialContactChannels).toEqual({
    email: true,
    telegram: false,
    text: true,
  });
  expect(context.murphEmailAddress).toBe("murph+alias123@mail.withmurph.ai");
  expect(context.murphPhoneNumber).toBe("+15550100001");
});

test("hosted experiment start context avoids member routing reads for anonymous visitors", async () => {
  const { readHostedExperimentStartContactContext } = await import(
    "../app/(dashboard)/experiments/[experimentId]/experiment-start-button-server"
  );
  const context = await readHostedExperimentStartContactContext();

  expect(mocks.getHostedPageAuthSnapshot).toHaveBeenCalledTimes(1);
  expect(mocks.getPrisma).not.toHaveBeenCalled();
  expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
  expect(context.initialContactChannels).toEqual({
    email: false,
    telegram: false,
    text: false,
  });
  expect(context.murphPhoneNumber).toBeNull();
});

test("experiment start fallback is not a live contact route", async () => {
  const { ExperimentStartButtonFallback } = await import(
    "../app/(dashboard)/experiments/[experimentId]/experiment-start-button-server"
  );
  const markup = renderToStaticMarkup(
    createElement(ExperimentStartButtonFallback, {
      protocolDays: 14,
      protocolTitle: "Finnish Dry Sauna",
    }),
  );

  expect(markup).toContain("disabled");
  expect(markup).toContain('aria-busy="true"');
  expect(markup).not.toContain("href=");
  expect(markup).not.toContain("https://t.me");
});

test("experiment start action becomes a quiet status chip for a running browser-vault run", async () => {
  const protocol = createResultsPublicProjection();
  const activeRun: ExperimentRunProjection = {
    id: "run_1",
    source: "browser-vault",
    snapshotGeneratedAt: "2026-04-15T00:00:00.000Z",
    slug: null,
    status: "active",
    statusLabel: "Active",
    startedOn: "2026-04-01",
    tags: [],
    title: "Finnish Dry Sauna",
    signals: [],
    trends: [],
    timeline: [],
  };
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    dataVersion: null,
    deviceSyncImportPending: false,
    error: null,
    freshness: "fresh",
    ref: null,
    refreshPending: false,
    refresh: vi.fn(async () => {}),
    status: "ready",
    workspaceVersion: null,
  });
  mocks.resolveBrowserVaultExperimentRun.mockReturnValue(activeRun);

  const { ExperimentStartOrRunStatus } = await import(
    "../app/(dashboard)/experiments/[experimentId]/experiment-start-or-run-status"
  );
  const view = await renderClient(
    createElement(ExperimentStartOrRunStatus, {
      activeRunProtocol: protocol,
      protocolDays: 14,
      startAction: createElement("button", { type: "button" }, "Start Experiment"),
    }),
  );

  expect(mocks.resolveBrowserVaultExperimentRun).toHaveBeenCalledWith({
    client: null,
    protocol,
  });
  expect(view.container.textContent).toContain("Experiment in progress");
  expect(view.container.textContent).not.toContain("Start Experiment");
  expect(view.container.querySelector(".bg-primary")).not.toBeNull();
  // The run's results render on the experiment page itself; the running state
  // must not add a link pointing back at the same page.
  expect(view.container.querySelector("a")).toBeNull();

  await view.cleanup();
});

test("paused browser-vault runs get the muted status chip, not the live dot", async () => {
  const protocol = createResultsPublicProjection();
  const pausedRun: ExperimentRunProjection = {
    id: "run_1",
    source: "browser-vault",
    snapshotGeneratedAt: "2026-04-15T00:00:00.000Z",
    slug: null,
    status: "paused",
    statusLabel: "Paused",
    startedOn: "2026-04-01",
    tags: [],
    title: "Finnish Dry Sauna",
    signals: [],
    trends: [],
    timeline: [],
  };
  mocks.resolveBrowserVaultExperimentRun.mockReturnValue(pausedRun);

  const { ExperimentStartOrRunStatus } = await import(
    "../app/(dashboard)/experiments/[experimentId]/experiment-start-or-run-status"
  );
  const view = await renderClient(
    createElement(ExperimentStartOrRunStatus, {
      activeRunProtocol: protocol,
      protocolDays: 14,
      startAction: createElement("button", { type: "button" }, "Start Experiment"),
    }),
  );

  expect(view.container.textContent).toContain("Experiment paused");
  expect(view.container.querySelector(".bg-muted-foreground")).not.toBeNull();
  expect(view.container.querySelector(".bg-primary")).toBeNull();
  expect(view.container.querySelector("a")).toBeNull();

  await view.cleanup();
});

test("server layout keeps routing reads inside the deferred start action slot", async () => {
  const { default: ExperimentDetailLayout } = await import(
    "../app/(dashboard)/experiments/[experimentId]/layout"
  );
  const view = await renderClient(
    await ExperimentDetailLayout({
      children: createElement("div", null, "child content"),
      params: Promise.resolve({ experimentId: "finnish-sauna" }),
    }),
  );

  expect(mocks.getHostedPageAuthSnapshot).not.toHaveBeenCalled();
  expect(mocks.getPrisma).not.toHaveBeenCalled();
  expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
  const headerProps = (mocks.experimentHeader.mock.calls.at(-1) as
    | [{
        startAction?: ReactNode;
      }]
    | undefined)?.[0];
  expect(headerProps?.startAction).toBeTruthy();

  await view.cleanup();
});

async function renderClient(element: ReactNode) {
  const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
  const cleanupGlobals = installGlobals(window, document);
  activeCleanups.add(cleanupGlobals);
  const container = document.getElementById("root");
  assert.ok(container);

  let root: Root | null = createRoot(container);

  await act(async () => {
    root?.render(element);
  });

  return {
    cleanup: async () => {
      await act(async () => {
        root?.unmount();
        root = null;
      });
      cleanupGlobals();
      activeCleanups.delete(cleanupGlobals);
    },
    container,
  };
}

function installGlobals(
  window: Window & typeof globalThis,
  document: Document,
) {
  const restoreEntries = [
    setGlobal("window", window),
    setGlobal("self", window),
    setGlobal("document", document),
    setGlobal("navigator", window.navigator),
    setGlobal("HTMLElement", window.HTMLElement),
    setGlobal("Node", window.Node),
    setGlobal("Event", window.Event),
    setGlobal("MutationObserver", window.MutationObserver),
    setGlobal("ResizeObserver", class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }),
    setGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }),
    setGlobal("cancelAnimationFrame", () => {}),
    setGlobal("IS_REACT_ACT_ENVIRONMENT", true),
  ];

  return () => {
    for (const restore of restoreEntries.reverse()) {
      restore();
    }
  };
}

function setGlobal(key: string, value: unknown) {
  const hadOwnProperty = Object.prototype.hasOwnProperty.call(globalThis, key);
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, key);

  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });

  return () => {
    if (hadOwnProperty) {
      assert.ok(previousDescriptor);
      Object.defineProperty(globalThis, key, previousDescriptor);
      return;
    }

    Reflect.deleteProperty(globalThis, key);
  };
}

function loadLinkedom(): {
  parseHTML: (html: string) => { document: Document; window: Window & typeof globalThis };
} {
  const resolvePaths = [
    path.resolve(process.cwd(), "node_modules"),
    path.resolve(process.cwd(), "node_modules/.pnpm/node_modules"),
  ];

  for (const resolvePath of resolvePaths) {
    try {
      const resolvedEntry = requireFromExperimentDetailClientTest.resolve("linkedom", {
        paths: [resolvePath],
      });
      return requireFromExperimentDetailClientTest(resolvedEntry) as {
        parseHTML: (html: string) => { document: Document; window: Window & typeof globalThis };
      };
    } catch {
      // Try the next resolution root.
    }
  }

  throw new Error("Unable to resolve linkedom for experiment-detail client tests.");
}

function createProtocol(
  overrides: Partial<ExperimentProtocol> = {},
): ExperimentProtocol {
  return {
    protocolContractVersion: CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION,
    id: "finnish-sauna",
    title: "Finnish Dry Sauna",
    category: "Recovery",
    image: "/design-assets/hero-sauna.png",
    durationDays: 21,
    baselineDays: 7,
    studyCount: 81,
    researchSummaryLabel: "81 studies",
    evidenceLevel: 3,
    evidenceLabel: "Field testing · Usable",
    description: "Simple heat exposure experiment.",
    expectedSignals: [],
    measurementPaths: [],
    protocolFacts: [],
    protocol: [],
    protocolTips: [],
    protocolKeepInMind: [],
    protocolLogFields: [],
    mechanismChain: [],
    whyItWorks: "Heat load can act as a stressor.",
    experts: [],
    researchStats: [],
    studies: [],
    safety: {
      cautionLevel: 3,
      precautions: [],
      whoShouldAvoid: [],
    },
    ...overrides,
  };
}

function createShell(
  protocol: ExperimentProtocol = createProtocol(),
): ExperimentShellProjection {
  return {
    protocolContractVersion: protocol.protocolContractVersion,
    baselineDays: protocol.baselineDays,
    category: protocol.category,
    description: protocol.description,
    durationDays: protocol.durationDays,
    evidenceLabel: protocol.evidenceLabel,
    evidenceLevel: protocol.evidenceLevel,
    id: protocol.id,
    image: protocol.image,
    key: protocol.commons?.key ?? "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    revision: {
      pageRevisionId: protocol.commons?.pageRevisionId ?? "sha256:test-page",
      recipeHash: protocol.commons?.recipeHash ?? null,
      runSpecRevisionId: protocol.commons?.runSpecRevisionId ?? null,
    },
    title: protocol.title,
  };
}

function createResultsPublicProjection(
  protocol: ExperimentProtocol = createProtocol(),
): ExperimentResultsPublicProjection {
  return {
    protocolContractVersion: protocol.protocolContractVersion,
    baselineDays: protocol.baselineDays,
    commons: protocol.commons ?? {
      aliases: [protocol.id],
      catalogHash: "sha256:test-catalog",
      key: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
      pageRevisionId: "sha256:test-page",
      recipeHash: null,
      routeId: protocol.id,
      runSpecRevisionId: null,
      slug: protocol.id,
    },
    durationDays: protocol.durationDays,
    id: protocol.id,
    key: protocol.commons?.key ?? "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    protocol: protocol.protocol,
    revision: {
      pageRevisionId: protocol.commons?.pageRevisionId ?? "sha256:test-page",
      recipeHash: protocol.commons?.recipeHash ?? null,
      runSpecRevisionId: protocol.commons?.runSpecRevisionId ?? null,
    },
    title: protocol.title,
  };
}
