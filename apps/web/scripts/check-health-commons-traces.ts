import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PHASE_PRODUCTION_BUILD } from "next/constants";

import { resolveHostedWebDistDir } from "../next-artifacts";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDirName = resolveHostedWebDistDir(PHASE_PRODUCTION_BUILD);
const distDir = path.join(appRoot, distDirName);
const forbiddenGeneratedCatalogPattern =
  /(?:^|[/\\])packages[/\\]health-commons[/\\]generated[/\\]catalog\.json$/u;
const forbiddenGeneratedCatalogSubstring =
  /packages[/\\]health-commons[/\\]generated[/\\]catalog\.json/u;
const forbiddenRouteBundleSubstring =
  /packages[/\\]health-commons[/\\]generated[/\\]web[/\\]bundles[/\\]/u;
const allowedMeasurementMethodRouteBundleSubstring =
  /packages[/\\]health-commons[/\\]generated[/\\]web[/\\]bundles[/\\]measurement_method[/\\]/u;
const requiredExperimentTraceArtifacts = [
  "packages/health-commons/generated/web/routes/index.json",
  "packages/health-commons/generated/web/shell/experiments/finnish-sauna.json",
  "packages/health-commons/generated/web/tabs/experiments/finnish-sauna/protocol.json",
  "packages/health-commons/generated/web/tabs/experiments/finnish-sauna/research.json",
  "packages/health-commons/generated/web/tabs/experiments/finnish-sauna/results-public.json",
] as const;
const requiredBrowseTraceArtifacts = [
  "packages/health-commons/generated/web/browse/experiments.json",
] as const;
const requiredBiomarkerOverviewTraceArtifacts = [
  "packages/health-commons/generated/web/routes/index.json",
  "packages/health-commons/generated/web/shell/biomarkers/hrv-rmssd.json",
  "packages/health-commons/generated/web/pages/biomarkers/hrv-rmssd/overview.json",
] as const;
const requiredBiomarkerResearchTraceArtifacts = [
  "packages/health-commons/generated/web/routes/index.json",
  "packages/health-commons/generated/web/shell/biomarkers/hrv-rmssd.json",
  "packages/health-commons/generated/web/pages/biomarkers/hrv-rmssd/research.json",
] as const;
const requiredMeasurementMethodTraceArtifacts = [
  "packages/health-commons/generated/web/routes/index.json",
  "packages/health-commons/generated/web/bundles/measurement_method/home-standardized-photo-roi-analysis.json",
] as const;
const requiredGoalBrowseTraceArtifacts = [
  "packages/health-commons/generated/web/browse/goals.json",
] as const;
const requiredGoalDetailTraceArtifacts = [
  ...requiredGoalBrowseTraceArtifacts,
  "packages/health-commons/generated/web/routes/index.json",
  "packages/health-commons/generated/web/pages/goals/improve-deep-sleep.json",
] as const;
const requiredGoalContactTraceArtifacts = requiredGoalBrowseTraceArtifacts;
const goalIndexWebhookGeneratedArtifactByteBudget = 640 * 1024;
const goalIndexWebhookTracePolicies = [
  {
    label: "Linq webhook",
    traceSuffix:
      "server/app/api/hosted-onboarding/linq/webhook/route.js.nft.json",
  },
  {
    label: "Telegram webhook",
    traceSuffix:
      "server/app/api/hosted-onboarding/telegram/webhook/route.js.nft.json",
  },
] as const;
const healthCommonsGeneratedWebMarker =
  "packages/health-commons/generated/web/";

interface GoalIndexWebhookTraceState {
  artifacts: Map<string, number>;
  found: boolean;
}

if (!existsSync(distDir)) {
  throw new Error(
    `Cannot check Health Commons traces because apps/web/${distDirName} does not exist. Run next build first.`,
  );
}

