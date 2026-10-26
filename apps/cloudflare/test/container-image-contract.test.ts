import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import {
  buildHostedWranglerDeployConfig,
} from "../scripts/deploy-automation/wrangler-config.ts";
const hostedRunnerProductModelSlugs = [
  "gpt-6.1-terra",
  "gpt-6.1-sol",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6-astra",
  "gpt-5.6-sol",
  "gpt-5.6-luna",
] as const;

function createDeployEnvironment() {
  return {
    allowedRunnerSecretKeys: null,
    bundlesBucketName: "bundles",
    bundlesPreviewBucketName: "bundles-preview",
    platformEnvelopeKeyId: "v1",
    compatibilityDate: "2026-03-27",
    containerInstanceType: {
      disk_mb: 6000,
      memory_mib: 6144,
      vcpu: 2,
    },
    containerMaxInstances: 1000,
    logHeadSamplingRate: 1,
    maxEventAttempts: "3",
    retryDelayMs: "30000",
    runnerCommitTimeoutMs: "45000",
    runnerReadyTimeoutMs: "20000",
    legacyStandbyContainerMaxInstances: 0,
    traceHeadSamplingRate: 0.1,
    webControlTimeoutMs: "30000",
    workerName: "murph-hosted",
    workerVars: {
      HOSTED_R2_PRESIGN_BUCKET_NAME: "bundles",
    },
  }
}

