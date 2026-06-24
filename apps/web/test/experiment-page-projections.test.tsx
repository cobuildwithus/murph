import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";
import type { ProtocolTabExperiment } from "@/src/components/experiments/experiment-detail/protocol-tab";

const mocks = vi.hoisted(() => ({
  getHostedDashboardPageAuthSnapshot: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  protocolTab: vi.fn(),
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

describe("experiment page projections", () => {
  beforeEach(() => {
    mocks.getHostedDashboardPageAuthSnapshot.mockReset();
    mocks.getHostedDashboardPageAuthSnapshot.mockResolvedValue({
      authenticated: true,
      authenticatedMember: null,
      session: null,
    });
    mocks.notFound.mockClear();
    mocks.protocolTab.mockClear();
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

    expect(pageSource).toContain("resolveHealthCommonsExperimentProtocolTab");
    expect(pageSource).not.toContain("resolveHealthCommonsExperimentProtocol(");
    expect(pageSource).not.toContain("ExperimentDetailClient");
    expect(layoutSource).toContain("resolveHealthCommonsExperimentShell");
    expect(layoutSource).not.toContain("resolveHealthCommonsExperimentProtocol");
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
