import path from "node:path";
import { mkdir } from "node:fs/promises";

import { resolveAssistantStatePaths } from "./assistant-state.js";
import {
  restoreHostedBundleRoots,
  snapshotHostedBundleRoots,
} from "./hosted-bundle.js";
import { RUNTIME_ROOT_RELATIVE_PATH } from "./runtime-paths.js";

const AGENT_STATE_ASSISTANT_ROOT = "assistant-state";
const AGENT_STATE_OPERATOR_HOME_ROOT = "operator-home";
const AGENT_STATE_VAULT_RUNTIME_ROOT = "vault-runtime";

export async function snapshotHostedExecutionContext(input: {
  operatorHomeRoot?: string | null;
  vaultRoot: string;
}): Promise<{
  agentStateBundle: Uint8Array | null;
  vaultBundle: Uint8Array;
}> {
  const vaultRoot = path.resolve(input.vaultRoot);
  const assistantStateRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
  const vaultBundle = await snapshotHostedBundleRoots({
    kind: "vault",
    roots: [
      {
        root: vaultRoot,
        rootKey: "vault",
        shouldIncludeRelativePath(relativePath) {
          return !shouldSkipVaultRelativePath(relativePath);
        },
      },
    ],
  });

  if (vaultBundle === null) {
    throw new Error(`Hosted vault bundle could not be created for ${vaultRoot}.`);
  }

  return {
    agentStateBundle: await snapshotHostedBundleRoots({
      kind: "agent-state",
      roots: [
        {
          optional: true,
          root: assistantStateRoot,
          rootKey: AGENT_STATE_ASSISTANT_ROOT,
        },
        {
          optional: true,
          root: path.join(vaultRoot, RUNTIME_ROOT_RELATIVE_PATH),
          rootKey: AGENT_STATE_VAULT_RUNTIME_ROOT,
        },
        ...(input.operatorHomeRoot
          ? [
              {
                optional: true,
                root: path.resolve(input.operatorHomeRoot),
                rootKey: AGENT_STATE_OPERATOR_HOME_ROOT,
                shouldIncludeRelativePath(relativePath: string) {
                  return (
                    relativePath === ".healthybob"
                    || relativePath === ".healthybob/config.json"
                  );
                },
              },
            ]
          : []),
      ],
    }),
    vaultBundle,
  };
}

export async function restoreHostedExecutionContext(input: {
  agentStateBundle?: Uint8Array | ArrayBuffer | null;
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
      bytes: input.vaultBundle,
      expectedKind: "vault",
      roots: {
        vault: vaultRoot,
      },
    });
  }

  if (input.agentStateBundle) {
    await restoreHostedBundleRoots({
      bytes: input.agentStateBundle,
      expectedKind: "agent-state",
      roots: {
        [AGENT_STATE_ASSISTANT_ROOT]: assistantStateRoot,
        [AGENT_STATE_OPERATOR_HOME_ROOT]: operatorHomeRoot,
        [AGENT_STATE_VAULT_RUNTIME_ROOT]: path.join(vaultRoot, RUNTIME_ROOT_RELATIVE_PATH),
      },
    });
  }

  return {
    assistantStateRoot,
    operatorHomeRoot,
    vaultRoot,
  };
}

function shouldSkipVaultRelativePath(relativePath: string): boolean {
  return (
    relativePath === ".git"
    || relativePath.startsWith(`.git${path.posix.sep}`)
    || relativePath === ".runtime"
    || relativePath.startsWith(`.runtime${path.posix.sep}`)
    || relativePath === "exports/packs"
    || relativePath.startsWith(`exports/packs${path.posix.sep}`)
    || path.posix.basename(relativePath) === ".env"
    || path.posix.basename(relativePath).startsWith(".env.")
  );
}