describe("hosted runner container image contract", () => {
  it("keeps base-image publication trusted and deploy secrets outside the image", async () => {
    const [baseDockerfile, finalDockerfile, workflow] = await Promise.all([
      readFile(new URL("../../../Dockerfile.cloudflare-hosted-runner-base", import.meta.url), "utf8"),
      readFile(new URL("../../../Dockerfile.cloudflare-hosted-runner", import.meta.url), "utf8"),
      readFile(new URL("../../../.github/workflows/cloudflare-runner-base-image.yml", import.meta.url), "utf8"),
    ]);

    expect(workflow).toContain("permissions:\n  contents: read\n  packages: write");
    expect(workflow).toContain("if: ${{ github.ref == 'refs/heads/main' && github.ref_protected }}");
    expect(workflow).not.toContain("pull_request:");
    for (const dockerfile of [baseDockerfile, finalDockerfile]) {
      expect(dockerfile).not.toContain("worker-secrets.json");
      expect(dockerfile).not.toContain("wrangler.generated.jsonc");
    }
    expect(baseDockerfile).toContain("git apply --check /tmp/codex-public-live.patch");
    expect(baseDockerfile).toContain("sha256sum /opt/codex/codex-resources/bwrap");
    expect(baseDockerfile).toContain("export CODEX_BWRAP_SHA256=");
  });

  it("publishes exactly the product Codex models with Flex and mixed Code Mode", async () => {
    const finalDockerfile = await readFile(
      new URL("../../../Dockerfile.cloudflare-hosted-runner", import.meta.url),
      "utf8",
    );
    const { patchFilter, standardFilter, validationFilter } = readFinalImageCodexModelCatalogJqFilters(finalDockerfile);
    const stockCatalogWithoutFlex: CodexModelCatalog = {
      models: [
        { slug: "gpt-6.1-sol", context_window: 272_000, service_tiers: [{ id: "priority", name: "Priority" }] },
        { slug: "gpt-6-sol", context_window: 272_000, service_tiers: [{ id: "priority", name: "Priority" }] },
        { slug: "gpt-6-luna", context_window: 272_000, service_tiers: [{ id: "priority", name: "Priority" }] },
        {
          slug: "gpt-6-astra",
          context_window: 272_000,
          service_tiers: [{ id: "priority", name: "Priority" }],
        },
        {
          slug: "gpt-5.5",
          service_tiers: [{ id: "priority", name: "Priority" }],
        },
        {
          slug: "gpt-5.4-mini",
          service_tiers: [{ id: "auto", name: "Auto" }],
        },
        {
          description: "Flagship agentic coding model for complex professional work.",
          display_name: "GPT-5.6-Sol",
          slug: "gpt-5.6-sol",
          service_tiers: [{ id: "priority", name: "Priority" }],
          tool_mode: "code_mode_only",
        },
        {
          description: "Balanced agentic coding model for everyday work.",
          display_name: "GPT-5.6-Terra",
          slug: "gpt-5.6-terra",
          service_tiers: [{ id: "priority", name: "Priority" }],
          tool_mode: "code_mode_only",
        },
        {
          description: "Fast, cost-efficient agentic coding model.",
          display_name: "GPT-5.6-Luna",
          slug: "gpt-5.6-luna",
          service_tiers: [{ id: "priority", name: "Priority" }],
          tool_mode: "code_mode_only",
        },
      ],
    };

    const patchedCatalogJson = runJqFilter(patchFilter, stockCatalogWithoutFlex);
    const patchedCatalog = parseCodexModelCatalogJson(patchedCatalogJson);

    const standardCatalog = parseCodexModelCatalogJson(runJqFilter(standardFilter, patchedCatalog));
    expect(readCodexModelSlugs(standardCatalog)).toEqual([
      "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-6.1-terra",
    ]);
    expect(standardCatalog.models).toEqual(patchedCatalog.models.filter((model) => model.slug !== "gpt-6-astra"));
    expect(finalDockerfile).toContain('"${MURPH_HOSTED_CODEX_MODEL_CATALOG_JSON}.astra"');

    expect(readCodexModelSlugs(patchedCatalog).sort()).toEqual([...hostedRunnerProductModelSlugs].sort());
    for (const slug of hostedRunnerProductModelSlugs) {
      expect(readCodexModelServiceTierIds(patchedCatalog, slug)).toEqual(["priority", "flex"]);
      expect(readCodexModel(patchedCatalog, slug).tool_mode).toBe("code_mode");
    }
    expect(readCodexModel(patchedCatalog, "gpt-5.6-sol")).toMatchObject({
      description: "Flagship agentic coding model for complex professional work.",
      display_name: "GPT-5.6-Sol",
    });
    expect(readCodexModelSlugs(patchedCatalog)).not.toContain("gpt-5.6-terra");
    expect(readCodexModel(patchedCatalog, "gpt-5.6-luna")).toMatchObject({
      description: "Fast, cost-efficient agentic coding model.",
      display_name: "GPT-5.6-Luna",
    });
    expect(runJqFilter(validationFilter, patchedCatalog, { slurp: true }).trim()).toBe("true");
    const legacyLinuxCatalog = parseCodexModelCatalogJson(runJqFilter(patchFilter, {
      models: stockCatalogWithoutFlex.models.filter((model) => model.slug !== "gpt-6-astra"),
    }));
    expect(readCodexModelSlugs(legacyLinuxCatalog)).not.toContain("gpt-6-astra");
    expect(runJqFilter(validationFilter, legacyLinuxCatalog, { slurp: true }).trim()).toBe("false");
    expect(runJqFilter(validationFilter, {
      models: patchedCatalog.models.map((model) => model.slug === "gpt-6-astra"
        ? { ...model, context_window: 1_050_000 } : model),
    }, { slurp: true }).trim()).toBe("false");

    expect(runJqFilter(
      validationFilter,
      `${patchedCatalogJson}\n${patchedCatalogJson}`,
      { slurp: true },
    ).trim()).toBe("false");

    const repatchedCatalog = parseCodexModelCatalogJson(
      runJqFilter(patchFilter, patchedCatalog),
    );
    const repatchedTargetTierIds = readCodexModelServiceTierIds(repatchedCatalog, "gpt-6-sol");
    const twicePatchedCatalog = parseCodexModelCatalogJson(
      runJqFilter(patchFilter, repatchedCatalog),
    );

    expect(repatchedTargetTierIds.filter((tierId) => tierId === "flex")).toHaveLength(1);
    for (const slug of hostedRunnerProductModelSlugs) {
      expect(readCodexModelServiceTierIds(twicePatchedCatalog, slug).filter((tierId) => tierId === "flex"))
        .toHaveLength(1);
    }
    expect(runJqFilter(validationFilter, repatchedCatalog, { slurp: true }).trim()).toBe("true");
    expect(runJqFilter(validationFilter, {
      models: patchedCatalog.models.filter((model) => model.slug !== "gpt-6-sol"),
    }, { slurp: true }).trim()).toBe("false");
    expect(runJqFilter(validationFilter, {
      models: [
        ...patchedCatalog.models,
        { slug: "gpt-5.5", service_tiers: [{ id: "priority", name: "Priority" }] },
      ],
    }, { slurp: true }).trim()).toBe("false");
    expect(runJqFilter(validationFilter, {
      models: patchedCatalog.models.map((model) =>
        model.slug === "gpt-6-sol"
          ? { ...model, tool_mode: "code_mode_only" }
          : model
      ),
    }, { slurp: true }).trim()).toBe("false");
  });

  it("validates native product entries and the official Terra launch supplement", async () => {
    const finalDockerfile = await readFile(
      new URL("../../../Dockerfile.cloudflare-hosted-runner", import.meta.url),
      "utf8",
    );
    const { patchFilter, standardFilter, validationFilter } = readFinalImageCodexModelCatalogJqFilters(finalDockerfile);
    const nativeCatalogJson = execFileSync(
      fileURLToPath(new URL("../../../packages/assistant-engine/node_modules/.bin/codex", import.meta.url)),
      ["debug", "models", "--bundled"],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, timeout: 30_000 },
    );
    const nativeCatalog = parseCodexModelCatalogJson(nativeCatalogJson);
    const terraCatalog = parseCodexModelCatalogJson(await readFile(new URL("../codex-model-catalog.terra.json", import.meta.url), "utf8"));
    const productCatalog = parseCodexModelCatalogJson(runJqFilter(patchFilter, nativeCatalog));
    expect(runJqFilter(validationFilter, productCatalog, { slurp: true }).trim()).toBe("true");
    for (const slug of hostedRunnerProductModelSlugs) {
      expect(readCodexModel(productCatalog, slug)).toMatchObject({
        ...readCodexModel(slug === "gpt-6.1-terra" ? terraCatalog : nativeCatalog, slug),
        service_tiers: expect.any(Array),
        tool_mode: "code_mode",
      });
    }
    expect(readCodexModelSlugs(parseCodexModelCatalogJson(runJqFilter(standardFilter, productCatalog))).sort())
      .toEqual(["gpt-5.6-luna", "gpt-5.6-sol", "gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol", "gpt-6.1-terra"]);
  });

  it("keeps rendered container builds app-local with SSH disabled", () => {
    const rendered = buildHostedWranglerDeployConfig(createDeployEnvironment());
    const [container] = rendered.containers as Array<Record<string, unknown>>;

    expect(rendered.compatibility_flags).toContain("enable_request_signal");
    expect(container).toMatchObject({
      image: "../../../Dockerfile.cloudflare-hosted-runner",
      image_build_context: "..",
      instance_type: { disk_mb: 6000, memory_mib: 6144, vcpu: 2 },
      max_instances: 1000,
      ssh: { enabled: false },
    });
    expect(container).not.toHaveProperty("authorized_keys");
  });

  it("keeps only runner bundle artifacts from .deploy in the app-local Docker context", async () => {
    const dockerignore = await readFile(new URL("../.dockerignore", import.meta.url), "utf8");

    expect(dockerignore).toContain("**");
    expect(dockerignore).toContain("!codex-model-catalog.terra.json");
    expect(dockerignore).toContain("!.deploy/");
    expect(dockerignore).toContain("!.deploy/runner-bundle/");
    expect(dockerignore).toContain("!.deploy/runner-bundle/**");
    expect(dockerignore).toContain("!.deploy/runner-smoke-bundle/");
    expect(dockerignore).toContain("!.deploy/runner-smoke-bundle/**");
    expect(dockerignore).not.toContain("!apps/cloudflare/.deploy/wrangler.generated.jsonc");
    expect(dockerignore).not.toContain("!apps/cloudflare/.deploy/worker-secrets.json");
  });
});

