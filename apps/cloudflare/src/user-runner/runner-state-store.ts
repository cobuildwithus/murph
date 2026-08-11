import {
  deriveHostedExecutionErrorCode,
} from "@murphai/hosted-execution";

import { ensureRunnerStateSchema } from "./runner-state-schema.js";
import {
  createDefaultRunnerMetaRow,
  normalizeIsoDateOrNull,
  normalizeNonNegativeInteger,
  projectRunnerStateRecord,
  readRunnerRuntimeProcessingMode,
  readWriteFenceKind,
  type RunnerMetaRow,
} from "./runner-state-helpers.js";
import {
  type DurableObjectStateLike,
  type RunnerRuntimeProcessingMode,
  type RunnerWriteFenceKind,
  type RunnerStateRecord,
} from "./types.js";

export interface RunnerWriteFenceToken {
  attemptId: string;
  expiresAt: string | null;
  generation: string;
  kind: RunnerWriteFenceKind;
  leaseGeneration: string;
  processingMode: RunnerRuntimeProcessingMode;
  providerEgressToken: string | null;
  runnerContainerName: string | null;
  startedAt: string;
  userId: string;
  workspaceVersion: string | null;
}

export function runnerWriteFenceTokensMatch(
  current: RunnerWriteFenceToken | null,
  expected: RunnerWriteFenceToken,
): boolean {
  return runnerWriteFenceIdentityMatches(current, expected)
    && current?.workspaceVersion === expected.workspaceVersion;
}

export function runnerWriteFenceIdentityMatches(
  current: RunnerWriteFenceToken | null,
  expected: RunnerWriteFenceToken,
): boolean {
  return current !== null
    && current.attemptId === expected.attemptId
    && current.generation === expected.generation
    && current.kind === expected.kind
    && current.userId === expected.userId;
}

export class RunnerWriteFenceAlreadyActiveError extends Error {
  readonly record: RunnerStateRecord;

  constructor(record: RunnerStateRecord) {
    super("Hosted runner write fence is already active.");
    this.name = "RunnerWriteFenceAlreadyActiveError";
    this.record = record;
  }
}

export interface RunnerWriteFenceValidationResult {
  owns: boolean;
  record: RunnerStateRecord | null;
}

export type RunnerProviderEgressTokenValidationRejectReason =
  | "missing_provider_egress_token"
  | "missing_runner_state"
  | "missing_write_fence"
  | "provider_egress_token_mismatch"
  | "write_fence_mismatch";

export type RunnerProviderEgressCredentialValidationRejectReason =
  | "missing_runner_state"
  | "missing_write_fence"
  | "provider_egress_not_allowed"
  | "runner_container_mismatch"
  | "write_fence_mismatch";

export type RunnerProviderEgressTokenValidationResult =
  | {
      owns: false;
      reason: RunnerProviderEgressTokenValidationRejectReason;
      record?: RunnerStateRecord;
    }
  | {
      attemptId: string;
      customInferenceEnvelope?: string;
      leaseGeneration: string;
      owns: true;
      platformAiUsageAllowed?: boolean;
      record: RunnerStateRecord;
      userId: string;
      workspaceVersion: string | null;
    };

export type RunnerProviderEgressCredentialValidationResult =
  | {
      owns: false;
      reason: RunnerProviderEgressCredentialValidationRejectReason;
      record?: RunnerStateRecord;
    }
  | {
      attemptId: string;
      leaseGeneration: string;
      owns: true;
      platformAiUsageAllowed?: boolean;
      record: RunnerStateRecord;
      userId: string;
      workspaceVersion: string | null;
    };

const RUNNER_PROVIDER_EGRESS_CREDENTIAL_PROVIDER_KINDS = new Set<string>([
  "exa",
  "mapbox",
  "murph_data_api",
  "openai",
  "venice",
  "workers_ai_transcribe",
]);

export class RunnerStateStore {
  private userId: string | null = null;

  constructor(
    private readonly state: DurableObjectStateLike,
  ) {
    ensureRunnerStateSchema(this.sql);
  }

  async bindUser(userId: string): Promise<string> {
    const meta = this.selectMetaRowSync();

    if (meta) {
      if (meta.user_id !== userId) {
        throw new Error("Hosted runner Durable Object is already bound to a different user.");
      }

      this.userId = userId;
      return userId;
    }

    this.insertMetaRowSync(createDefaultRunnerMetaRow(userId));
    this.userId = userId;
    return userId;
  }

