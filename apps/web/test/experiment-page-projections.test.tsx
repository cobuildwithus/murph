import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";
import type { ProtocolTabExperiment } from "@/src/components/experiments/experiment-detail/protocol-tab";
import type { ExperimentResultsPublicProjection } from "@/src/lib/health-commons/experiment-projections";

const mocks = vi.hoisted(() => ({
  getHostedDashboardPageAuthSnapshot: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  hostedStart: vi.fn(),
  protocolTab: vi.fn(),
  privateRunResultsClient: vi.fn(),
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

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedDashboardPageAuthSnapshot: mocks.getHostedDashboardPageAuthSnapshot,
}));

vi.mock("../app/(dashboard)/experiments/[experimentId]/active-run-summary-client", () => ({
  ActiveRunSummaryClient() {
    return null;
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
      { "data-experiment-id": protocol.id },
      protocol.title,
    );
  },
}));

vi.mock("../app/(dashboard)/experiments/runs/[experimentId]/private-run-results-client", () => ({
  PrivateRunResultsClient({ experimentId }: { experimentId: string }) {
    mocks.privateRunResultsClient({ experimentId });
    return createElement("div", { "data-private-run-id": experimentId });
  },
}));

vi.mock("../app/(dashboard)/experiments/[experimentId]/experiment-start-button-server", () => ({
  ExperimentStartButtonFallback({ protocolTitle }: { protocolTitle: string }) {
    return createElement("button", { type: "button" }, protocolTitle);
  },
  HostedExperimentStartButton(props: {
    protocolTitle: string;
  }) {
    mocks.hostedStart(props);
    const { protocolTitle } = props;
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
import PrivateExperimentRunPage, {
  metadata as privateExperimentRunMetadata,
} from "../app/(dashboard)/experiments/runs/[experimentId]/page";

describe("experiment page projections", () => {
  beforeEach(() => {
    mocks.getHostedDashboardPageAuthSnapshot.mockReset();
    mocks.getHostedDashboardPageAuthSnapshot.mockResolvedValue({
      authenticated: true,
      authenticatedMember: null,
      session: null,
    });
    mocks.notFound.mockClear();
    mocks.hostedStart.mockClear();
    mocks.protocolTab.mockClear();
    mocks.privateRunResultsClient.mockClear();
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
    const layoutClientSource = readFileSync(
      new URL("../app/(dashboard)/experiments/[experimentId]/experiment-layout-client.tsx", import.meta.url),
      "utf8",
    );
    const resultsSource = readFileSync(
      new URL("../app/(dashboard)/experiments/[experimentId]/results/page.tsx", import.meta.url),
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

  it("renders the authenticated results route from the narrow public projection", async () => {
    await expect(generateResultsMetadata({
      params: Promise.resolve({
        experimentId: "finnish-sauna",
      }),
    })).resolves.toEqual(expect.objectContaining({
      description: expect.stringContaining("steady, tolerable heat"),
      title: "Finnish Dry Sauna results | Murph Experiments",
    }));

    const element = await ExperimentResultsPage({
      params: Promise.resolve({
        experimentId: "murph-finnish-standard-3x-week",
      }),
    });
    const markup = renderToStaticMarkup(element);
    const protocol = mocks.resultsTabClient.mock.calls.at(-1)?.[0]
      ?.protocol as ExperimentResultsPublicProjection;

    expect(mocks.getHostedDashboardPageAuthSnapshot).toHaveBeenCalled();
    expect(protocol).toEqual(expect.objectContaining({
      baselineDays: 14,
      commons: expect.objectContaining({
        key: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
        routeId: "finnish-sauna",
      }),
      durationDays: 28,
      id: "finnish-sauna",
      title: "Finnish Dry Sauna",
    }));
    expect(markup).toContain('data-experiment-id="finnish-sauna"');
  });

  it("renders the authenticated private-run route without resolving a public protocol", async () => {
    expect(privateExperimentRunMetadata).toEqual(expect.objectContaining({
      description: expect.stringContaining("private progress"),
      title: "Private experiment | Murph",
    }));

    const element = await PrivateExperimentRunPage({
      params: Promise.resolve({ experimentId: "exp:private-run" }),
    });
    const markup = renderToStaticMarkup(element);

    expect(mocks.getHostedDashboardPageAuthSnapshot).toHaveBeenCalled();
    expect(mocks.privateRunResultsClient).toHaveBeenCalledWith({
      experimentId: "exp:private-run",
    });
    expect(markup).toContain('data-private-run-id="exp:private-run"');

    const privatePageSource = readFileSync(
      new URL("../app/(dashboard)/experiments/runs/[experimentId]/page.tsx", import.meta.url),
      "utf8",
    );
    expect(privatePageSource).not.toContain("HealthCommons");
  });

  it("uses the shell projection for metadata and shared layout props", async () => {
    await expect(generateMetadata({
      params: Promise.resolve({
        experimentId: "finnish-sauna",
      }),
    })).resolves.toEqual(expect.objectContaining({
      alternates: {
        canonical: "/experiments/finnish-sauna",
      },
      description: expect.stringContaining("steady, tolerable heat"),
      robots: { follow: true, index: true },
      title: "Finnish Dry Sauna | Murph Experiments",
    }));

    const element = await ExperimentDetailLayout({
      children: createElement("div", null, "child"),
      params: Promise.resolve({
        experimentId: "murph-finnish-standard-3x-week",
      }),
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("child");
    expect(mocks.hostedStart).toHaveBeenCalledWith(expect.objectContaining({
      protocolTitle: expect.any(String),
    }));
    expect(mocks.hostedStart).not.toHaveBeenCalledWith(expect.objectContaining({
      protocolRef: expect.anything(),
    }));
  });

  it("returns not found for an explicit draft protocol instead of rendering Start", async () => {
    await expect(ExperimentDetailLayout({
      children: createElement("div", null, "child"),
      params: Promise.resolve({
        experimentId: "red-light-glasses-before-bed",
      }),
    })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.hostedStart).not.toHaveBeenCalled();
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

    expect(experiment.baselineDays).toBe(fullProtocol.baselineDays);
    expect(experiment.durationDays).toBe(fullProtocol.durationDays);
    expect(experiment.id).toBe("finnish-sauna");
    expect(experiment.mechanismChain).toEqual(fullProtocol.mechanismChain);
    expect(experiment.protocol).toEqual(fullProtocol.protocol);
    expect(experiment.protocolFacts).toEqual(fullProtocol.protocolFacts);
    expect(experiment.protocolTips).toEqual(fullProtocol.protocolTips);
    expect(experiment.sessionShape).toEqual(fullProtocol.sessionShape);
    expect(experiment.whyItWorks).toBe(fullProtocol.whyItWorks);
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

});