type CodexModelCatalog = {
  models: Array<Record<string, unknown> & {
    slug: string;
    service_tiers?: Array<{
      id: string;
      name?: string;
      description?: string;
    }>;
  }>;
};

function readFinalImageCodexModelCatalogJqFilters(dockerfile: string): {
  patchFilter: string;
  standardFilter: string;
  validationFilter: string;
} {
  const patchMatch = new RegExp(
    String.raw`\|\s+jq '([^']+)'\s+\\\s*\n\s*> /tmp/murph-codex-model-catalog\.openai-flex\.json`,
    "u",
  ).exec(dockerfile);
  const validationMatch = new RegExp(
    String.raw`&& jq -s -e '([^']+)' /tmp/murph-codex-model-catalog\.openai-flex\.json >/dev/null`,
    "u",
  ).exec(dockerfile);

  const standardMatch = /&& jq '([^']+)' \/tmp\/murph-codex-model-catalog\.openai-flex\.json > \/tmp\/murph-codex-model-catalog\.standard\.json/u.exec(dockerfile);
  if (patchMatch === null || validationMatch === null || standardMatch === null) {
    throw new Error("Final image Codex model catalog patch or validation jq filter is missing");
  }

  return {
    patchFilter: `${/jq --slurpfile terra \/tmp\/codex-model-catalog\.terra\.json '([^']+)'/u.exec(dockerfile)?.[1] ?? "."} | ${patchMatch[1]}`,
    standardFilter: standardMatch[1],
    validationFilter: validationMatch[1],
  };
}

function runJqFilter(
  filter: string,
  input: CodexModelCatalog | string,
  options: { slurp?: boolean } = {},
): string {
  return execFileSync("jq", [
    ...(options.slurp === true ? ["-s"] : []),
    "--slurpfile", "terra", fileURLToPath(new URL("../codex-model-catalog.terra.json", import.meta.url)),
    filter,
  ], {
    encoding: "utf8",
    input: typeof input === "string" ? input : JSON.stringify(input),
  });
}

function parseCodexModelCatalogJson(catalogJson: string): CodexModelCatalog {
  const catalog = JSON.parse(catalogJson) as CodexModelCatalog;

  if (!Array.isArray(catalog.models)) {
    throw new Error("Codex model catalog JSON must contain a models array");
  }

  return catalog;
}

function readCodexModelServiceTierIds(catalog: CodexModelCatalog, slug: string): string[] {
  return catalog.models.find((model) => model.slug === slug)?.service_tiers?.map((tier) => tier.id) ?? [];
}

function readCodexModel(catalog: CodexModelCatalog, slug: string): Record<string, unknown> {
  const model = catalog.models.find((candidate) => candidate.slug === slug);
  if (!model) {
    throw new Error(`Codex model catalog is missing ${slug}`);
  }
  return model;
}

function readCodexModelSlugs(catalog: CodexModelCatalog): string[] {
  return catalog.models.map((model) => model.slug);
}