const traceFiles = listFiles(distDir).filter((file) => file.endsWith(".nft.json"));
const violations: string[] = [];
const experimentTraceArtifacts = new Set<string>();
const browseTraceArtifacts = new Set<string>();
const biomarkerOverviewTraceArtifacts = new Set<string>();
const biomarkerResearchTraceArtifacts = new Set<string>();
const measurementMethodTraceArtifacts = new Set<string>();
const goalBrowseTraceArtifacts = new Set<string>();
const goalDetailTraceArtifacts = new Set<string>();
const goalContactTraceArtifacts = new Set<string>();
const goalIndexWebhookTraceStates: Map<string, GoalIndexWebhookTraceState> = new Map(
  goalIndexWebhookTracePolicies.map((policy) => [
    policy.traceSuffix,
    { artifacts: new Map<string, number>(), found: false },
  ]),
);

for (const traceFile of traceFiles) {
  const trace = JSON.parse(readFileSync(traceFile, "utf8")) as unknown;
  const files = readTraceFiles(trace);
  const relativeTraceFile = path.relative(appRoot, traceFile).replace(/\\/gu, "/");
  const isExperimentDetailTrace = relativeTraceFile.includes(
    "server/app/(dashboard)/experiments/[experimentId]/",
  );
  const isExperimentBrowseTrace = relativeTraceFile.endsWith(
    "server/app/(dashboard)/experiments/page.js.nft.json",
  );
  const isBiomarkerOverviewTrace = relativeTraceFile.endsWith(
    "server/app/(dashboard)/biomarkers/[biomarkerId]/page.js.nft.json",
  );
  const isBiomarkerResearchTrace = relativeTraceFile.endsWith(
    "server/app/(dashboard)/biomarkers/[biomarkerId]/research/page.js.nft.json",
  );
  const isMeasurementMethodTrace = relativeTraceFile.includes(
    "server/app/measurement-methods/[measurementMethodId]/",
  );
  const isGoalBrowseTrace = relativeTraceFile.endsWith(
    "server/app/goals/page.js.nft.json",
  );
  const isGoalDetailTrace = relativeTraceFile.endsWith(
    "server/app/goals/[goalId]/page.js.nft.json",
  );
  const isGoalContactTrace = relativeTraceFile.endsWith(
    "server/app/api/goals/contact/route.js.nft.json",
  );
  const goalIndexWebhookTracePolicy = goalIndexWebhookTracePolicies.find((policy) =>
    relativeTraceFile.endsWith(policy.traceSuffix)
  );
  const goalIndexWebhookTraceState = goalIndexWebhookTracePolicy
    ? goalIndexWebhookTraceStates.get(goalIndexWebhookTracePolicy.traceSuffix)
    : undefined;
  if (goalIndexWebhookTraceState) {
    goalIndexWebhookTraceState.found = true;
  }

  for (const tracedFile of files) {
    const normalizedTracedFile = tracedFile.replace(/\\/gu, "/");
    const generatedWebArtifact = generatedWebArtifactPath(normalizedTracedFile);
    if (
      forbiddenGeneratedCatalogPattern.test(normalizedTracedFile) ||
      forbiddenGeneratedCatalogSubstring.test(normalizedTracedFile) ||
      (isExperimentDetailTrace && forbiddenRouteBundleSubstring.test(normalizedTracedFile)) ||
      (
        isMeasurementMethodTrace
        && forbiddenRouteBundleSubstring.test(normalizedTracedFile)
        && !allowedMeasurementMethodRouteBundleSubstring.test(normalizedTracedFile)
      ) ||
      (
        generatedWebArtifact !== null
        && (
          (isGoalBrowseTrace && !isAllowedGoalBrowseArtifact(generatedWebArtifact))
          || (isGoalDetailTrace && !isAllowedGoalDetailArtifact(generatedWebArtifact))
          || (isGoalContactTrace && !isAllowedGoalBrowseArtifact(generatedWebArtifact))
          || (
            goalIndexWebhookTracePolicy !== undefined
            && !isAllowedGoalBrowseArtifact(generatedWebArtifact)
          )
        )
      )
    ) {
      violations.push(`${relativeTraceFile} -> ${tracedFile}`);
    }

    if (isExperimentDetailTrace) {
      for (const requiredArtifact of requiredExperimentTraceArtifacts) {
        if (normalizedTracedFile.endsWith(requiredArtifact)) {
          experimentTraceArtifacts.add(requiredArtifact);
        }
      }
    }

    if (isExperimentBrowseTrace) {
      for (const requiredArtifact of requiredBrowseTraceArtifacts) {
        if (normalizedTracedFile.endsWith(requiredArtifact)) {
          browseTraceArtifacts.add(requiredArtifact);
        }
      }
    }

    if (isBiomarkerOverviewTrace) {
      for (const requiredArtifact of requiredBiomarkerOverviewTraceArtifacts) {
        if (normalizedTracedFile.endsWith(requiredArtifact)) {
          biomarkerOverviewTraceArtifacts.add(requiredArtifact);
        }
      }
    }

    if (isBiomarkerResearchTrace) {
      for (const requiredArtifact of requiredBiomarkerResearchTraceArtifacts) {
        if (normalizedTracedFile.endsWith(requiredArtifact)) {
          biomarkerResearchTraceArtifacts.add(requiredArtifact);
        }
      }
    }

    if (isMeasurementMethodTrace) {
      for (const requiredArtifact of requiredMeasurementMethodTraceArtifacts) {
        if (normalizedTracedFile.endsWith(requiredArtifact)) {
          measurementMethodTraceArtifacts.add(requiredArtifact);
        }
      }
    }

    if (isGoalBrowseTrace) {
      collectRequiredArtifacts(
        normalizedTracedFile,
        requiredGoalBrowseTraceArtifacts,
        goalBrowseTraceArtifacts,
      );
    }

    if (isGoalDetailTrace) {
      collectRequiredArtifacts(
        normalizedTracedFile,
        requiredGoalDetailTraceArtifacts,
        goalDetailTraceArtifacts,
      );
    }

    if (isGoalContactTrace) {
      collectRequiredArtifacts(
        normalizedTracedFile,
        requiredGoalContactTraceArtifacts,
        goalContactTraceArtifacts,
      );
    }

    if (goalIndexWebhookTraceState && generatedWebArtifact !== null) {
      const absoluteTracedFile = path.resolve(path.dirname(traceFile), tracedFile);
      goalIndexWebhookTraceState.artifacts.set(
        generatedWebArtifact,
        statSync(absoluteTracedFile).size,
      );
    }
  }
}

