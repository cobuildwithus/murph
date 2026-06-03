import {
  deriveHostedExecutionErrorCode,
} from "@murphai/hosted-execution";
import {
  HOSTED_WORKSPACE_INVOCATION_REASONS,
  type HostedWorkspaceInvocationReason,
} from "@murphai/hosted-execution/runtime-control";

import { ensureRunnerStateSchema } from "./runner-state-schema.js";
import {
  createDefaultRunnerMetaRow,
  normalizeIsoDate,
  normalizeIsoDateOrNull,
  normalizeNonNegativeInteger,
  projectRunnerStateRecord,
  type RunnerMetaRow,
} from "./runner-state-helpers.js";
import {
  type DurableObjectStateLike,
  type RunnerWriteFenceKind,
  type RunnerStateRecord,
} from "./types.js";

export interface RunnerWriteFenceToken {
  attemptId: string;
  expiresAt: string;
  generation: string;
  leaseGeneration: string;
  providerEgressToken: string | null;
  reason: HostedWorkspaceInvocationReason;
  runnerContainerName: string | null;
  startedAt: string;
  userId: string;
  workspaceVersion: string | null;
}

export type RunnerInvocationLease = RunnerWriteFenceToken;

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

export type RunnerActiveWriteFenceValidationRejectReason =
  | "expired_write_fence"
  | "missing_runner_state"
  | "missing_write_fence"
  | "write_fence_mismatch";

export type RunnerProviderEgressTokenValidationRejectReason =
  | "expired_write_fence"
  | "missing_provider_egress_token"
  | "missing_runner_state"
  | "missing_write_fence"
  | "provider_egress_token_mismatch"
  | "write_fence_mismatch";

export type RunnerActiveWriteFenceValidationResult =
  | {
      owns: false;
      reason: RunnerActiveWriteFenceValidationRejectReason;
      record?: RunnerStateRecord;
    }
  | {
      attemptId: string;
      leaseGeneration: string;
      owns: true;
      record: RunnerStateRecord;
      userId: string;
      workspaceVersion: string | null;
    };

export type RunnerProviderEgressTokenValidationResult =
  | {
      owns: false;
      reason: RunnerProviderEgressTokenValidationRejectReason;
      record?: RunnerStateRecord;
    }
  | {
      attemptId: string;
      leaseGeneration: string;
      owns: true;
      record: RunnerStateRecord;
      userId: string;
      workspaceVersion: string | null;
    };

export type RunnerExpiredActiveRunResult =
  | {
      cleared: false;
      record: RunnerStateRecord;
    }
  | {
      cleared: true;
      record: RunnerStateRecord;
    };

