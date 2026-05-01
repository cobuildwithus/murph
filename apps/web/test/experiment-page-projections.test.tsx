import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";
import type { ProtocolTabExperiment } from "@/src/components/experiments/experiment-detail/protocol-tab";
import type { ExperimentResultsPublicProjection } from "@/src/lib/health-commons/experiment-projections";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  protocolTab: vi.fn(),
  resultsTabClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  usePathname: () => "/experiments/finnish-sauna",
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/src/components/experiments/experiment-detail/protocol-tab", () => ({
  ProtocolTab({
    experiment,
    researchHref,
  }: {
    experiment: ProtocolTabExperiment;
    researchHref?: string;
  }) {
    mocks.protocolTab({ experiment, researchHref });

    return createElement(
      "div",
      {
        "data-experiment-id": experiment.id,
        "data-protocol-steps": experiment.protocol.length,
        "data-research-href": researchHref,
      },
      experiment.whyItWorks,
    );
  },
}));

vi.mock("../app/(dashboard)/experiments/[experimentId]/results/results-tab-client", () => ({
  ResultsTabClient({
    protocol,
    startAction,
  }: {
    protocol: ExperimentResultsPublicProjection;
    startAction?: ReactNode;
  }) {
    mocks.resultsTabClient({ protocol, startAction });

    return createElement(
      "div",
      {
        "data-experiment-id": protocol.id,
        "data-protocol-steps": protocol.protocol.length,
      },
      protocol.title,
    );
  },
}));

vi.mock("../app/(dashboard)/experiments/[experimentId]/experiment-start-button-server", () => ({
  ExperimentStartButtonFallback({ protocolTitle }: { protocolTitle: string }) {
    return createElement("button", { type: "button" }, protocolTitle);
  },
  HostedExperimentStartButton({ protocolTitle }: { protocolTitle: string }) {
    return createElement("button", { type: "button" }, protocolTitle);
  },
}));

import ExperimentDetailLayout from "../app/(dashboard)/experiments/[experimentId]/layout";
import ExperimentDetailPage, {
  generateMetadata,
} from "../app/(dashboard)/experiments/[experimentId]/page";
import ExperimentResultsPage, {
  generateMetadata as generateResultsMetadata,
} from "../app/(dashboard)/experiments/[experimentId]/results/page";

describe("experiment page projections", () => {
  beforeEach(() => {
    mocks.notFound.mockClear();
    mocks.protocolTab.mockClear();
    mocks.resultsTabClient.mockClear();
  });

  it("keeps experiment route entrypoints on generated projections instead of the full resolver", () => {
    const pageSource = readFileSync(
      new URL("../app/(dashboard)/experiments/[experimentId]/page.tsx", import.meta.url),
      "utf8",
    );
    const layoutSource = readFileSync(
      new URL("../app/(dashboard)/experiments/[experimentId]/layout.tsx", import.meta.url),
      "utf8",
    );
    const resultsSource = readFileSync(
      new URL("../app/(dashboard)/experiments/[experimentId]/results/page.tsx", import.meta.url),
      "utf8",
    );
    const layoutClientSource = readFileSync(
      new URL("../app/(dashboard)/experiments/[experimentId]/experiment-layout-client.tsx", import.meta.url),
      "utf8",
    );

    expect(pageSource).toContain("resolveHealthCommonsExperimentProtocolTab");
    expect(pageSource).not.toContain("resolveHealthCommonsExperimentProtocol(");
    expect(pageSource).not.toContain("ExperimentDetailClient");
    expect(layoutSource).toContain("resolveHealthCommonsExperimentShell");
    expect(layoutSource).not.toContain("resolveHealthCommonsExperimentProtocol");
    expect(resultsSource).toContain("resolveHealthCommonsExperimentResultsPublic");
    expect(resultsSource).not.toContain("resolveHealthCommonsExperimentProtocol");
    expect(layoutClientSource).not.toContain("BrowserVaultProvider");
    expect(layoutClientSource).not.toContain("resolveBrowserVaultExperimentRun");
  });

  it("uses the shell projection for metadata and shared layout props", async () => {
    await expect(generateMetadata({
      params: Promise.resolve({
        experimentId: "finnish-sauna",
      }),
    })).resolves.toEqual(expect.objectContaining({
      description: expect.stringContaining("steady, tolerable heat"),
      title: "Finnish Dry Sauna — Murph Experiments",
    }));

    const element = await ExperimentDetailLayout({
      children: createElement("div", null, "child"),
      params: Promise.resolve({
        experimentId: "murph-finnish-standard-3x-week",
      }),
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("child");
  });

  it("renders the protocol tab projection with full-detail parity for protocol-only fields", async () => {
    const fullProtocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");
    if (!fullProtocol) {
      throw new Error("Expected the full Finnish sauna protocol.");
    }

    const element = await ExperimentDetailPage({
      params: Promise.resolve({
        experimentId: "murph-finnish-standard-3x-week",
      }),
    });
    const markup = renderToStaticMarkup(element);
    const experiment = mocks.protocolTab.mock.calls.at(-1)?.[0]
      ?.experiment as ProtocolTabExperiment;

    expect(experiment).toEqual(expect.objectContaining({
      baselineDays: fullProtocol.baselineDays,
      durationDays: fullProtocol.durationDays,
      id: "finnish-sauna",
      mechanismChain: fullProtocol.mechanismChain,
      protocol: fullProtocol.protocol,
      protocolFacts: fullProtocol.protocolFacts,
      protocolTips: fullProtocol.protocolTips,
      safety: fullProtocol.safety,
      whyItWorks: fullProtocol.whyItWorks,
    }));
    expect(experiment.expectedSignals).toEqual(
      fullProtocol.expectedSignals.map((signal) => expect.objectContaining({
        description: signal.description,
        direction: signal.direction,
        label: signal.label,
        protocolProminence: signal.protocolProminence,
      })),
    );
    expect(markup).toContain('data-experiment-id="finnish-sauna"');
    expect(markup).toContain('data-research-href="/experiments/finnish-sauna/research"');
  });

  it("renders the results page from the results-public projection", async () => {
    await expect(generateResultsMetadata({
      params: Promise.resolve({
        experimentId: "finnish-sauna",
      }),
    })).resolves.toEqual(expect.objectContaining({
      description: expect.stringContaining("steady, tolerable heat"),
      title: "Finnish Dry Sauna results — Murph Experiments",
    }));

    const element = await ExperimentResultsPage({
      params: Promise.resolve({
        experimentId: "murph-finnish-standard-3x-week",
      }),
    });
    const markup = renderToStaticMarkup(element);
    const protocol = mocks.resultsTabClient.mock.calls.at(-1)?.[0]
      ?.protocol as ExperimentResultsPublicProjection;

    expect(protocol).toEqual(expect.objectContaining({
      baselineDays: 7,
      commons: expect.objectContaining({
        key: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
        routeId: "finnish-sauna",
      }),
      durationDays: 21,
      id: "finnish-sauna",
      title: "Finnish Dry Sauna",
    }));
    expect(protocol.protocol.length).toBeGreaterThan(0);
    expect(markup).toContain('data-experiment-id="finnish-sauna"');
  });
});
