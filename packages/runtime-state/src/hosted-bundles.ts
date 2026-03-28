import { createHash } from "node:crypto";
import path from "node:path";
import { mkdir } from "node:fs/promises";

import { resolveAssistantStatePaths } from "./assistant-state.ts";
import {
  restoreHostedBundleRoots,
  snapshotHostedBundleRoots,
  type HostedBundleArtifactRef,
  type HostedBundleArtifactRestoreInput,
  type HostedBundleArtifactSnapshotInput,
} from "./hosted-bundle.ts";

const WORKSPACE_ASSISTANT_ROOT = "assistant-state";
const WORKSPACE_OPERATOR_HOME_ROOT = "operator-home";
const LEGACY_AGENT_STATE_VAULT_RUNTIME_ROOT = "vault-runtime";
const RAW_ARTIFACT_EXTERNALIZE_THRESHOLD_BYTES = 256 * 1024;

export interface HostedWorkspaceArtifactPersistInput extends HostedBundleArtifactSnapshotInput {
  ref: HostedBundleArtifactRef;
}

export type HostedWorkspaceArtifactResolver = (
  input: HostedBundleArtifactRestoreInput,
) => Promise<Uint8Array | ArrayBuffer>;

export async function snapshotHostedExecutionContext(input: {
  artifactSink?: (input: HostedWorkspaceArtifactPersistInput) => Promise<void>;
  operatorHomeRoot?: string | null;
  vaultRoot: string;
}): Promise<{
  agentStateBundle: null;
  vaultBundle: Uint8Array;
}> {
  const vaultRoot = path.resolve(input.vaultRoot);
  const assistantStateRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
  const artifactSink = input.artifactSink;
  const vaultBundle = await snapshotHostedBundleRoots({
    externalizeFile: artifactSink
      ? (() => {
          const persistArtifact = artifactSink;
          return async (artifact) => {
            if (!shouldExternalizeWorkspaceArtifact(artifact)) {
              return null;
            }

            const ref = createHostedWorkspaceArtifactRef(artifact.bytes);
            await persistArtifact({
              ...artifact,
              ref,
            });
            return ref;
          };
        })()
      : undefined,
    kind: "vault",
    roots: [
      {
        root: vaultRoot,
        rootKey: "vault",
        shouldIncludeRelativePath(relativePath) {
          return shouldIncludeWorkspaceSnapshotVaultRelativePath(relativePath);
        },
      },
      {
        optional: true,
        root: assistantStateRoot,
        rootKey: WORKSPACE_ASSISTANT_ROOT,
      },
      ...(input.operatorHomeRoot
        ? [
            {
              optional: true,
              root: path.resolve(input.operatorHomeRoot),
              rootKey: WORKSPACE_OPERATOR_HOME_ROOT,
              shouldIncludeRelativePath(relativePath: string) {
                return shouldIncludeHostedOperatorHomeRelativePath(relativePath);
              },
            },
          ]
        : []),
    ],
  });

  if (vaultBundle === null) {
    throw new Error(`Hosted vault bundle could not be created for ${vaultRoot}.`);
  }

  return {
    agentStateBundle: null,
    vaultBundle,
  };
}

export async function restoreHostedExecutionContext(input: {
  agentStateBundle?: Uint8Array | ArrayBuffer | null;
  artifactResolver?: HostedWorkspaceArtifactResolver;
  vaultBundle?: Uint8Array | ArrayBuffer | null;
  workspaceRoot: string;
}): Promise<{
  assistantStateRoot: string;
  operatorHomeRoot: string;
  vaultRoot: string;
}> {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const vaultRoot = path.join(workspaceRoot, "vault");
  const assistantStateRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
  const operatorHomeRoot = path.join(workspaceRoot, "home");

  await mkdir(vaultRoot, { recursive: true });
  await mkdir(assistantStateRoot, { recursive: true });
  await mkdir(operatorHomeRoot, { recursive: true });

  if (input.vaultBundle) {
    await restoreHostedBundleRoots({
      artifactResolver: input.artifactResolver,
      bytes: input.vaultBundle,
      expectedKind: "vault",
      roots: {
        [WORKSPACE_ASSISTANT_ROOT]: assistantStateRoot,
        [WORKSPACE_OPERATOR_HOME_ROOT]: operatorHomeRoot,
        vault: vaultRoot,
      },
    });
  }

  if (input.agentStateBundle) {
    await restoreHostedBundleRoots({
      bytes: input.agentStateBundle,
      expectedKind: "agent-state",
      ignoredRoots: [LEGACY_AGENT_STATE_VAULT_RUNTIME_ROOT],
      roots: {
        [WORKSPACE_ASSISTANT_ROOT]: assistantStateRoot,
        [WORKSPACE_OPERATOR_HOME_ROOT]: operatorHomeRoot,
      },
    });
  }

  return {
    assistantStateRoot,
    operatorHomeRoot,
    vaultRoot,
  };
}

