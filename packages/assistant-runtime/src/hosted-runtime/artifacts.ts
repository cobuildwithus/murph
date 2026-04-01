import type {
  HostedBundleArtifactRef,
  HostedWorkspaceArtifactPersistInput,
} from "@murphai/runtime-state/node";

import { readHostedRunnerCommitTimeoutMs } from "./callbacks.ts";

export function createHostedArtifactResolver(input: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
}) {
  const cache = new Map<string, Promise<Uint8Array>>();

  return async ({ ref }: { ref: HostedBundleArtifactRef }) => {
    if (!cache.has(ref.sha256)) {
      cache.set(ref.sha256, fetchHostedArtifact(input, ref));
    }

    return await cache.get(ref.sha256)!;
  };
}

export function createHostedArtifactUploadSink(input: {
  artifactsBaseUrl: string;
  fetchImpl?: typeof fetch;
  knownArtifactHashes: ReadonlySet<string>;
  timeoutMs: number | null;
}) {
  const uploadedHashes = new Set<string>();

  return async (artifact: HostedWorkspaceArtifactPersistInput) => {
    if (input.knownArtifactHashes.has(artifact.ref.sha256) || uploadedHashes.has(artifact.ref.sha256)) {
      return;
    }

    await uploadHostedArtifact(input, artifact);
    uploadedHashes.add(artifact.ref.sha256);
  };
}

function buildHostedRunnerArtifactUrl(baseUrl: string, sha256: string): URL {
  return new URL(`/objects/${encodeURIComponent(sha256)}`, baseUrl);
}

async function fetchHostedArtifact(
  input: {
    baseUrl: string;
    fetchImpl?: typeof fetch;
    timeoutMs: number | null;
  },
  ref: HostedBundleArtifactRef,
): Promise<Uint8Array> {
  const response = await (input.fetchImpl ?? fetch)(buildHostedRunnerArtifactUrl(input.baseUrl, ref.sha256).toString(), {
    method: "GET",
    signal: AbortSignal.timeout(readHostedRunnerCommitTimeoutMs(input.timeoutMs)),
  });

  if (!response.ok) {
    throw new Error(`Hosted runner artifact fetch failed for ${ref.sha256} with HTTP ${response.status}.`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function uploadHostedArtifact(
  input: {
    artifactsBaseUrl: string;
    fetchImpl?: typeof fetch;
    timeoutMs: number | null;
  },
  artifact: HostedWorkspaceArtifactPersistInput,
): Promise<void> {
  const uploadBytes = new Uint8Array(artifact.bytes.byteLength);
  uploadBytes.set(artifact.bytes);
  const response = await (input.fetchImpl ?? fetch)(
    buildHostedRunnerArtifactUrl(input.artifactsBaseUrl, artifact.ref.sha256).toString(),
    {
      body: uploadBytes.buffer,
      headers: {
        "content-type": "application/octet-stream",
      },
      method: "PUT",
      signal: AbortSignal.timeout(readHostedRunnerCommitTimeoutMs(input.timeoutMs)),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Hosted runner artifact upload failed for ${artifact.ref.sha256} with HTTP ${response.status}.`,
    );
  }
}
