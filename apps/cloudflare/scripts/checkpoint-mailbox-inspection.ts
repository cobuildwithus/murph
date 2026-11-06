import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readAssistantInputEvent, readHostedMailboxAssistantInputItemDetails } from "@murphai/assistant-engine";
import { hasCompleteAssistantAutoReplyTerminalEvidence, readAssistantAutoReplyTerminalEvidenceByEvidenceId } from "@murphai/assistant-engine/assistant-automation";
import { parseHostedPendingAssistantInputState, HOSTED_PENDING_ASSISTANT_INPUT_STATE_RELATIVE_PATH } from "@murphai/assistant-runtime";
import { assertAssistantStatePathHasNoSymlinks, parseVersionedJsonStateEnvelope, resolveAssistantStatePaths } from "@murphai/runtime-state/node";
import { isHostedWorkspaceSnapshotV2Ref, parseHostedWorkspaceReadResponse } from "@murphai/hosted-execution/parsers";
import { hostedWorkspaceSnapshotObjectKey } from "@murphai/hosted-execution/storage-paths";
import { HOSTED_RUNTIME_WORKSPACE_PATH } from "@murphai/hosted-execution/routes";
import { buildHostedWorkspaceSnapshotV2FingerprintSha256 as fingerprint, encodeHostedWorkspaceSnapshotV2DataKey,
  readHostedWorkspaceSnapshotV2DataKeyWrapRootKeyId, unwrapHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES } from "@murphai/hosted-execution/workspace-snapshot-v2";
import { fetchHostedExecutionWebControlPlaneResponse } from "../src/web-control-plane.ts";
import { readHostedWebCallbackSigningEnvironment } from "../src/web-callback-auth.ts";
import { createHostedR2PresignedGetUrl } from "../src/r2-presigned-url.ts";
import { fetchHostedWorkerRuntimeRootByRootKeyId, type HostedWorkerCryptoEnv } from "../src/hosted-crypto/runtime-crypto-context.ts";
import { restoreEncryptedWorkspaceSnapshotFromEncryptedStream } from "../src/workspace-snapshot-local.ts";
import { readRecoveryResponse, requireHostedRecoveryBoundary } from "./checkpoint-recovery-assessment.ts";
import type { RecoveryAssessmentRequest } from "./checkpoint-recovery-envelope.ts";

type Env = Readonly<Record<string, string | undefined>>;
type Inspection = NonNullable<RecoveryAssessmentRequest["mailboxInspection"]>;
const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_GROUP_IDS = 256;
function required(env: Env, key: string): string {
  const value = env[key];
  if (!value) throw new Error("missing_recovery_configuration");
  return value;
}

