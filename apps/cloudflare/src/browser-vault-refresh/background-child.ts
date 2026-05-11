import { stdin } from "node:process";
import { pathToFileURL } from "node:url";

import {
  parseHostedBrowserVaultReplicaPublishResponse,
  parseHostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH,
} from "@murphai/hosted-execution/routes";

import {
  CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS,
} from "../internal-hosts.ts";
import {
  createCloudflareHostedRuntimeFetch,
} from "../runtime-platform.ts";
import {
  refreshBrowserVaultReplicaFromWarmVault,
} from "./refresher.ts";

const BROWSER_VAULT_BACKGROUND_PROXY_ATTEMPTS = 3;
const BROWSER_VAULT_BACKGROUND_PROXY_RETRY_MS = 150;

interface BrowserVaultBackgroundRefreshInput {
  internalWorkerProxyToken: string;
  localInternalProxyBaseUrl: string | null;
  userId: string;
  vaultRoot: string;
}

if (isBrowserVaultBackgroundChildEntrypoint()) {
  void runBrowserVaultBackgroundChildCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export async function runBrowserVaultBackgroundChildCli(): Promise<void> {
  const input = parseBrowserVaultBackgroundRefreshInput(
    JSON.parse(await readStdinUtf8()),
  );
  const fetchImpl = createCloudflareHostedRuntimeFetch(
    input.userId,
    input.internalWorkerProxyToken,
    input.localInternalProxyBaseUrl,
    fetch,
  );

  await refreshBrowserVaultReplicaFromWarmVault({
    generatedAt: new Date().toISOString(),
    port: {
      async publishRef(publishInput) {
        const response = await fetchBrowserVaultBackgroundWithRetry(
          fetchImpl,
          new URL(
            HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH,
            `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane}/`,
          ),
          {
            body: JSON.stringify(publishInput),
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            method: "POST",
          },
        );
        if (!response.ok && response.status !== 409) {
          throw new Error(`Browser-vault background publish failed with HTTP ${response.status}.`);
        }
        return parseHostedBrowserVaultReplicaPublishResponse(await response.json());
      },
      async write(writeInput) {
        const response = await fetchBrowserVaultBackgroundWithRetry(
          fetchImpl,
          new URL("/replicas", `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.browserVaultReplicaStore}/`),
          {
            body: JSON.stringify(writeInput),
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            method: "POST",
          },
        );
        if (!response.ok) {
          throw new Error(`Browser-vault background write failed with HTTP ${response.status}.`);
        }
        const payload = await response.json() as { replicaRef?: unknown };
        const replicaRef = parseHostedBrowserVaultReplicaRef(
          payload.replicaRef,
          "Browser-vault background write response.replicaRef",
        );
        if (!replicaRef) {
          throw new TypeError("Browser-vault background write response.replicaRef must not be null.");
        }
        return replicaRef;
      },
    },
    vaultRoot: input.vaultRoot,
  });
}

function isBrowserVaultBackgroundChildEntrypoint(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function parseBrowserVaultBackgroundRefreshInput(value: unknown): BrowserVaultBackgroundRefreshInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Browser-vault background refresh input must be an object.");
  }
  const record = value as Partial<BrowserVaultBackgroundRefreshInput>;
  return {
    internalWorkerProxyToken: requireNonEmptyString(
      record.internalWorkerProxyToken,
      "internalWorkerProxyToken",
    ),
    localInternalProxyBaseUrl: typeof record.localInternalProxyBaseUrl === "string"
      && record.localInternalProxyBaseUrl.trim().length > 0
      ? record.localInternalProxyBaseUrl
      : null,
    userId: requireNonEmptyString(record.userId, "userId"),
    vaultRoot: requireNonEmptyString(record.vaultRoot, "vaultRoot"),
  };
}

export async function fetchBrowserVaultBackgroundWithRetry(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= BROWSER_VAULT_BACKGROUND_PROXY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(input, init);
      if (response.ok || (response.status !== 401 && response.status !== 404)) {
        return response;
      }
      lastResponse = response;
    } catch (error) {
      if (!isRetryableBackgroundProxyRace(error)) {
        throw error;
      }
      lastError = error;
    }

    if (attempt < BROWSER_VAULT_BACKGROUND_PROXY_ATTEMPTS) {
      await sleep(BROWSER_VAULT_BACKGROUND_PROXY_RETRY_MS);
    }
  }

  if (lastResponse) {
    return lastResponse;
  }
  throw lastError ?? new Error("Browser-vault background proxy request failed.");
}

function isRetryableBackgroundProxyRace(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as {
    responseStatus?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  return record.responseStatus === 401
    || record.status === 401
    || record.statusCode === 401;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`Browser-vault background refresh input.${label} must be a non-empty string.`);
  }
  return value;
}

async function readStdinUtf8(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
