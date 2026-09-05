import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostedWorkspaceState } from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedWorkspaceSnapshotV2Aad,
  buildHostedWorkspaceSnapshotV2FingerprintSha256,
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import { collectHostedWorkspaceSnapshotArchivePlan } from "@murphai/runtime-state/node";

import { prepareHostedContainerWorkspaceRestore } from "../src/container-workspace-restore-preparation.ts";
import { resolveHostedRunnerWarmWorkspaceVaultRoot } from "../src/hosted-runner-warm-workspace.ts";
import { CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS } from "../src/internal-hosts.ts";
import type { HostedExecutionWorkspaceInvocationJobInput } from "../src/runner-job-transport.ts";
import {
  HOSTED_PROVIDER_EGRESS_TOKEN_HEADER,
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
} from "../src/runner-outbound/headers.ts";
import { HOSTED_RUNNER_WEB_CONTROL_ROUTES } from "../src/runtime-platform/web-control-transport.ts";
import { hostedWorkspaceSnapshotObjectKey } from "../src/storage-paths.ts";
import { createEncryptedWorkspaceSnapshotFile } from "../src/workspace-snapshot-local.ts";

const NOW = "2026-08-27T15:00:00.000Z";
const SNAPSHOT_NOTE = "Checkpointed synthetic workspace.\n";
const RESIDENT_NOTE = "Resident workspace must survive rejected restore.\n";
const MEDIA_BYTES = Buffer.from("Selected restore image bytes");
const MEDIA_ID = "a".repeat(64);
const MEDIA_PATH = "raw/captures/note/event_restore/attachment.png";
const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ));
});