  async readState(): Promise<RunnerStateRecord> {
    return this.readStateSync();
  }

  async deleteStateForUser(userId: string): Promise<{ deleted: boolean }> {
    const meta = this.selectMetaRowSync();

    if (meta && meta.user_id !== userId) {
      throw new Error("Hosted runner Durable Object is bound to a different user.");
    }

    if (!meta) {
      this.userId = null;
      // Absence is the desired state. Account deletion is retried from a
      // durable web-owned receipt, so a replay after success must converge.
      return { deleted: true };
    }

    this.sql.exec("DELETE FROM runner_meta WHERE singleton = 1");
    this.userId = null;
    return { deleted: true };
  }

  async assertStateForUser(userId: string): Promise<void> {
    const meta = this.selectMetaRowSync();

    if (meta && meta.user_id !== userId) {
      throw new Error("Hosted runner Durable Object is bound to a different user.");
    }
  }

  async reserveRunnerContainerStopTargetForShellPrewarm(input: {
    runnerContainerName: string;
    userId: string;
  }): Promise<boolean> {
    await this.bindUser(input.userId);
    const meta = this.requireMetaRowSync();
    if (meta.active_attempt_id) {
      return false;
    }

    const requestedRunnerContainerName = requireRunnerContainerName(
      input.runnerContainerName,
    );
    const existingRunnerContainerName = normalizeRunnerContainerNameOrNull(
      meta.active_runner_container_name,
    );
    if (
      existingRunnerContainerName
      && existingRunnerContainerName !== requestedRunnerContainerName
    ) {
      return false;
    }
    if (existingRunnerContainerName === requestedRunnerContainerName) {
      return true;
    }

    meta.active_runner_container_name = requestedRunnerContainerName;
    this.writeMetaRowSync(meta);
    return true;
  }

  async beginWriteFence(input: {
    processingMode?: RunnerRuntimeProcessingMode | null;
    runnerContainerName: string;
    userId: string;
  }): Promise<RunnerWriteFenceToken> {
    const providerEgressToken = createProviderEgressToken();
    const providerEgressTokenHash = await hashProviderEgressToken(providerEgressToken);

    await this.bindUser(input.userId);

    const meta = this.requireMetaRowSync();
    if (this.readWriteFenceTokenSync(meta)) {
      throw new RunnerWriteFenceAlreadyActiveError(this.readStateFromMetaSync(meta));
    }

    const nextGeneration = normalizeNonNegativeInteger(meta.active_generation) + 1;
    const startedAt = new Date().toISOString();
    const attemptId = createRuntimeWriteAttemptId();
    const kind: RunnerWriteFenceKind = "runtime";
    const processingMode = readRunnerRuntimeProcessingMode(input.processingMode);

    meta.active_attempt_id = attemptId;
    meta.active_generation = nextGeneration;
    meta.active_kind = kind;
    meta.active_provider_egress_token_hash = providerEgressTokenHash;
    meta.active_custom_inference_envelope = null;
    meta.active_platform_ai_allowed = null;
    meta.active_reason = processingMode;
    meta.active_runner_container_name = requireRunnerContainerName(input.runnerContainerName);
    meta.active_started_at = startedAt;
    meta.active_workspace_version = null;
    this.writeMetaRowSync(meta);

    return {
      attemptId,
      expiresAt: null,
      generation: nextGeneration.toString(),
      kind,
      leaseGeneration: nextGeneration.toString(),
      processingMode,
      providerEgressToken,
      runnerContainerName: meta.active_runner_container_name,
      startedAt,
      userId: input.userId,
      workspaceVersion: null,
    };
  }

  async bindWriteFenceInvocationFacts(input: {
    customInferenceEnvelope: string | null;
    platformAiUsageAllowed: boolean | null;
    processingMode?: RunnerRuntimeProcessingMode | null;
    token: RunnerWriteFenceToken;
    workspaceVersion: string;
  }): Promise<RunnerWriteFenceToken> {
    const meta = this.requireMetaRowSync();
    if (!this.hasWriteFenceTokenSync(meta, input.token)) {
      throw new Error("Hosted runner write fence is stale.");
    }

    meta.active_workspace_version = requireWorkspaceVersion(input.workspaceVersion);
    meta.active_custom_inference_envelope = normalizeCustomInferenceEnvelopeOrNull(
      input.customInferenceEnvelope,
    );
    meta.active_platform_ai_allowed = input.platformAiUsageAllowed === null
      ? null
      : input.platformAiUsageAllowed
        ? 1
        : 0;
    if (input.processingMode !== undefined) {
      meta.active_reason = readRunnerRuntimeProcessingMode(input.processingMode);
    }
    this.writeMetaRowSync(meta);
    return {
      ...input.token,
      processingMode: readRunnerRuntimeProcessingMode(meta.active_reason),
      workspaceVersion: meta.active_workspace_version,
    };
  }

