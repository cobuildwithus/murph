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
  protocolTab: vi.fn(() => createElement("div", null, "protocol tab")),
  refresh: vi.fn(),
  resolveBrowserVaultExperimentRun: vi.fn(() => null),
  resultsTab: vi.fn(() => createElement("div", null, "results tab")),
  useBrowserVault: vi.fn(() => ({
    client: null,
    error: null,
    refresh: vi.fn(),
    status: "ready",
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.refresh,
  }),
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

vi.mock("@/src/lib/experiments/experiment-detail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/experiments/experiment-detail")>();

  return {
    ...actual,
    composeExperimentDetail: mocks.composeExperimentDetail,
  };
});

import { ExperimentDetailClient } from "../app/(dashboard)/experiments/[experimentId]/experiment-detail-client";

const activeCleanups = new Set<() => Promise<void> | void>();
const requireFromExperimentDetailClientTest = createRequire(import.meta.url);
const { parseHTML } = loadLinkedom();

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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
  const view = await renderExperimentDetailClient({
    protocol: createProtocol({
      protocolContractVersion: CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION - 1,
    }),
  });

  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(mocks.protocolTab).not.toHaveBeenCalled();
  assert.match(view.container.textContent ?? "", /Refreshing experiment/);

  await view.cleanup();
});

test("renders the protocol tab without forcing a refresh when the contract is current", async () => {
  const view = await renderExperimentDetailClient({
    protocol: createProtocol(),
  });

  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.protocolTab).toHaveBeenCalledTimes(1);
  assert.match(view.container.textContent ?? "", /protocol tab/);

  await view.cleanup();
});

async function renderExperimentDetailClient(input: {
  protocol: ExperimentProtocol;
}) {
  const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
  const cleanupGlobals = installGlobals(window, document);
  activeCleanups.add(cleanupGlobals);
  const container = document.getElementById("root");
  assert.ok(container);

  let root: Root | null = createRoot(container);

  await act(async () => {
    root?.render(createElement(ExperimentDetailClient, input));
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