for (const policy of goalIndexWebhookTracePolicies) {
  const state = goalIndexWebhookTraceStates.get(policy.traceSuffix);
  if (!state?.found) {
    violations.push(`${policy.label} trace is missing: ${policy.traceSuffix}`);
    continue;
  }

  const missingArtifacts = requiredGoalBrowseTraceArtifacts.filter((artifact) =>
    !state.artifacts.has(generatedWebArtifactPath(artifact) ?? "")
  );
  for (const artifact of missingArtifacts) {
    violations.push(`${policy.label} is missing required Goal index artifact: ${artifact}`);
  }

  const artifactBytes = [...state.artifacts.values()].reduce(
    (total, bytes) => total + bytes,
    0,
  );
  if (state.artifacts.size > 1) {
    violations.push(
      `${policy.label} traces ${state.artifacts.size} generated web artifacts; budget is 1.`,
    );
  }
  if (artifactBytes > goalIndexWebhookGeneratedArtifactByteBudget) {
    violations.push(
      `${policy.label} traces ${artifactBytes} generated web artifact bytes; budget is ${goalIndexWebhookGeneratedArtifactByteBudget}.`,
    );
  }
}

if (violations.length > 0) {
  throw new Error([
    "Health Commons Next trace boundary check failed.",
    "Public experiment and Goal routes must use only their web projections; measurement routes may trace only measurement-method route bundles.",
    ...violations.map((violation) => `- ${violation}`),
  ].join("\n"));
}

