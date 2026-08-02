import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { hostedLocalCrossRepoCiRequirements } from
  "../packages/hosted-local-harness/src/cross-repo-ci.ts";
import {
  resolveHostedLocalE2eScenarios,
} from "../packages/hosted-local-harness/src/e2e.ts";

export interface HostedLocalCrossRepoCiCoverage {
  coveredScenarioNames: readonly string[];
  requiredScenarioNames: readonly string[];
}

export function readHostedLocalWorkflowScenarioSelections(
  workflowText: string,
): string[] {
  const selections: string[] = [];

  for (const line of workflowText.split(/\r?\n/u)) {
    const match = /^\s*scenarios:\s*([^#]*?)(?:\s+#.*)?$/u.exec(line);
    const value = match?.[1]?.trim() ?? "";
    if (!value) {
      continue;
    }

    selections.push(...value.split(/\s+/u));
  }

  return selections;
}

export function assertHostedLocalCrossRepoCiCoverage(input: {
  workflowPath?: string;
  workflowText: string;
}): HostedLocalCrossRepoCiCoverage {
  const workflowPath = input.workflowPath ?? "cross-repository workflow";
  const selectedNames = readHostedLocalWorkflowScenarioSelections(
    input.workflowText,
  );
  if (selectedNames.length === 0) {
    throw new Error(
      `${workflowPath} does not declare any hosted-local scenario matrix entries.`,
    );
  }

  const coveredScenarios = resolveHostedLocalE2eScenarios(selectedNames);
  const coveredScenarioNames = new Set(
    coveredScenarios.map((scenario) => scenario.name),
  );
  const resolvedRequirements = hostedLocalCrossRepoCiRequirements.map(
    (requirement) => ({
      ...requirement,
      resolvedScenario: resolveHostedLocalE2eScenarios([
        requirement.scenario,
      ])[0],
    }),
  );
  const missing = resolvedRequirements.filter(
    ({ resolvedScenario }) =>
      resolvedScenario === undefined
      || !coveredScenarioNames.has(resolvedScenario.name),
  );

  if (missing.length > 0) {
    throw new Error([
      `${workflowPath} is missing required hosted-local scenarios:`,
      ...missing.map(
        ({ reason, scenario }) => `- ${scenario}: ${reason}`,
      ),
      "Add each scenario to a matrix `scenarios:` entry instead of weakening the public requirement manifest.",
    ].join("\n"));
  }

  return {
    coveredScenarioNames: [...coveredScenarioNames].sort(),
    requiredScenarioNames: resolvedRequirements
      .flatMap(({ resolvedScenario }) =>
        resolvedScenario ? [resolvedScenario.name] : []
      )
      .sort(),
  };
}

async function main(): Promise<void> {
  const workflowPath = process.argv[2]?.trim() ?? "";
  if (!workflowPath) {
    throw new Error(
      "Usage: check-hosted-local-cross-repo-ci.ts <workflow-yaml-path>",
    );
  }

  const workflowText = await readFile(workflowPath, "utf8");
  const coverage = assertHostedLocalCrossRepoCiCoverage({
    workflowPath,
    workflowText,
  });
  process.stdout.write(
    `Verified ${coverage.requiredScenarioNames.length} required hosted-local scenarios in ${workflowPath}.\n`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
