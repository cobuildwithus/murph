import {
  EXPERIMENTS_DIRECTORY,
  EXPERIMENT_OUTCOMES_DIRECTORY,
} from "./vault-families.ts";

const EXPERIMENT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export type ExperimentStorageFileKind = "document" | "outcome" | "unsupported";

export function experimentDocumentRelativePath(slug: string): string {
  if (!EXPERIMENT_SLUG_PATTERN.test(slug)) {
    throw new TypeError("Experiment document slugs must use lowercase kebab-case.");
  }

  return `${EXPERIMENTS_DIRECTORY}/${slug}.md`;
}

export function classifyExperimentStorageFile(
  relativePath: string,
): ExperimentStorageFileKind {
  const segments = relativePath.split("/");

  if (
    segments.length === 3
    && segments[0] === "bank"
    && segments[1] === "experiments"
    && segments[2]?.endsWith(".md")
    && EXPERIMENT_SLUG_PATTERN.test(segments[2].slice(0, -3))
  ) {
    return "document";
  }

  if (
    segments.length === 4
    && `${segments[0]}/${segments[1]}/${segments[2]}` === EXPERIMENT_OUTCOMES_DIRECTORY
    && segments[3]?.length > ".json".length
    && segments[3].endsWith(".json")
  ) {
    return "outcome";
  }

  return "unsupported";
}

export function isExperimentDocumentRelativePath(relativePath: string): boolean {
  return classifyExperimentStorageFile(relativePath) === "document";
}

export function isExperimentOutcomeRelativePath(relativePath: string): boolean {
  return classifyExperimentStorageFile(relativePath) === "outcome";
}