// Exact paths only. No directory enumeration, compaction, backfill or provider calls.
export async function inspectMailboxSnapshotRecords(input: { vaultRoot: string; items: Inspection["items"]; signal: AbortSignal }) {
  const paths = resolveAssistantStatePaths(input.vaultRoot);
  let totalBytes = 0;
  async function exists(file: string): Promise<boolean> {
    input.signal.throwIfAborted();
    await assertAssistantStatePathHasNoSymlinks(file);
    try {
      const stat = await lstat(file);
      totalBytes += stat.size;
      if (!stat.isFile() || stat.size > MAX_RECORD_BYTES || totalBytes > 16 * MAX_RECORD_BYTES) throw new Error("inspection_record_limit");
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  const pendingPath = path.join(input.vaultRoot, HOSTED_PENDING_ASSISTANT_INPUT_STATE_RELATIVE_PATH);
  const pendingPresent = await exists(pendingPath);
  const pendingEnvelope: unknown = pendingPresent ? JSON.parse(await readFile(pendingPath, "utf8")) : null;
  const pending = parsePending(pendingEnvelope);
  async function evidence(id: string) {
    const file = path.join(paths.assistantStateRoot, "auto-reply", "evidence", `${encodeURIComponent(id)}.json`);
    return await exists(file) ? readAssistantAutoReplyTerminalEvidenceByEvidenceId(input.vaultRoot, id) : null;
  }
  async function terminalSummary(inputId: string, captureId: string | null | undefined) {
    const byInput = await evidence(inputId);
    const byCapture = !byInput && captureId ? await evidence(captureId) : null;
    const terminal = byInput ?? byCapture;
    const group = terminal ? [...new Set(terminal.groupInputIds.length ? terminal.groupInputIds : terminal.groupCaptureIds)] : [];
    if (group.length > MAX_GROUP_IDS) throw new Error("inspection_group_limit");
    let missing = 0;
    for (const id of group) if (!await evidence(id)) missing++;
    const complete = terminal ? await hasCompleteAssistantAutoReplyTerminalEvidence({ inputId, captureId, vault: input.vaultRoot }) : false;
    return { terminalPresentByInput: byInput !== null, terminalPresentByCapture: byCapture !== null,
      terminalKind: terminal?.terminal.kind ?? null, terminalGroupSize: group.length,
      terminalGroupMissingCount: terminal ? missing : null, completeTerminalEvidence: complete };
  }
  async function inspectItem(item: Inspection["items"][number]) {
    input.signal.throwIfAborted();
    if (!item.inputId) return { laneSeq: item.laneSeq, inputSelectorPresent: false };
    const inputFile = path.join(paths.assistantStateRoot, "input-events", `${item.inputId}.json`);
    const event = await exists(inputFile) ? await readAssistantInputEvent({ inputId: item.inputId, paths }) : null;
    const mapping = (await readHostedMailboxAssistantInputItemDetails({ inputIds: [item.inputId], vault: input.vaultRoot, signal: input.signal })).get(item.inputId);
    return { laneSeq: item.laneSeq, inputSelectorPresent: true, eventPresent: event !== null,
      sourceMatchesLaneSeq: event ? event.sourceRef.kind === "hosted-mailbox" && event.sourceRef.lane === "conversation" && event.sourceRef.laneSeq === item.laneSeq : null,
      pendingIndexMembership: pending ? pending.state.inputIds.includes(item.inputId) : null,
      mappingPresent: !!mapping, mappingMatchesItem: mapping ? mapping.mailboxItemId === item.mailboxItemId : null,
      ...await terminalSummary(item.inputId, event?.projection.captureId) };
  }
  const rows = [];
  for (const item of input.items) rows.push(await inspectItem(item));
  return { pendingIndex: { present: pendingPresent, schemaVersion: pending?.version ?? null,
    backfilled: pending?.state.backfilled ?? null, inputCount: pending?.state.inputIds.length ?? null }, items: rows };
}

function parsePending(value: unknown) {
  if (value === null) return null;
  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  if (version !== 1 && version !== 2) throw new Error("inspection_pending_schema");
  const state = parseVersionedJsonStateEnvelope(value, { label: "inspection pending index", schemaVersion: version,
    schema: `murph.hosted-pending-assistant-inputs.v${version}`, parseValue: parseHostedPendingAssistantInputState });
  return { version, state };
}

export async function inspectCheckpointMailbox(env: Env, request: RecoveryAssessmentRequest, fetchImpl: typeof fetch = fetch) {
  requireHostedRecoveryBoundary(env);
  const inspection = request.mailboxInspection;
  if (env.RECOVERY_MODE !== "assess" || !inspection || request.partialRecovery) throw new Error("invalid_recovery_mode");
  const signal = AbortSignal.timeout(10 * 60_000);
  const boundedFetch: typeof fetch = (url, init) => fetchImpl(url, { ...init, redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
  const base = { baseUrl: "https://www.withmurph.ai", boundUserId: request.userId,
    callbackSigning: readHostedWebCallbackSigningEnvironment(env), timeoutMs: 30_000, fetchImpl: boundedFetch };
  async function readWorkspace() {
    if (Date.parse(request.expiresAt) <= Date.now()) throw new Error("recovery_request_expired");
    const response = await fetchHostedExecutionWebControlPlaneResponse({ ...base, method: "GET", path: HOSTED_RUNTIME_WORKSPACE_PATH });
    const { workspace } = parseHostedWorkspaceReadResponse(JSON.parse(Buffer.from(await readRecoveryResponse(response, 1024 * 1024)).toString("utf8")));
    if (!workspace || workspace.userId !== request.userId || workspace.version !== request.expectedWorkspaceVersion
      || !isHostedWorkspaceSnapshotV2Ref(workspace.snapshotRef) || fingerprint(workspace.snapshotRef) !== inspection!.snapshotFingerprint
      || Date.parse(workspace.snapshotRef.createdAt) > Date.parse(request.before)) throw new Error("recovery_workspace_changed");
    return { workspace, source: workspace.snapshotRef };
  }
  const { workspace, source } = await readWorkspace();
  if (source.userId !== request.userId || source.objectKey !== await hostedWorkspaceSnapshotObjectKey({ userId: request.userId, snapshotId: source.snapshotId })
    || readHostedWorkspaceSnapshotV2DataKeyWrapRootKeyId(source.encryption.wrappedDataKey) !== source.encryption.rootKeyId) throw new Error("inspection_snapshot_authority");
  const cryptoEnv: HostedWorkerCryptoEnv = {
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: required(env, "HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION"),
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: required(env, "HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM"),
    HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: env.HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: required(env, "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID"),
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: required(env, "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK"),
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON: env.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON,
    HOSTED_CRYPTO_ENV: required(env, "HOSTED_CRYPTO_ENV"), NODE_ENV: "production",
  };
  const root = await fetchHostedWorkerRuntimeRootByRootKeyId({ ...base, cryptoEnv, domain: "runtime", rootKeyId: source.encryption.rootKeyId, userId: request.userId });
  let scratch: string | undefined;
  let dataKey: Uint8Array | undefined;
  let encrypted: Uint8Array | undefined;
  try {
    const account = required(env, "CLOUDFLARE_ACCOUNT_ID");
    const bucket = required(env, "CF_BUNDLES_ENAM_BUCKET");
    if (!/^[a-f0-9]{32}$/.test(account) || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(bucket)) throw new Error("invalid_recovery_storage");
    dataKey = await unwrapHostedWorkspaceSnapshotV2DataKey({ aad: source.encryption.aad, rootKey: root.rootKey, wrappedDataKey: source.encryption.wrappedDataKey });
    const signed = await createHostedR2PresignedGetUrl({ environment: { accessKeyId: required(env, "HOSTED_R2_PRESIGN_ACCESS_KEY_ID"),
      secretAccessKey: required(env, "HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY"), bucketName: bucket, endpoint: `https://${account}.r2.cloudflarestorage.com` },
      key: source.objectKey, expiresSeconds: 60 });
    encrypted = await readRecoveryResponse(await boundedFetch(signed.url), HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES);
    scratch = await mkdtemp(path.join(tmpdir(), "murph-checkpoint-inspection-"));
    const durableRoot = path.join(scratch, "saved");
    async function* stream() { yield encrypted!; }
    await restoreEncryptedWorkspaceSnapshotFromEncryptedStream({ durableRoot, ref: source, signal,
      dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey), encryptedStream: stream() });
    const result = await inspectMailboxSnapshotRecords({ vaultRoot: path.join(durableRoot, "vault"), items: inspection.items, signal });
    await readWorkspace();
    signal.throwIfAborted();
    if (Date.parse(request.expiresAt) <= Date.now()) throw new Error("recovery_request_expired");
    return { schema: "murph.checkpoint-mailbox-inspection.v1", workspaceVersion: workspace.version,
      workspaceUnchanged: true, runtimeWoken: false, restorationPerformed: false, ...result };
  } finally {
    root.rootKey.fill(0); dataKey?.fill(0); encrypted?.fill(0);
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}