function shouldIncludeWorkspaceSnapshotVaultRelativePath(relativePath: string): boolean {
  return (
    !isDotGitRelativePath(relativePath)
    && !isEnvironmentRelativePath(relativePath)
    && !isExportPackRelativePath(relativePath)
    && !isEphemeralVaultRuntimeRelativePath(relativePath)
  );
}

function isDotGitRelativePath(relativePath: string): boolean {
  return relativePath === ".git" || relativePath.startsWith(`.git${path.posix.sep}`);
}

function isEnvironmentRelativePath(relativePath: string): boolean {
  return (
    path.posix.basename(relativePath) === ".env"
    || path.posix.basename(relativePath).startsWith(".env.")
  );
}

function isExportPackRelativePath(relativePath: string): boolean {
  return (
    relativePath === "exports/packs"
    || relativePath.startsWith(`exports/packs${path.posix.sep}`)
  );
}

function isEphemeralVaultRuntimeRelativePath(relativePath: string): boolean {
  if (!(relativePath === ".runtime" || relativePath.startsWith(`.runtime${path.posix.sep}`))) {
    return false;
  }

  const baseName = path.posix.basename(relativePath);
  return (
    relativePath.startsWith(`.runtime/tmp${path.posix.sep}`)
    || relativePath.startsWith(`.runtime/cache${path.posix.sep}`)
    || baseName === "stdout.log"
    || baseName === "stderr.log"
    || baseName.endsWith(".pid")
    || baseName.endsWith(".lock")
    || baseName.endsWith(".sock")
    || baseName.endsWith(".tmp")
  );
}

function shouldIncludeHostedOperatorHomeRelativePath(relativePath: string): boolean {
  return (
    relativePath === ".murph"
    || relativePath === ".murph/config.json"
  );
}

function shouldExternalizeWorkspaceArtifact(input: HostedBundleArtifactSnapshotInput): boolean {
  if (input.root !== "vault" || !input.path.startsWith(`raw${path.posix.sep}`)) {
    return false;
  }

  if (isDefinitelyBinaryRawArtifact(input.path)) {
    return true;
  }

  if (input.bytes.byteLength < RAW_ARTIFACT_EXTERNALIZE_THRESHOLD_BYTES) {
    return false;
  }

  return !isLikelyTextBytes(input.bytes);
}

function isDefinitelyBinaryRawArtifact(relativePath: string): boolean {
  const extension = path.posix.extname(relativePath).toLowerCase();
  return BINARY_RAW_ARTIFACT_EXTENSIONS.has(extension);
}

function isLikelyTextBytes(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.byteLength, 8 * 1024));

  for (const value of sample) {
    if (value === 0) {
      return false;
    }
  }

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

function createHostedWorkspaceArtifactRef(bytes: Uint8Array): HostedBundleArtifactRef {
  return {
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

const BINARY_RAW_ARTIFACT_EXTENSIONS = new Set([
  ".aac",
  ".avi",
  ".bmp",
  ".doc",
  ".docx",
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".m4a",
  ".mov",
  ".mp3",
  ".mp4",
  ".ogg",
  ".opus",
  ".pdf",
  ".png",
  ".tif",
  ".tiff",
  ".wav",
  ".webm",
  ".webp",
]);
