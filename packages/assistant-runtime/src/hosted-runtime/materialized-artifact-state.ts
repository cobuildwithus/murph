import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  resolveAssistantStatePaths,
} from "@murphai/runtime-state/node";

const HOSTED_MATERIALIZED_ARTIFACT_STATE_SCHEMA =
  "murph.hosted-materialized-artifacts.v1";
const HOSTED_MATERIALIZED_ARTIFACT_STATE_FILE =
  "hosted-materialized-artifacts.json";

interface HostedMaterializedArtifactState {
  materializedArtifactPaths: string[];
  schema: typeof HOSTED_MATERIALIZED_ARTIFACT_STATE_SCHEMA;
}

export function resolveHostedMaterializedArtifactStateRelativePath(): string {
  return `.runtime/operations/assistant/${HOSTED_MATERIALIZED_ARTIFACT_STATE_FILE}`;
}

export async function readHostedMaterializedArtifactPaths(input: {
  vaultRoot: string;
}): Promise<Set<string>> {
  const state = await readHostedMaterializedArtifactStateBestEffort(input.vaultRoot);
  return new Set(state.materializedArtifactPaths);
}

export async function recordHostedMaterializedArtifactPaths(input: {
  materializedArtifactPaths: ReadonlySet<string>;
  vaultRoot: string;
}): Promise<void> {
  if (input.materializedArtifactPaths.size === 0) {
    return;
  }

  const existing = await readHostedMaterializedArtifactPaths({
    vaultRoot: input.vaultRoot,
  });
  for (const artifactPath of input.materializedArtifactPaths) {
    const normalized = normalizeHostedMaterializedArtifactPath(artifactPath);
    if (normalized) {
      existing.add(normalized);
    }
  }

  await writeHostedMaterializedArtifactState({
    materializedArtifactPaths: [...existing].sort(),
    schema: HOSTED_MATERIALIZED_ARTIFACT_STATE_SCHEMA,
  }, input.vaultRoot);
}

async function readHostedMaterializedArtifactStateBestEffort(
  vaultRoot: string,
): Promise<HostedMaterializedArtifactState> {
  try {
    const raw = await readFile(resolveHostedMaterializedArtifactStatePath(vaultRoot), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.schema !== HOSTED_MATERIALIZED_ARTIFACT_STATE_SCHEMA) {
      return createEmptyHostedMaterializedArtifactState();
    }
    const paths = Array.isArray(parsed.materializedArtifactPaths)
      ? parsed.materializedArtifactPaths
          .map((value) => normalizeHostedMaterializedArtifactPath(value))
          .filter((value): value is string => value !== null)
      : [];
    return {
      materializedArtifactPaths: [...new Set(paths)].sort(),
      schema: HOSTED_MATERIALIZED_ARTIFACT_STATE_SCHEMA,
    };
  } catch {
    return createEmptyHostedMaterializedArtifactState();
  }
}

async function writeHostedMaterializedArtifactState(
  state: HostedMaterializedArtifactState,
  vaultRoot: string,
): Promise<void> {
  const filePath = resolveHostedMaterializedArtifactStatePath(vaultRoot);
  await mkdir(path.dirname(filePath), {
    mode: 0o700,
    recursive: true,
  });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
}

function resolveHostedMaterializedArtifactStatePath(vaultRoot: string): string {
  return path.join(
    resolveAssistantStatePaths(path.resolve(vaultRoot)).assistantStateRoot,
    HOSTED_MATERIALIZED_ARTIFACT_STATE_FILE,
  );
}

function createEmptyHostedMaterializedArtifactState(): HostedMaterializedArtifactState {
  return {
    materializedArtifactPaths: [],
    schema: HOSTED_MATERIALIZED_ARTIFACT_STATE_SCHEMA,
  };
}

function normalizeHostedMaterializedArtifactPath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .trim()
    .replace(/\\/gu, "/")
    .replace(/\/+/gu, "/")
    .replace(/^\/+|\/+$/gu, "");
  if (
    !normalized
    || normalized.includes("../")
    || normalized.startsWith("../")
    || normalized.endsWith("/..")
  ) {
    return null;
  }
  const delimiterIndex = normalized.indexOf(":");
  if (delimiterIndex <= 0 || delimiterIndex >= normalized.length - 1) {
    return null;
  }
  const root = normalized.slice(0, delimiterIndex);
  if (root !== "vault" && root !== "operator-home") {
    return null;
  }
  return `${root}:${normalized.slice(delimiterIndex + 1)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