describe("container workspace restore preparation", () => {
  it.each([true, false])(
    "restores encrypted bytes through the real composition (prepared: %s)",
    async (prepared) => {
      const fixture = await createFixture();
      const job = createJob(fixture, prepared);
      const requests = serveSnapshot(fixture);

      const preparation = await prepareHostedContainerWorkspaceRestore({
        job,
        signal: new AbortController().signal,
      });
      const result = await preparation.promise;

      expect(result.restored).toMatchObject({
        mode: "snapshot",
        restoreWasCold: true,
        vaultRoot: fixture.vaultRoot,
      });
      expect(result.workspaceRead.workspace).toEqual(fixture.workspace);
      expect(await readFile(path.join(preparation.vaultRoot, "note.md"), "utf8"))
        .toBe(SNAPSHOT_NOTE);
      await expect(stat(path.join(preparation.vaultRoot, "resident-only.md")))
        .rejects.toMatchObject({ code: "ENOENT" });
      for (const root of [
        preparation.vaultRoot,
        result.restored.assistantStateRoot,
        result.restored.operatorHomeRoot,
      ]) {
        expect((await stat(root)).mode & 0o777).toBe(0o700);
      }

      const controlRequests = requests.filter((request) => request.url !== fixture.getUrl);
      expect(controlRequests.map((request) => new URL(request.url).pathname).sort())
        .toEqual([
          HOSTED_RUNNER_WEB_CONTROL_ROUTES.workspaceRead.path,
          ...(prepared ? [] : [
            `/workspace-snapshots/${fixture.ref.snapshotId}/data-key/unwrap`,
            `/workspace-snapshots/${fixture.ref.snapshotId}/presign-get`,
          ]),
        ].sort());
      for (const request of controlRequests) {
        expect(request.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(job.request.userId);
        expect(request.headers.get(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)).toBe(job.request.attemptId);
        expect(request.headers.get(HOSTED_RUNTIME_LEASE_GENERATION_HEADER)).toBe(job.request.leaseGeneration);
        expect(request.headers.get(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER)).toBe(job.request.workspaceVersion);
        expect(request.headers.has(HOSTED_PROVIDER_EGRESS_TOKEN_HEADER)).toBe(false);
      }
      // Cold restore leaves media external; selected access uses the real adapter.
      await expect(stat(path.join(preparation.vaultRoot, MEDIA_PATH)))
        .rejects.toMatchObject({ code: "ENOENT" });
      await result.restored.materializeWorkspaceArtifacts([MEDIA_PATH]);
      expect(await readFile(path.join(preparation.vaultRoot, MEDIA_PATH))).toEqual(MEDIA_BYTES);
      expect(requests.filter((request) => new URL(request.url).pathname === `/media/${MEDIA_ID}`))
        .toHaveLength(1);

      const downloads = requests.filter((request) => request.url === fixture.getUrl);
      expect(downloads).toHaveLength(1);
      expect(downloads[0]?.method).toBe("GET");
      for (const header of [
        HOSTED_RUNNER_BOUND_USER_ID_HEADER,
        HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
        HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
        HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
        HOSTED_PROVIDER_EGRESS_TOKEN_HEADER,
      ]) {
        expect(downloads[0]?.headers.has(header)).toBe(false);
      }
    },
  );

  it.each([
    { patch: { version: "11" }, errorName: "HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError" },
    { patch: { userId: "member_other_workspace" }, errorName: "HostedWorkspaceRunnerUserMismatchError" },
  ])("preserves resident files when workspace admission rejects $errorName", async ({ patch, errorName }) => {
    const fixture = await createFixture();
    const requests = serveSnapshot(fixture, { ...fixture.workspace, ...patch });
    const preparation = await prepareHostedContainerWorkspaceRestore({
      job: createJob(fixture, true),
      signal: new AbortController().signal,
    });

    await expect(preparation.promise).rejects.toMatchObject({ name: errorName });
    expect(requests.map((request) => new URL(request.url).pathname))
      .toEqual([HOSTED_RUNNER_WEB_CONTROL_ROUTES.workspaceRead.path]);
    await expectResidentFiles(fixture);
  });

  it("preserves resident files when the selected encrypted snapshot is corrupted", async () => {
    const fixture = await createFixture();
    fixture.encryptedBytes[0] = fixture.encryptedBytes[0]! ^ 0xff;
    const requests = serveSnapshot(fixture);
    const preparation = await prepareHostedContainerWorkspaceRestore({
      job: createJob(fixture, true),
      signal: new AbortController().signal,
    });

    await expect(preparation.promise).rejects.toThrow(/authenticate data/u);
    expect(requests.some((request) => request.url === fixture.getUrl)).toBe(true);
    await expectResidentFiles(fixture);
  });
});

async function expectResidentFiles(fixture: Fixture): Promise<void> {
  expect(await readFile(path.join(fixture.vaultRoot, "note.md"), "utf8"))
    .toBe(RESIDENT_NOTE);
  expect(await readFile(path.join(fixture.vaultRoot, "resident-only.md"), "utf8"))
    .toBe(RESIDENT_NOTE);
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "container-restore-proof-"));
  temporaryRoots.push(temporaryRoot);
  const userId = `member_restore_${randomUUID()}`;
  const vaultRoot = resolveHostedRunnerWarmWorkspaceVaultRoot(userId);
  temporaryRoots.push(path.dirname(path.dirname(vaultRoot)));
  await mkdir(vaultRoot, { recursive: true });
  await writeFile(path.join(vaultRoot, "note.md"), RESIDENT_NOTE);
  await writeFile(path.join(vaultRoot, "resident-only.md"), RESIDENT_NOTE);
  const durableRoot = path.join(temporaryRoot, "source");
  const sourceVaultRoot = path.join(durableRoot, "vault");
  const operatorHomeRoot = path.join(durableRoot, "operator-home");
  await mkdir(sourceVaultRoot, { recursive: true });
  await mkdir(operatorHomeRoot, { recursive: true });
  await writeFile(path.join(sourceVaultRoot, "note.md"), SNAPSHOT_NOTE);
  const mediaRefsDirectory = path.join(sourceVaultRoot, ".runtime/operations/assistant");
  await mkdir(mediaRefsDirectory, { recursive: true });
  await writeFile(path.join(mediaRefsDirectory, "hosted-media-refs.json"), JSON.stringify({
    schema: "murph.hosted-media-refs.v1",
    entries: [{
      byteSize: MEDIA_BYTES.byteLength, expiresAt: null, mediaId: MEDIA_ID,
      mediaKind: "image", mimeType: "image/png", recordedAt: NOW,
      relativePath: MEDIA_PATH, sha256: createHash("sha256").update(MEDIA_BYTES).digest("hex"),
    }],
  }));
  const snapshotId = "snapshot_container_restore";
  const objectKey = await hostedWorkspaceSnapshotObjectKey({ snapshotId, userId });
  const aad = buildHostedWorkspaceSnapshotV2Aad({ objectKey, snapshotId, userId });
  const dataKey = encodeHostedWorkspaceSnapshotV2DataKey(
    Uint8Array.from({ length: 32 }, (_, index) => index + 1),
  );
  const archivePlan = await collectHostedWorkspaceSnapshotArchivePlan({
    durableRoot,
    operatorHomeRoot,
    vaultRoot: sourceVaultRoot,
  });
  const encrypted = await createEncryptedWorkspaceSnapshotFile({
    aad,
    archiveEntries: archivePlan.entries,
    dataKey,
    durableRoot,
    ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 10))
      .toString("base64url"),
    maxEncryptedBytes: 16 * 1024 * 1024,
    outputDir: path.join(temporaryRoot, "scratch"),
  });
  const ref: HostedWorkspaceSnapshotV2Ref = {
    archive: {
      compression: encrypted.compression,
      encryptedByteSize: encrypted.encryptedByteSize,
      encryptedObjectSha256: encrypted.encryptedObjectSha256,
      fileCount: encrypted.fileCount,
      format: "tar",
      plaintextArchiveSha256: encrypted.plaintextArchiveSha256,
      totalPlainBytes: encrypted.totalPlainBytes,
    },
    createdAt: NOW,
    encryption: {
      aad,
      ivBase64: encrypted.ivBase64,
      rootKeyId: "root_key_restore_test",
      scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
      wrappedDataKey: "wrapped_data_key_test",
    },
    objectKey,
    schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
    snapshotId,
    upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
    userId,
  };
  const workspace: HostedWorkspaceState = {
    checkpointedAt: NOW,
    createdAt: NOW,
    snapshotRef: ref,
    updatedAt: NOW,
    userId,
    version: "12",
  };
  const issuedAt = new Date().toISOString().replace(/[:-]/gu, "").replace(/\.\d{3}Z$/u, "Z");
  const getUrl = `https://r2.example.test/restore.enc?X-Amz-Date=${issuedAt}&X-Amz-Expires=3600`;
  return {
    dataKey,
    encryptedBytes: new Uint8Array(await readFile(encrypted.encryptedFilePath)),
    getUrl,
    ref,
    vaultRoot,
    workspace,
  };
}