  async bindWriteFenceWorkspaceVersion(input: {
    token: RunnerWriteFenceToken;
    workspaceVersion: string;
  }): Promise<RunnerWriteFenceToken> {
    return await this.bindWriteFenceInvocationFacts({
      customInferenceEnvelope: null,
      platformAiUsageAllowed: null,
      token: input.token,
      workspaceVersion: input.workspaceVersion,
    });
  }

  async clearWriteFenceAfterCompletion(input: {
    finishedAt?: string | null;
    token: RunnerWriteFenceToken;
  }): Promise<{
    completed: boolean;
    record: RunnerStateRecord;
  }> {
    const meta = this.requireMetaRowSync();
    if (!this.clearWriteFenceTokenSync(meta, input.token)) {
      return {
        completed: false,
        record: this.readStateFromMetaSync(meta),
      };
    }
    meta.failure_count = 0;
    meta.last_error_at = null;
    meta.last_error_code = null;
    meta.last_invocation_at = input.finishedAt ?? new Date().toISOString();
    this.writeMetaRowSync(meta);

    return {
      completed: true,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async clearWriteFenceIdentityAfterCompletion(input: {
    attemptId: string;
    finishedAt?: string | null;
    generation: string;
    userId: string;
  }): Promise<{
    completed: boolean;
    record: RunnerStateRecord;
  }> {
    const meta = this.requireMetaRowSync();
    if (
      meta.active_attempt_id !== input.attemptId
      || normalizeNonNegativeInteger(meta.active_generation).toString() !== input.generation
      || meta.user_id !== input.userId
    ) {
      return {
        completed: false,
        record: this.readStateFromMetaSync(meta),
      };
    }

    this.clearActiveRunMetaSync(meta);
    meta.last_invocation_at = input.finishedAt ?? new Date().toISOString();
    this.writeMetaRowSync(meta);
    return {
      completed: true,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async clearWriteFenceForReplacement(input: {
    attemptId: string;
    error?: unknown;
    finishedAt?: string | null;
    generation: string;
    userId: string;
  }): Promise<{
    cleared: boolean;
    record: RunnerStateRecord;
  }> {
    const meta = this.requireMetaRowSync();
    if (
      meta.active_attempt_id !== input.attemptId
      || normalizeNonNegativeInteger(meta.active_generation).toString() !== input.generation
      || meta.user_id !== input.userId
    ) {
      return {
        cleared: false,
        record: this.readStateFromMetaSync(meta),
      };
    }

    this.clearActiveRunMetaSync(meta);
    if (input.error !== undefined) {
      meta.failure_count = normalizeNonNegativeInteger(meta.failure_count) + 1;
      meta.last_error_at = normalizeIsoDateOrNull(input.finishedAt ?? null)
        ?? new Date().toISOString();
      meta.last_error_code = deriveHostedExecutionErrorCode(input.error);
    }
    this.writeMetaRowSync(meta);
    return {
      cleared: true,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async clearWriteFenceAfterTransportFailure(input: {
    error: unknown;
    finishedAt?: string | null;
    token: RunnerWriteFenceToken;
  }): Promise<{
    failed: boolean;
    record: RunnerStateRecord;
  }> {
    const meta = this.requireMetaRowSync();
    if (!this.clearWriteFenceTokenSync(meta, input.token)) {
      return {
        failed: false,
        record: this.readStateFromMetaSync(meta),
      };
    }
    const finishedAt = input.finishedAt ?? new Date().toISOString();
    meta.last_error_at = finishedAt;
    meta.last_error_code = deriveHostedExecutionErrorCode(input.error);
    meta.failure_count = normalizeNonNegativeInteger(meta.failure_count) + 1;
    this.writeMetaRowSync(meta);

    return {
      failed: true,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async clearWriteFenceForUserControl(userId: string): Promise<{
    attemptId: string | null;
    cleared: boolean;
    runnerContainerName: string | null;
  }> {
    const meta = this.selectMetaRowSync();
    if (meta && meta.user_id !== userId) {
      throw new Error("Hosted runner Durable Object is bound to a different user.");
    }

    if (!meta || !meta.active_attempt_id) {
      return {
        attemptId: null,
        cleared: false,
        runnerContainerName: normalizeRunnerContainerNameOrNull(
          meta?.active_runner_container_name,
        ),
      };
    }

    const attemptId = meta.active_attempt_id;
    const runnerContainerName = normalizeRunnerContainerNameOrNull(
      meta.active_runner_container_name,
    ) ?? userId;
    this.clearActiveRunMetaSync(meta);
    meta.active_runner_container_name = runnerContainerName;
    this.writeMetaRowSync(meta);

    return {
      attemptId,
      cleared: true,
      runnerContainerName,
    };
  }

  async clearStoppedRunnerContainerForUserControl(input: {
    runnerContainerName: string;
    userId: string;
  }): Promise<boolean> {
    const meta = this.selectMetaRowSync();
    if (meta && meta.user_id !== input.userId) {
      throw new Error("Hosted runner Durable Object is bound to a different user.");
    }

    if (
      !meta
      || meta.active_attempt_id
      || normalizeRunnerContainerNameOrNull(meta.active_runner_container_name)
        !== input.runnerContainerName
    ) {
      return false;
    }

    meta.active_runner_container_name = null;
    this.writeMetaRowSync(meta);
    return true;
  }

  async readWriteFenceToken(): Promise<RunnerWriteFenceToken | null> {
    return this.readWriteFenceTokenSync(this.requireMetaRowSync());
  }

  async validateWriteFenceToken(input: {
    attemptId: string;
    generation: string;
    userId: string;
  }): Promise<RunnerWriteFenceValidationResult> {
    const meta = this.selectMetaRowSync();
    if (!meta) {
      return {
        owns: false,
        record: null,
      };
    }

    const token = this.readWriteFenceTokenSync(meta);
    if (
      !token
      || token.kind !== "runtime"
      || token.attemptId !== input.attemptId
      || token.generation !== input.generation
      || token.userId !== input.userId
    ) {
      return {
        owns: false,
        record: this.readStateFromMetaSync(meta),
      };
    }

    return {
      owns: true,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async validateProviderEgressToken(input: {
    providerEgressToken: string;
    userId: string;
  }): Promise<RunnerProviderEgressTokenValidationResult> {
    const providerEgressToken = normalizeProviderEgressTokenOrNull(
      input.providerEgressToken,
    );
    if (!providerEgressToken) {
      return {
        owns: false,
        reason: "missing_provider_egress_token",
      };
    }

    const meta = this.selectMetaRowSync();
    if (!meta) {
      return {
        owns: false,
        reason: "missing_runner_state",
      };
    }
    const token = this.readWriteFenceTokenSync(meta);
    if (!token) {
      return {
        owns: false,
        reason: "missing_write_fence",
        record: this.readStateFromMetaSync(meta),
      };
    }
    if (token.kind !== "runtime" || token.userId !== input.userId) {
      return {
        owns: false,
        reason: "write_fence_mismatch",
        record: this.readStateFromMetaSync(meta),
      };
    }

    const candidateHash = await hashProviderEgressToken(providerEgressToken);
    if (
      !providerEgressTokenHashMatches(
        meta.active_provider_egress_token_hash,
        candidateHash,
      )
    ) {
      return {
        owns: false,
        reason: "provider_egress_token_mismatch",
        record: this.readStateFromMetaSync(meta),
      };
    }

    return {
      attemptId: token.attemptId,
      ...(meta.active_custom_inference_envelope
        ? { customInferenceEnvelope: meta.active_custom_inference_envelope }
        : {}),
      leaseGeneration: token.leaseGeneration,
      owns: true,
      ...(meta.active_platform_ai_allowed === null
        ? {}
        : { platformAiUsageAllowed: meta.active_platform_ai_allowed === 1 }),
      record: this.readStateFromMetaSync(meta),
      userId: token.userId,
      workspaceVersion: token.workspaceVersion,
    };
  }

  async validateProviderEgressCredential(input: {
    providerKind: string;
    runnerContainerName: string;
    userId: string;
  }): Promise<RunnerProviderEgressCredentialValidationResult> {
    const providerKind = normalizeProviderKindOrNull(input.providerKind);
    if (
      !providerKind ||
      !RUNNER_PROVIDER_EGRESS_CREDENTIAL_PROVIDER_KINDS.has(providerKind)
    ) {
      return {
        owns: false,
        reason: "provider_egress_not_allowed",
      };
    }

    const runnerContainerName = normalizeRunnerContainerNameOrNull(
      input.runnerContainerName,
    );
    if (!runnerContainerName) {
      return {
        owns: false,
        reason: "runner_container_mismatch",
      };
    }

    const meta = this.selectMetaRowSync();
    if (!meta) {
      return {
        owns: false,
        reason: "missing_runner_state",
      };
    }
    const token = this.readWriteFenceTokenSync(meta);
    if (!token) {
      return {
        owns: false,
        reason: "missing_write_fence",
        record: this.readStateFromMetaSync(meta),
      };
    }
    if (token.kind !== "runtime" || token.userId !== input.userId) {
      return {
        owns: false,
        reason: "write_fence_mismatch",
        record: this.readStateFromMetaSync(meta),
      };
    }
    if (token.runnerContainerName !== runnerContainerName) {
      return {
        owns: false,
        reason: "runner_container_mismatch",
        record: this.readStateFromMetaSync(meta),
      };
    }

    return {
      attemptId: token.attemptId,
      leaseGeneration: token.leaseGeneration,
      owns: true,
      ...(meta.active_platform_ai_allowed === null
        ? {}
        : { platformAiUsageAllowed: meta.active_platform_ai_allowed === 1 }),
      record: this.readStateFromMetaSync(meta),
      userId: token.userId,
      workspaceVersion: token.workspaceVersion,
    };
  }

  private readStateSync(): RunnerStateRecord {
    return this.readStateFromMetaSync(this.requireMetaRowSync());
  }

  private readStateFromMetaSync(meta: RunnerMetaRow): RunnerStateRecord {
    return projectRunnerStateRecord({
      meta,
    });
  }

  private requireMetaRowSync(): RunnerMetaRow {
    const row = this.selectMetaRowSync();
    if (row) {
      return row;
    }

    const userId = this.tryResolveUserIdSync();
    if (!userId) {
      throw new Error("Hosted runner user is not initialized.");
    }

    const meta = createDefaultRunnerMetaRow(userId);
    this.insertMetaRowSync(meta);
    return meta;
  }

  private tryResolveUserIdSync(): string | null {
    if (this.userId) {
      return this.userId;
    }

    const row = this.selectMetaRowSync();
    if (!row) {
      return null;
    }

    this.userId = row.user_id;
    return row.user_id;
  }

  private selectMetaRowSync(): RunnerMetaRow | null {
    const row = this.sql.exec<RunnerMetaRow>(
      `SELECT
        user_id,
        active_attempt_id,
        active_generation,
        active_kind,
        active_provider_egress_token_hash,
        active_custom_inference_envelope,
        active_platform_ai_allowed,
        active_runner_container_name,
        active_reason,
        active_started_at,
        active_workspace_version,
        failure_count,
        last_error_at,
        last_error_code,
        last_invocation_at
      FROM runner_meta
      WHERE singleton = 1`,
    ).toArray()[0] ?? null;

    if (!row) {
      return null;
    }
    this.userId = row.user_id;
    return row;
  }

  private insertMetaRowSync(meta: RunnerMetaRow): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO runner_meta (
        singleton,
        user_id,
        active_attempt_id,
        active_generation,
        active_kind,
        active_provider_egress_token_hash,
        active_custom_inference_envelope,
        active_platform_ai_allowed,
        active_runner_container_name,
        active_reason,
        active_started_at,
        active_workspace_version,
        failure_count,
        last_error_at,
        last_error_code,
        last_invocation_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      1,
      meta.user_id,
      meta.active_attempt_id,
      normalizeNonNegativeInteger(meta.active_generation),
      meta.active_kind,
      meta.active_provider_egress_token_hash,
      meta.active_custom_inference_envelope,
      meta.active_platform_ai_allowed,
      meta.active_runner_container_name,
      meta.active_reason,
      meta.active_started_at,
      meta.active_workspace_version,
      normalizeNonNegativeInteger(meta.failure_count),
      meta.last_error_at,
      meta.last_error_code,
      meta.last_invocation_at,
    );
  }

  private writeMetaRowSync(meta: RunnerMetaRow): void {
    this.insertMetaRowSync(meta);
    this.userId = meta.user_id;
  }

  private clearWriteFenceTokenSync(
    meta: RunnerMetaRow,
    token: RunnerWriteFenceToken,
  ): boolean {
    if (!this.hasWriteFenceTokenSync(meta, token)) {
      return false;
    }

    this.clearActiveRunMetaSync(meta);
    return true;
  }

  private clearActiveRunMetaSync(meta: RunnerMetaRow): void {
    meta.active_attempt_id = null;
    meta.active_kind = null;
    meta.active_provider_egress_token_hash = null;
    meta.active_custom_inference_envelope = null;
    meta.active_platform_ai_allowed = null;
    meta.active_reason = null;
    meta.active_runner_container_name = null;
    meta.active_started_at = null;
    meta.active_workspace_version = null;
  }

  private hasWriteFenceTokenSync(
    meta: RunnerMetaRow,
    token: RunnerWriteFenceToken,
  ): boolean {
    return meta.active_attempt_id === token.attemptId
      && normalizeNonNegativeInteger(meta.active_generation).toString() === token.generation
      && readWriteFenceKind(meta.active_kind) === token.kind
      && meta.user_id === token.userId;
  }

  private readWriteFenceTokenSync(meta: RunnerMetaRow): RunnerWriteFenceToken | null {
    const kind = readWriteFenceKind(meta.active_kind);
    if (
      !meta.active_attempt_id
      || !meta.active_started_at
      || !kind
    ) {
      return null;
    }

    return {
      attemptId: meta.active_attempt_id,
      expiresAt: null,
      generation: normalizeNonNegativeInteger(meta.active_generation).toString(),
      kind,
      leaseGeneration: normalizeNonNegativeInteger(meta.active_generation).toString(),
      processingMode: readRunnerRuntimeProcessingMode(meta.active_reason),
      providerEgressToken: null,
      runnerContainerName: normalizeRunnerContainerNameOrNull(meta.active_runner_container_name),
      startedAt: meta.active_started_at,
      userId: meta.user_id,
      workspaceVersion: meta.active_workspace_version,
    };
  }

  private get sql() {
    const sql = this.state.storage.sql;
    if (!sql) {
      throw new Error("Hosted runner Durable Object storage.sql is required.");
    }

    return sql;
  }
}

function requireWorkspaceVersion(value: string): string {
  if (!/^[0-9]+$/u.test(value)) {
    throw new TypeError("Hosted runner workspace version must be a non-negative base-10 integer string.");
  }
  return value;
}

function requireRunnerContainerName(value: string): string {
  const normalized = normalizeRunnerContainerNameOrNull(value);
  if (!normalized) {
    throw new TypeError("Hosted runner container name is required for the write fence.");
  }
  return normalized;
}

function normalizeRunnerContainerNameOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeProviderEgressTokenOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeProviderKindOrNull(value: unknown): string | null {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(value.trim())
    ? value.trim()
    : null;
}

function normalizeCustomInferenceEnvelopeOrNull(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.length > 16_384
  ) {
    throw new TypeError("Hosted custom inference envelope is invalid.");
  }
  return value;
}

function createRuntimeWriteAttemptId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `runtime-write-${crypto.randomUUID()}`;
  }

  const random = Math.random().toString(36).slice(2);
  return `runtime-write-${Date.now().toString(36)}-${random}`;
}

function createProviderEgressToken(): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("Hosted provider egress token generation requires Web Crypto.");
  }

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `provider-egress-${toHex(bytes)}`;
}

async function hashProviderEgressToken(token: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Hosted provider egress token hashing requires Web Crypto.");
  }

  const bytes = new TextEncoder().encode(token);
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer instanceof ArrayBuffer
      ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      : copyToArrayBuffer(bytes),
  ));
  return toHex(digest);
}

function providerEgressTokenHashMatches(
  storedHash: string | null,
  candidateHash: string,
): boolean {
  if (!storedHash || !/^[a-f0-9]{64}$/u.test(storedHash) || !/^[a-f0-9]{64}$/u.test(candidateHash)) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < storedHash.length; index += 1) {
    diff |= storedHash.charCodeAt(index) ^ candidateHash.charCodeAt(index);
  }
  return diff === 0;
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