export function resolveActiveInvocationRecoveryDecision(_input?: unknown): { action: "none" } {
  return { action: "none" };
}

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
      return { deleted: false };
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

  async clearExpiredWriteFence(nowMs: number): Promise<RunnerExpiredActiveRunResult> {
    const meta = this.requireMetaRowSync();
    const cleared = this.clearExpiredActiveRunSync(meta, nowMs);
    if (cleared) {
      this.writeMetaRowSync(meta);
    }
    return {
      cleared,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async beginWriteFence(input: {
    kind?: RunnerWriteFenceKind;
    reason: HostedWorkspaceInvocationReason;
    runnerContainerName: string;
    userId: string;
    expiresAt?: string | null;
  }): Promise<RunnerWriteFenceToken> {
    await this.bindUser(input.userId);

    const meta = this.requireMetaRowSync();
    if (this.readWriteFenceTokenSync(meta)) {
      throw new RunnerWriteFenceAlreadyActiveError(this.readStateFromMetaSync(meta));
    }

    const nextGeneration = normalizeNonNegativeInteger(meta.active_generation) + 1;
    const startedAt = new Date().toISOString();
    const expiresAt = normalizeIsoDateOrNull(input.expiresAt ?? null)
      ?? new Date(Date.parse(startedAt) + 30 * 60_000).toISOString();
    const attemptId = createRuntimeWriteAttemptId();
    const providerEgressToken = createProviderEgressToken();

    meta.active_attempt_id = attemptId;
    meta.active_expires_at = expiresAt;
    meta.active_generation = nextGeneration;
    meta.active_kind = input.kind ?? "runtime";
    meta.active_provider_egress_token_hash = await hashProviderEgressToken(providerEgressToken);
    meta.active_reason = input.reason;
    meta.active_runner_container_name = requireRunnerContainerName(input.runnerContainerName);
    meta.active_started_at = startedAt;
    meta.active_workspace_version = null;
    if (meta.active_kind === "runtime") {
      meta.wake_at = null;
    }
    this.writeMetaRowSync(meta);

    return {
      attemptId,
      expiresAt,
      generation: nextGeneration.toString(),
      leaseGeneration: nextGeneration.toString(),
      providerEgressToken,
      reason: input.reason,
      runnerContainerName: meta.active_runner_container_name,
      startedAt,
      userId: input.userId,
      workspaceVersion: null,
    };
  }

  async bindWriteFenceWorkspaceVersion(input: {
    token: RunnerWriteFenceToken;
    workspaceVersion: string;
  }): Promise<RunnerWriteFenceToken> {
    const meta = this.requireMetaRowSync();
    if (!this.hasWriteFenceTokenSync(meta, input.token)) {
      throw new Error("Hosted runner write fence is stale.");
    }

    meta.active_workspace_version = requireWorkspaceVersion(input.workspaceVersion);
    this.writeMetaRowSync(meta);
    return {
      ...input.token,
      workspaceVersion: meta.active_workspace_version,
    };
  }

  async beginInvocation(input: Parameters<RunnerStateStore["beginWriteFence"]>[0]): Promise<RunnerWriteFenceToken> {
    return await this.beginWriteFence(input);
  }

  async bindInvocationWorkspaceVersion(input: {
    lease: RunnerWriteFenceToken;
    workspaceVersion: string;
  }): Promise<RunnerWriteFenceToken> {
    return await this.bindWriteFenceWorkspaceVersion({
      token: input.lease,
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
    meta.backoff_until = null;
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

  async completeInvocation(input: {
    finishedAt?: string | null;
    lease: RunnerWriteFenceToken;
  }): Promise<{
    completed: boolean;
    record: RunnerStateRecord;
  }> {
    return await this.clearWriteFenceAfterCompletion({
      finishedAt: input.finishedAt,
      token: input.lease,
    });
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

  async clearStaleInvocationIfExpired(_input?: unknown): Promise<RunnerExpiredActiveRunResult> {
    return await this.clearExpiredWriteFence(Date.now());
  }

  async clearWriteFenceForUserDeletion(userId: string): Promise<{
    attemptId: string | null;
    cleared: boolean;
  }> {
    const meta = this.selectMetaRowSync();
    if (meta && meta.user_id !== userId) {
      throw new Error("Hosted runner Durable Object is bound to a different user.");
    }

    if (!meta || !meta.active_attempt_id) {
      return {
        attemptId: null,
        cleared: false,
      };
    }

    const attemptId = meta.active_attempt_id;
    this.clearActiveRunMetaSync(meta);
    meta.wake_at = null;
    this.writeMetaRowSync(meta);

    return {
      attemptId,
      cleared: true,
    };
  }

  async readWriteFenceToken(): Promise<RunnerWriteFenceToken | null> {
    return this.readWriteFenceTokenSync(this.requireMetaRowSync());
  }

  async validateWriteFenceToken(input: {
    attemptId: string;
    generation: string;
    userId: string;
    workspaceVersion?: string | null;
  }): Promise<RunnerWriteFenceValidationResult> {
    const meta = this.selectMetaRowSync();
    if (!meta) {
      return {
        owns: false,
        record: null,
      };
    }

    const token = this.readWriteFenceTokenSync(meta);
    if (token && this.isWriteFenceTokenExpiredSync(token, Date.now())) {
      return {
        owns: false,
        record: this.readStateFromMetaSync(meta),
      };
    }
    if (
      !token
      || token.attemptId !== input.attemptId
      || token.generation !== input.generation
      || token.userId !== input.userId
      || (
        input.workspaceVersion !== undefined
        && input.workspaceVersion !== null
        && token.workspaceVersion !== input.workspaceVersion
      )
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

  async validateActiveWriteFence(input: {
    userId: string;
  }): Promise<RunnerActiveWriteFenceValidationResult> {
    const meta = this.selectMetaRowSync();
    if (!meta) {
      return {
        owns: false,
        reason: "missing_runner_state",
      };
    }
    const token = this.readWriteFenceTokenSync(meta);
    if (token && this.isWriteFenceTokenExpiredSync(token, Date.now())) {
      return {
        owns: false,
        reason: "expired_write_fence",
        record: this.readStateFromMetaSync(meta),
      };
    }
    if (!token) {
      return {
        owns: false,
        reason: "missing_write_fence",
        record: this.readStateFromMetaSync(meta),
      };
    }
    if (
      token.userId !== input.userId
    ) {
      return {
        owns: false,
        reason: "write_fence_mismatch",
        record: this.readStateFromMetaSync(meta),
      };
    }

    return {
      attemptId: token.attemptId,
      leaseGeneration: token.leaseGeneration,
      owns: true,
      record: this.readStateFromMetaSync(meta),
      userId: token.userId,
      workspaceVersion: token.workspaceVersion,
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
    if (token && this.isWriteFenceTokenExpiredSync(token, Date.now())) {
      return {
        owns: false,
        reason: "expired_write_fence",
        record: this.readStateFromMetaSync(meta),
      };
    }
    if (!token) {
      return {
        owns: false,
        reason: "missing_write_fence",
        record: this.readStateFromMetaSync(meta),
      };
    }
    if (token.userId !== input.userId) {
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
      leaseGeneration: token.leaseGeneration,
      owns: true,
      record: this.readStateFromMetaSync(meta),
      userId: token.userId,
      workspaceVersion: token.workspaceVersion,
    };
  }

  private clearExpiredActiveRunSync(meta: RunnerMetaRow, nowMs: number): boolean {
    const writeFence = this.readWriteFenceTokenSync(meta);
    if (!writeFence) {
      return false;
    }

    if (!this.isWriteFenceTokenExpiredSync(writeFence, nowMs)) {
      return false;
    }

    const error = new Error("Hosted runtime write fence timed out.");
    const errorCode = deriveHostedExecutionErrorCode(error);
    this.clearActiveRunMetaSync(meta);
    const failedAt = new Date(nowMs).toISOString();
    meta.failure_count = normalizeNonNegativeInteger(meta.failure_count) + 1;
    meta.last_error_at = failedAt;
    meta.last_error_code = errorCode;
    return true;
  }

  private isWriteFenceTokenExpiredSync(
    token: RunnerWriteFenceToken,
    nowMs: number,
  ): boolean {
    const expiresAtMs = Date.parse(token.expiresAt);
    return Number.isFinite(expiresAtMs) && nowMs >= expiresAtMs;
  }

  private readStateSync(): RunnerStateRecord {
    return this.readStateFromMetaSync(this.requireMetaRowSync());
  }

  private readStateFromMetaSync(meta: RunnerMetaRow): RunnerStateRecord {
    return projectRunnerStateRecord({
      bundleRef: null,
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
        wake_at,
        active_attempt_id,
        active_generation,
        active_kind,
        active_provider_egress_token_hash,
        active_runner_container_name,
        active_reason,
        active_started_at,
        active_expires_at,
        active_workspace_version,
        backoff_until,
        browser_vault_refresh_requested_at,
        failure_count,
        last_error_at,
        last_error_code,
        last_invocation_at
      FROM runner_meta
      WHERE singleton = 1`,
    ).toArray()[0] ?? null;

    if (row) {
      this.userId = row.user_id;
    }

    return row;
  }

  private insertMetaRowSync(meta: RunnerMetaRow): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO runner_meta (
        singleton,
        user_id,
        wake_at,
        active_attempt_id,
        active_generation,
        active_kind,
        active_provider_egress_token_hash,
        active_runner_container_name,
        active_reason,
        active_started_at,
        active_expires_at,
        active_workspace_version,
        backoff_until,
        browser_vault_refresh_requested_at,
        failure_count,
        last_error_at,
        last_error_code,
        last_invocation_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      1,
      meta.user_id,
      meta.wake_at,
      meta.active_attempt_id,
      normalizeNonNegativeInteger(meta.active_generation),
      meta.active_kind,
      meta.active_provider_egress_token_hash,
      meta.active_runner_container_name,
      readHostedWorkspaceInvocationReasonOrNull(meta.active_reason),
      meta.active_started_at,
      meta.active_expires_at,
      meta.active_workspace_version,
      meta.backoff_until,
      meta.browser_vault_refresh_requested_at,
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
    meta.active_expires_at = null;
    meta.active_kind = null;
    meta.active_provider_egress_token_hash = null;
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
      && meta.user_id === token.userId;
  }

  private readWriteFenceTokenSync(meta: RunnerMetaRow): RunnerWriteFenceToken | null {
    if (
      !meta.active_attempt_id
      || !meta.active_started_at
      || meta.active_kind !== "runtime"
    ) {
      return null;
    }

    return {
      attemptId: meta.active_attempt_id,
      expiresAt: meta.active_expires_at
        ?? new Date(Date.parse(meta.active_started_at) + 30 * 60_000).toISOString(),
      generation: normalizeNonNegativeInteger(meta.active_generation).toString(),
      leaseGeneration: normalizeNonNegativeInteger(meta.active_generation).toString(),
      providerEgressToken: null,
      reason: readHostedWorkspaceInvocationReasonOrDefault(meta.active_reason),
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

function readHostedWorkspaceInvocationReasonOrDefault(
  value: unknown,
): HostedWorkspaceInvocationReason {
  return readHostedWorkspaceInvocationReasonOrNull(value) ?? "nudge";
}

function readHostedWorkspaceInvocationReasonOrNull(
  value: unknown,
): HostedWorkspaceInvocationReason | null {
  return typeof value === "string"
    && HOSTED_WORKSPACE_INVOCATION_REASONS.includes(value as HostedWorkspaceInvocationReason)
    ? value as HostedWorkspaceInvocationReason
    : null;
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
