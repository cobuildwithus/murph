import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION } from "@/src/lib/experiments/experiment-detail";
import type { ExperimentProtocol } from "@/src/types/experiments";

const mocks = vi.hoisted(() => ({
  composeExperimentDetail: vi.fn(({ protocol }: { protocol: ExperimentProtocol }) => ({
    ...protocol,
    status: "upcoming" as const,
    signals: [],
    timeline: [],
    trends: [],
  })),
  experimentHeader: vi.fn(() => createElement("div", null, "header")),
  experimentHero: vi.fn(() => createElement("div", null, "hero")),
  getHostedPageAuthSnapshot: vi.fn(),
  getPrisma: vi.fn(() => ({ prisma: true })),
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
  protocolTab: vi.fn(() => createElement("div", null, "protocol tab")),
  readHostedMemberRoutingState: vi.fn(),
  refresh: vi.fn(),
  resolveBrowserVaultExperimentRun: vi.fn(() => null),
  resolveHealthCommonsExperimentProtocol: vi.fn(),
  resultsTab: vi.fn(() => createElement("div", null, "results tab")),
  useBrowserVault: vi.fn(() => ({
    client: null,
    error: null,
    refresh: vi.fn(),
    status: "ready",
  })),
}));

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

vi.mock("@/src/lib/health-commons/experiment-detail", () => ({
  resolveHealthCommonsExperimentProtocol: mocks.resolveHealthCommonsExperimentProtocol,
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

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/experiments/experiment-detail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/experiments/experiment-detail")>();

  return {
    ...actual,
    composeExperimentDetail: mocks.composeExperimentDetail,
  };
});

import { ExperimentDetailClient } from "../app/(dashboard)/experiments/[experimentId]/experiment-detail-client";
import { ExperimentLayoutClient } from "../app/(dashboard)/experiments/[experimentId]/experiment-layout-client";
import { ResultsTabClient } from "../app/(dashboard)/experiments/[experimentId]/results/results-tab-client";

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
  mocks.readHostedMemberRoutingState.mockResolvedValue(null);
  mocks.resolveHealthCommonsExperimentProtocol.mockImplementation((id: string) => (
    id === "finnish-sauna" ? createProtocol() : null
  ));
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    error: null,
    refresh: vi.fn(),
    status: "ready",
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
        protocol: createProtocol({
          protocolContractVersion: CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION - 1,
        }),
      },
      createElement("div", null, "child content"),
    ),
  );

  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(mocks.protocolTab).not.toHaveBeenCalled();
  assert.match(view.container.textContent ?? "", /Refreshing experiment/);

  await view.cleanup();
});

test("renders the protocol tab with a link to the research subroute", async () => {
  const view = await renderClient(
    createElement(ExperimentDetailClient, {
      protocol: createProtocol(),
    }),
  );

  expect(mocks.protocolTab).toHaveBeenCalledTimes(1);
  const protocolTabProps = (mocks.protocolTab.mock.calls.at(-1) as
    | [{ researchHref?: string }]
    | undefined)?.[0];
  expect(protocolTabProps?.researchHref).toBe("/experiments/finnish-sauna/research");
  assert.match(view.container.textContent ?? "", /protocol tab/);

  await view.cleanup();
});

test("passes minimized hosted contact routing state into the experiment header", async () => {
  const initialContactChannels = {
    email: true,
    telegram: false,
    text: true,
  };
  const view = await renderClient(
    createElement(
      ExperimentLayoutClient,
      {
        initialContactChannels,
        murphPhoneNumber: "+15550100001",
        protocol: createProtocol(),
      },
      createElement("div", null, "child content"),
    ),
  );

  expect(mocks.experimentHeader).toHaveBeenCalledTimes(1);
  const headerProps = (mocks.experimentHeader.mock.calls.at(-1) as
    | [{
        initialContactChannels?: unknown;
        murphPhoneNumber?: string | null;
      }]
    | undefined)?.[0];
  expect(headerProps?.initialContactChannels).toBe(initialContactChannels);
  expect(headerProps?.murphPhoneNumber).toBe("+15550100001");

  await view.cleanup();
});

test("passes hosted start contact context into the results empty-state CTA", async () => {
  const initialContactChannels = {
    email: false,
    telegram: true,
    text: true,
  };
  const protocol = createProtocol();
  const view = await renderClient(
    createElement(
      ExperimentLayoutClient,
      {
        initialContactChannels,
        murphPhoneNumber: "+15550100001",
        protocol,
      },
      createElement(ResultsTabClient, { protocol }),
    ),
  );

  expect(mocks.resultsTab).toHaveBeenCalledTimes(1);
  const resultsProps = (mocks.resultsTab.mock.calls.at(-1) as
    | [{
        initialContactChannels?: unknown;
        murphPhoneNumber?: string | null;
      }]
    | undefined)?.[0];
  expect(resultsProps?.initialContactChannels).toBe(initialContactChannels);
  expect(resultsProps?.murphPhoneNumber).toBe("+15550100001");

  await view.cleanup();
});

test("server layout passes contact-channel flags and routing phone to the client tree", async () => {
  const linkedAccounts = [{
    phone_number: "+14045550123",
    latest_verified_at: 1771977600,
    type: "phone",
  }, {
    address: "member@example.test",
    latest_verified_at: 1771977600,
    type: "email",
  }];
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      id: "member_123",
    },
    linkedAccounts,
  });
  mocks.readHostedMemberRoutingState.mockResolvedValue({
    linqRecipientPhone: "+15550100001",
  });
  const { default: ExperimentDetailLayout } = await import(
    "../app/(dashboard)/experiments/[experimentId]/layout"
  );
  const view = await renderClient(
    await ExperimentDetailLayout({
      children: createElement("div", null, "child content"),
      params: Promise.resolve({ experimentId: "finnish-sauna" }),
    }),
  );

  expect(mocks.getHostedPageAuthSnapshot).toHaveBeenCalledTimes(1);
  expect(mocks.getPrisma).toHaveBeenCalledTimes(1);
  expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
    memberId: "member_123",
    prisma: { prisma: true },
  });
  const headerProps = (mocks.experimentHeader.mock.calls.at(-1) as
    | [{
        initialContactChannels?: unknown;
        murphPhoneNumber?: string | null;
      }]
    | undefined)?.[0];
  expect(headerProps?.initialContactChannels).toEqual({
    email: true,
    telegram: false,
    text: true,
  });
  expect(headerProps?.murphPhoneNumber).toBe("+15550100001");
  expect(JSON.stringify(headerProps)).not.toContain("+14045550123");
  expect(JSON.stringify(headerProps)).not.toContain("member@example.test");

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
