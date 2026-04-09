import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  HostedWorkspaceArtifactPersistInput,
} from "@murphai/runtime-state/node";
import type {
  HostedAssistantDeliveryRecord,
} from "@murphai/hosted-execution";

import type {
  HostedRuntimeEffectsPort,
  HostedRuntimeArtifactStore,
} from "../src/hosted-runtime/platform.ts";

export const HOSTED_RUNTIME_EMAIL_CAPABILITY_ENV = {
  HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID: "acct_123",
  HOSTED_EMAIL_CLOUDFLARE_API_TOKEN: "cf-token",
  HOSTED_EMAIL_DOMAIN: "mail.example.test",
  HOSTED_EMAIL_LOCAL_PART: "assistant",
  HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
  TELEGRAM_BOT_TOKEN: "telegram-token",
} as const;

export async function createHostedRuntimeWorkspace(prefix: string) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), prefix));

  return {
    cleanup: async () => rm(workspaceRoot, { force: true, recursive: true }),
    operatorHomeRoot: path.join(workspaceRoot, "home"),
    vaultRoot: path.join(workspaceRoot, "vault"),
    workspaceRoot,
  };
}

export function createHostedRuntimeLauncherDirectories(root: string) {
  return {
    cacheRoot: path.join(root, "cache"),
    homeRoot: path.join(root, "home"),
    huggingFaceRoot: path.join(root, "hf-home"),
    tempRoot: path.join(root, "tmp"),
  };
}

export function createHostedRuntimeArtifactStoreStub(initialEntries?: Record<string, Uint8Array>): {
  artifactStore: HostedRuntimeArtifactStore;
  getCalls: string[];
  putCalls: Array<{
    bytes: Uint8Array;
    sha256: string;
  }>;
  storedBytesByHash: Map<string, Uint8Array>;
} {
  const storedBytesByHash = new Map<string, Uint8Array>(
    Object.entries(initialEntries ?? {}),
  );
  const getCalls: string[] = [];
  const putCalls: Array<{
    bytes: Uint8Array;
    sha256: string;
  }> = [];

  return {
    artifactStore: {
      async get(sha256) {
        getCalls.push(sha256);
        return storedBytesByHash.get(sha256) ?? null;
      },
      async put(input) {
        putCalls.push({
          bytes: input.bytes,
          sha256: input.sha256,
        });
        storedBytesByHash.set(input.sha256, input.bytes);
      },
    },
    getCalls,
    putCalls,
    storedBytesByHash,
  };
}

export function createHostedRuntimeEffectsPortStub(
  overrides: Partial<HostedRuntimeEffectsPort> = {},
): HostedRuntimeEffectsPort {
  return {
    async commit() {},
    async deletePreparedSideEffect() {},
    async readRawEmailMessage() {
      return null;
    },
    async readSideEffect(): Promise<HostedAssistantDeliveryRecord | null> {
      return null;
    },
    async sendEmail() {},
    async writeSideEffect(
      record: HostedAssistantDeliveryRecord,
    ): Promise<HostedAssistantDeliveryRecord> {
      return record;
    },
    ...overrides,
  };
}

export function createHostedWorkspaceArtifactPersistInput(input: {
  bytes: Uint8Array;
  path?: string;
  root?: string;
  sha256: string;
}): HostedWorkspaceArtifactPersistInput {
  const relativePath = input.path ?? "vault/raw/example.bin";
  return {
    absolutePath: path.join("/", relativePath),
    bytes: input.bytes,
    path: relativePath,
    ref: {
      byteSize: input.bytes.byteLength,
      sha256: input.sha256,
    },
    root: input.root ?? "vault",
  };
}