const missingExperimentArtifacts = requiredExperimentTraceArtifacts.filter((artifact) =>
  !experimentTraceArtifacts.has(artifact)
);
const missingBrowseArtifacts = requiredBrowseTraceArtifacts.filter((artifact) =>
  !browseTraceArtifacts.has(artifact)
);
const missingBiomarkerOverviewArtifacts = requiredBiomarkerOverviewTraceArtifacts.filter((artifact) =>
  !biomarkerOverviewTraceArtifacts.has(artifact)
);
const missingBiomarkerResearchArtifacts = requiredBiomarkerResearchTraceArtifacts.filter((artifact) =>
  !biomarkerResearchTraceArtifacts.has(artifact)
);
const missingMeasurementMethodArtifacts = requiredMeasurementMethodTraceArtifacts.filter((artifact) =>
  !measurementMethodTraceArtifacts.has(artifact)
);
const missingGoalBrowseArtifacts = requiredGoalBrowseTraceArtifacts.filter((artifact) =>
  !goalBrowseTraceArtifacts.has(artifact)
);
const missingGoalDetailArtifacts = requiredGoalDetailTraceArtifacts.filter((artifact) =>
  !goalDetailTraceArtifacts.has(artifact)
);
const missingGoalContactArtifacts = requiredGoalContactTraceArtifacts.filter((artifact) =>
  !goalContactTraceArtifacts.has(artifact)
);

if (
  missingExperimentArtifacts.length > 0 ||
  missingBrowseArtifacts.length > 0 ||
  missingBiomarkerOverviewArtifacts.length > 0 ||
  missingBiomarkerResearchArtifacts.length > 0 ||
  missingMeasurementMethodArtifacts.length > 0 ||
  missingGoalBrowseArtifacts.length > 0 ||
  missingGoalDetailArtifacts.length > 0 ||
  missingGoalContactArtifacts.length > 0
) {
  throw new Error([
    "Health Commons generated web projections are missing from Next build traces.",
    "Public Health Commons routes need compact generated/web artifacts at runtime.",
    ...missingExperimentArtifacts.map((artifact) => `- missing experiment detail trace artifact: ${artifact}`),
    ...missingBrowseArtifacts.map((artifact) => `- missing experiment browse trace artifact: ${artifact}`),
    ...missingBiomarkerOverviewArtifacts.map((artifact) => `- missing biomarker overview trace artifact: ${artifact}`),
    ...missingBiomarkerResearchArtifacts.map((artifact) => `- missing biomarker research trace artifact: ${artifact}`),
    ...missingMeasurementMethodArtifacts.map((artifact) => `- missing measurement method trace artifact: ${artifact}`),
    ...missingGoalBrowseArtifacts.map((artifact) => `- missing Goal browse trace artifact: ${artifact}`),
    ...missingGoalDetailArtifacts.map((artifact) => `- missing Goal detail trace artifact: ${artifact}`),
    ...missingGoalContactArtifacts.map((artifact) => `- missing Goal contact trace artifact: ${artifact}`),
  ].join("\n"));
}

console.log(`Checked ${traceFiles.length} Next trace files for Health Commons catalog leakage.`);

function listFiles(root: string): string[] {
  const entries = readdirSync(root);
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(root, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      files.push(...listFiles(absolutePath));
      continue;
    }

    if (stats.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

function readTraceFiles(trace: unknown): string[] {
  if (!trace || typeof trace !== "object" || !("files" in trace)) {
    return [];
  }

  const files = (trace as { files?: unknown }).files;

  return Array.isArray(files)
    ? files.filter((file): file is string => typeof file === "string")
    : [];
}

function collectRequiredArtifacts(
  tracedFile: string,
  requiredArtifacts: readonly string[],
  collectedArtifacts: Set<string>,
): void {
  for (const requiredArtifact of requiredArtifacts) {
    if (tracedFile.endsWith(requiredArtifact)) {
      collectedArtifacts.add(requiredArtifact);
    }
  }
}

function generatedWebArtifactPath(tracedFile: string): string | null {
  const markerIndex = tracedFile.lastIndexOf(healthCommonsGeneratedWebMarker);
  return markerIndex === -1
    ? null
    : tracedFile.slice(markerIndex + healthCommonsGeneratedWebMarker.length);
}

function isAllowedGoalBrowseArtifact(artifactPath: string): boolean {
  return artifactPath === "browse/goals.json";
}

function isAllowedGoalDetailArtifact(artifactPath: string): boolean {
  return isAllowedGoalBrowseArtifact(artifactPath)
    || artifactPath === "routes/index.json"
    || artifactPath.startsWith("pages/goals/");
}