function createJob(fixture: Fixture, prepared: boolean): HostedExecutionWorkspaceInvocationJobInput {
  return {
    kind: "workspace-invocation",
    ...(prepared ? {
      preparedSnapshotRestore: {
        dataKey: fixture.dataKey,
        getUrl: fixture.getUrl,
        snapshotFingerprint: buildHostedWorkspaceSnapshotV2FingerprintSha256(fixture.ref),
      },
    } : {}),
    request: {
      attemptId: "attempt_restore_preparation",
      leaseGeneration: "7",
      providerEgressToken: "synthetic-provider-egress-token",
      userId: fixture.workspace.userId,
      workspaceVersion: fixture.workspace.version,
    },
    runtime: { commitTimeoutMs: 4_321 },
  };
}

function serveSnapshot(fixture: Fixture, workspace = fixture.workspace): Request[] {
  const requests: Request[] = [];
  const workspaceUrl = new URL(
    HOSTED_RUNNER_WEB_CONTROL_ROUTES.workspaceRead.path,
    CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane,
  ).href;
  const snapshotBase = `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.workspaceSnapshotStore}/workspace-snapshots/${fixture.ref.snapshotId}`;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    if (request.url === `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.mediaStore}/media/${MEDIA_ID}`) {
      return new Response(MEDIA_BYTES);
    }
    if (request.url === workspaceUrl) {
      return Response.json({ fetchedAt: NOW, workspace });
    }
    if (request.url === `${snapshotBase}/data-key/unwrap`) {
      return Response.json({ dataKey: fixture.dataKey });
    }
    if (request.url === `${snapshotBase}/presign-get`) {
      return Response.json({
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        getUrl: fixture.getUrl,
      });
    }
    if (request.url === fixture.getUrl) {
      return new Response(fixture.encryptedBytes);
    }
    throw new Error("Unexpected request during container restore proof.");
  });
  return requests;
}
