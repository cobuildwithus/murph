import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getGeneratedHealthCommonsWebRouteIndex } from "@murphai/health-commons";
import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";
import type { ResearchTabExperiment } from "@/src/components/experiments/experiment-detail/research-tab";

const mocks = vi.hoisted(() => ({
  getHostedDashboardPageAuthSnapshot: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  researchTab: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedDashboardPageAuthSnapshot: mocks.getHostedDashboardPageAuthSnapshot,
}));

vi.mock("@/src/components/experiments/experiment-detail/research-tab", () => ({
  ResearchTab({
    experiment,
  }: {
    experiment: ResearchTabExperiment;
  }) {
    mocks.researchTab({ experiment });

    return createElement(
      "div",
      {
        "data-experiment-id": experiment.id,
        "data-study-count": experiment.studies.length,
      },
      experiment.researchLandscape?.primaryClaim ?? experiment.id,
    );
  },
}));

import ExperimentResearchPage, {
  generateMetadata,
} from "../app/(dashboard)/experiments/[experimentId]/research/page";

describe("ExperimentResearchPage", () => {
  beforeEach(() => {
    mocks.getHostedDashboardPageAuthSnapshot.mockReset();
    mocks.getHostedDashboardPageAuthSnapshot.mockResolvedValue({
      authenticated: true,
      authenticatedMember: null,
      session: null,
    });
    mocks.notFound.mockClear();
    mocks.researchTab.mockClear();
  });

  it("loads the research-tab projection without the full experiment resolver or BrowserVault client path", async () => {
    const source = readFileSync(
      new URL("../app/(dashboard)/experiments/[experimentId]/research/page.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("resolveHealthCommonsExperimentResearchTab");
    expect(source).not.toContain("resolveHealthCommonsExperimentProtocol");
    expect(source).not.toContain("ResearchTabClient");
    expect(source).not.toContain("useBrowserVault");
  });

  it("returns metadata from the minimal projection", async () => {
    await expect(generateMetadata({
      params: Promise.resolve({
        experimentId: "finnish-sauna",
      }),
    })).resolves.toEqual(expect.objectContaining({
      alternates: {
        canonical: "/experiments/finnish-sauna/research",
      },
      description: expect.stringContaining("steady, tolerable heat"),
      openGraph: expect.objectContaining({
        type: "article",
      }),
      robots: { follow: true, index: true },
      title: "Finnish Dry Sauna research — Murph Experiments",
    }));
  });

  it("rejects projection artifacts whose key and route no longer match the route index", async () => {
    const generatedWebRoot = await mkdtemp(path.join(os.tmpdir(), "murph-health-commons-web-"));
    const generatedWebArtifactsRoot = path.join(
      generatedWebRoot,
      "packages/health-commons/generated/web",
    );

    await mkdir(path.join(generatedWebArtifactsRoot, "routes"), { recursive: true });
    await mkdir(path.join(generatedWebArtifactsRoot, "tabs/experiments/finnish-sauna"), {
      recursive: true,
    });

    await writeFile(
      path.join(generatedWebArtifactsRoot, "routes/index.json"),
      JSON.stringify(getGeneratedHealthCommonsWebRouteIndex()),
      "utf8",
    );

    const projection = JSON.parse(
      readFileSync(
        new URL("../../../packages/health-commons/generated/web/tabs/experiments/finnish-sauna/research.json", import.meta.url),
        "utf8",
      ),
    ) as {
      key: string;
      route: {
        routeId: string;
        slug: string;
      };
    };

    await writeFile(
      path.join(generatedWebArtifactsRoot, "tabs/experiments/finnish-sauna/research.json"),
      JSON.stringify({
        ...projection,
        key: "protocol_variant:dry-sauna/not-finnish-sauna",
        route: {
          ...projection.route,
          routeId: "not-finnish-sauna",
        },
      }),
      "utf8",
    );

    vi.resetModules();
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(generatedWebRoot);
    try {
      const { loadGeneratedExperimentProjection } = await import(
        "@/src/lib/health-commons/generated-experiment-artifacts"
      );

      expect(() => loadGeneratedExperimentProjection("finnish-sauna", "experiment.research"))
        .toThrow("does not match route index");
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("rejects projection artifacts whose top-level id no longer matches the route index", async () => {
    const generatedWebRoot = await mkdtemp(path.join(os.tmpdir(), "murph-health-commons-web-"));
    const generatedWebArtifactsRoot = path.join(
      generatedWebRoot,
      "packages/health-commons/generated/web",
    );

    await mkdir(path.join(generatedWebArtifactsRoot, "routes"), { recursive: true });
    await mkdir(path.join(generatedWebArtifactsRoot, "shell/experiments"), { recursive: true });

    await writeFile(
      path.join(generatedWebArtifactsRoot, "routes/index.json"),
      JSON.stringify(getGeneratedHealthCommonsWebRouteIndex()),
      "utf8",
    );

    const shell = JSON.parse(
      readFileSync(
        new URL("../../../packages/health-commons/generated/web/shell/experiments/finnish-sauna.json", import.meta.url),
        "utf8",
      ),
    ) as Record<string, unknown>;

    await writeFile(
      path.join(generatedWebArtifactsRoot, "shell/experiments/finnish-sauna.json"),
      JSON.stringify({
        ...shell,
        id: "not-finnish-sauna",
      }),
      "utf8",
    );

    vi.resetModules();
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(generatedWebRoot);
    try {
      const { loadGeneratedExperimentProjection } = await import(
        "@/src/lib/health-commons/generated-experiment-artifacts"
      );

      expect(() => loadGeneratedExperimentProjection("finnish-sauna", "experiment.shell"))
        .toThrow("does not match route index");
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("rereads generated protocol projections outside production cache", async () => {
    const generatedWebRoot = await mkdtemp(path.join(os.tmpdir(), "murph-health-commons-web-"));
    const generatedWebArtifactsRoot = path.join(
      generatedWebRoot,
      "packages/health-commons/generated/web",
    );
    const protocolArtifactPath = path.join(
      generatedWebArtifactsRoot,
      "tabs/experiments/norwegian-4x4/protocol.json",
    );

    await mkdir(path.join(generatedWebArtifactsRoot, "routes"), { recursive: true });
    await mkdir(path.dirname(protocolArtifactPath), { recursive: true });

    await writeFile(
      path.join(generatedWebArtifactsRoot, "routes/index.json"),
      JSON.stringify(getGeneratedHealthCommonsWebRouteIndex()),
      "utf8",
    );

    const protocol = JSON.parse(
      readFileSync(
        new URL("../../../packages/health-commons/generated/web/tabs/experiments/norwegian-4x4/protocol.json", import.meta.url),
        "utf8",
      ),
    ) as {
      protocolTips: string[];
    };

    await writeFile(protocolArtifactPath, JSON.stringify(protocol), "utf8");

    vi.resetModules();
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(generatedWebRoot);
    try {
      const { loadGeneratedExperimentProjection } = await import(
        "@/src/lib/health-commons/generated-experiment-artifacts"
      );

      const firstRead = loadGeneratedExperimentProjection("norwegian-4x4", "experiment.protocol");
      expect(firstRead?.protocolTips).toEqual(protocol.protocolTips);

      await writeFile(
        protocolArtifactPath,
        JSON.stringify({
          ...protocol,
          protocolTips: [
            "Fresh protocol tip from regenerated markdown.",
          ],
        }),
        "utf8",
      );

      const secondRead = loadGeneratedExperimentProjection("norwegian-4x4", "experiment.protocol");
      expect(secondRead?.protocolTips).toEqual([
        "Fresh protocol tip from regenerated markdown.",
      ]);
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("renders the same Finnish sauna research fields as the full detail model", async () => {
    const fullProtocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");
    if (!fullProtocol) {
      throw new Error("Expected the full Finnish sauna protocol.");
    }

    const element = await ExperimentResearchPage({
      params: Promise.resolve({
        experimentId: "murph-finnish-standard-3x-week",
      }),
    });
    const markup = renderToStaticMarkup(element);
    const experiment = mocks.researchTab.mock.calls.at(-1)?.[0]
      ?.experiment as ResearchTabExperiment;

    expect(experiment).toEqual(expect.objectContaining({
      id: "finnish-sauna",
      protocolKeepInMind: fullProtocol.protocolKeepInMind,
      researchStats: fullProtocol.researchStats,
      studies: fullProtocol.studies,
    }));
    expect(experiment.researchLandscape).toEqual(fullProtocol.researchLandscape
      ? {
          bottomLine: fullProtocol.researchLandscape.bottomLine,
          confidenceLabel: fullProtocol.researchLandscape.confidenceLabel,
          mainCaveat: fullProtocol.researchLandscape.mainCaveat,
          primaryClaim: fullProtocol.researchLandscape.primaryClaim,
        }
      : undefined);
    expect(experiment.researchGroups).toEqual(fullProtocol.researchGroups);
    expect(markup).toContain('data-experiment-id="finnish-sauna"');
    expect(markup).toContain(`data-study-count="${fullProtocol.studies.length}"`);
  });

  it("routes missing experiment research projections to notFound", async () => {
    await expect(
      ExperimentResearchPage({
        params: Promise.resolve({
          experimentId: "missing-health-commons-route",
        }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });

  it("routes hidden protocol variants to notFound even when a route index entry exists", async () => {
    await expect(
      ExperimentResearchPage({
        params: Promise.resolve({
          experimentId: "hydrolyzed-collagen-peptides",
        }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });
});
