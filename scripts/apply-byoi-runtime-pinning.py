#!/usr/bin/env python3
"""Apply the BYOI invocation-pinning slice on the feature branch.

Temporary branch tooling. Remove this file before the pull request is ready.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text()
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one replacement anchor, found {count}")
    target.write_text(text.replace(old, new, 1))


def write_exact(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.read_text() == content:
        return
    target.write_text(content)


def add_runtime_target_parser() -> None:
    write_exact(
        "apps/cloudflare/src/hosted-inference-runtime-target.ts",
        '''import {
  HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
  HOSTED_INFERENCE_AUTH_SECRET_MAX_CODE_POINTS,
  normalizeHostedInferenceEndpointUrl,
  normalizeHostedInferenceModel,
  requireHostedInferenceAuthKind,
  requireHostedInferenceContextWindowTokens,
  requireHostedInferenceProtocol,
  requireHostedInferenceRevision,
  type HostedInferenceAuthKind,
  type HostedInferenceProtocol,
} from "@murphai/hosted-execution/assistant-inference";

export const HOSTED_INFERENCE_RUNTIME_TARGET_SCHEMA =
  "murph.hosted-inference-runtime-target.v1" as const;

export interface HostedInferenceRuntimeTarget {
  auth: {
    kind: HostedInferenceAuthKind;
    secret: string;
  };
  contextWindowTokens: number;
  endpointUrl: string;
  model: string;
  protocol: HostedInferenceProtocol;
  revision: number;
  schema: typeof HOSTED_INFERENCE_RUNTIME_TARGET_SCHEMA;
  supportsImages: boolean;
  verificationProfile: string;
}

export function parseHostedInferenceRuntimeTarget(
  value: unknown,
): HostedInferenceRuntimeTarget {
  const record = requireRecord(value, "Hosted inference runtime target");
  requireExactKeys(record, [
    "auth",
    "contextWindowTokens",
    "endpointUrl",
    "model",
    "protocol",
    "revision",
    "schema",
    "supportsImages",
    "verificationProfile",
  ]);
  if (record.schema !== HOSTED_INFERENCE_RUNTIME_TARGET_SCHEMA) {
    throw new TypeError("Hosted inference runtime target schema is invalid.");
  }
  const protocol = requireHostedInferenceProtocol(record.protocol);
  const auth = requireRecord(record.auth, "Hosted inference runtime target auth");
  requireExactKeys(auth, ["kind", "secret"]);
  const secret = requireTrimmedString(
    auth.secret,
    "Hosted inference runtime target auth secret",
  );
  if ([...secret].length > HOSTED_INFERENCE_AUTH_SECRET_MAX_CODE_POINTS) {
    throw new RangeError(
      `Hosted inference runtime target auth secret must be at most ${HOSTED_INFERENCE_AUTH_SECRET_MAX_CODE_POINTS} code points.`,
    );
  }
  if (record.verificationProfile !== HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE) {
    throw new TypeError("Hosted inference runtime target verification profile is unsupported.");
  }

  return {
    auth: {
      kind: requireHostedInferenceAuthKind(auth.kind),
      secret,
    },
    contextWindowTokens: requireHostedInferenceContextWindowTokens(
      record.contextWindowTokens,
    ),
    endpointUrl: normalizeHostedInferenceEndpointUrl({
      protocol,
      value: record.endpointUrl,
    }),
    model: normalizeHostedInferenceModel(record.model),
    protocol,
    revision: requireHostedInferenceRevision(record.revision),
    schema: HOSTED_INFERENCE_RUNTIME_TARGET_SCHEMA,
    supportsImages: requireBoolean(
      record.supportsImages,
      "Hosted inference runtime target supportsImages",
    ),
    verificationProfile: HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
): void {
  const expectedKeys = new Set(expected);
  if (
    Object.keys(record).length !== expectedKeys.size
    || Object.keys(record).some((key) => !expectedKeys.has(key))
  ) {
    throw new TypeError("Hosted inference runtime target contains unknown fields.");
  }
}

function requireTrimmedString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new TypeError(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }
  return value;
}
''',
    )


def add_target_envelope() -> None:
    write_exact(
        "apps/cloudflare/src/hosted-inference-target-envelope.ts",
        '''import {
  readHostedProviderEgressCredentialSigningSecret,
} from "./hosted-provider-egress-credential.ts";
import {
  parseHostedInferenceRuntimeTarget,
  type HostedInferenceRuntimeTarget,
} from "./hosted-inference-runtime-target.ts";

const HOSTED_INFERENCE_TARGET_ENVELOPE_SCHEMA =
  "murph.hosted-inference-target-envelope.v1" as const;
const HOSTED_INFERENCE_TARGET_ENVELOPE_ALG =
  "AES-256-GCM-HKDF-SHA256" as const;
const HOSTED_INFERENCE_TARGET_ENVELOPE_IV_BYTES = 12;
const HOSTED_INFERENCE_TARGET_ENVELOPE_MAX_CODE_POINTS = 16_384;
const HOSTED_INFERENCE_TARGET_ENVELOPE_TEXT_ENCODER = new TextEncoder();
const HOSTED_INFERENCE_TARGET_ENVELOPE_TEXT_DECODER = new TextDecoder();
const HOSTED_INFERENCE_TARGET_ENVELOPE_SALT =
  HOSTED_INFERENCE_TARGET_ENVELOPE_TEXT_ENCODER.encode(
    "murph.hosted-inference-target-envelope.hkdf.v1",
  );
const HOSTED_INFERENCE_TARGET_ENVELOPE_INFO =
  HOSTED_INFERENCE_TARGET_ENVELOPE_TEXT_ENCODER.encode(
    "murph:hosted-inference-target-envelope:aes-gcm:v1",
  );
const HOSTED_INFERENCE_TARGET_ENVELOPE_AAD =
  HOSTED_INFERENCE_TARGET_ENVELOPE_TEXT_ENCODER.encode(
    HOSTED_INFERENCE_TARGET_ENVELOPE_SCHEMA,
  );

interface HostedInferenceTargetEnvelopeV1 {
  alg: typeof HOSTED_INFERENCE_TARGET_ENVELOPE_ALG;
  ciphertext: string;
  iv: string;
  schema: typeof HOSTED_INFERENCE_TARGET_ENVELOPE_SCHEMA;
}

export async function sealHostedInferenceRuntimeTarget(input: {
  source: Readonly<Record<string, unknown>>;
  target: HostedInferenceRuntimeTarget;
}): Promise<string> {
  const target = parseHostedInferenceRuntimeTarget(input.target);
  const plaintext = HOSTED_INFERENCE_TARGET_ENVELOPE_TEXT_ENCODER.encode(
    JSON.stringify(target),
  );
  const iv = new Uint8Array(HOSTED_INFERENCE_TARGET_ENVELOPE_IV_BYTES);
  crypto.getRandomValues(iv);
  try {
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      {
        additionalData: toArrayBuffer(HOSTED_INFERENCE_TARGET_ENVELOPE_AAD),
        iv: toArrayBuffer(iv),
        name: "AES-GCM",
      },
      await deriveHostedInferenceTargetEnvelopeKey(input.source),
      toArrayBuffer(plaintext),
    ));
    return JSON.stringify({
      alg: HOSTED_INFERENCE_TARGET_ENVELOPE_ALG,
      ciphertext: bytesToBase64Url(ciphertext),
      iv: bytesToBase64Url(iv),
      schema: HOSTED_INFERENCE_TARGET_ENVELOPE_SCHEMA,
    } satisfies HostedInferenceTargetEnvelopeV1);
  } finally {
    plaintext.fill(0);
  }
}

export async function openHostedInferenceRuntimeTarget(input: {
  envelope: string;
  source: Readonly<Record<string, unknown>>;
}): Promise<HostedInferenceRuntimeTarget> {
  const envelope = parseHostedInferenceTargetEnvelope(input.envelope);
  const iv = base64UrlToBytes(envelope.iv);
  const ciphertext = base64UrlToBytes(envelope.ciphertext);
  if (
    !iv
    || iv.byteLength !== HOSTED_INFERENCE_TARGET_ENVELOPE_IV_BYTES
    || !ciphertext
    || ciphertext.byteLength === 0
  ) {
    throw new TypeError("Hosted inference target envelope encoding is invalid.");
  }

  const plaintext = new Uint8Array(await crypto.subtle.decrypt(
    {
      additionalData: toArrayBuffer(HOSTED_INFERENCE_TARGET_ENVELOPE_AAD),
      iv: toArrayBuffer(iv),
      name: "AES-GCM",
    },
    await deriveHostedInferenceTargetEnvelopeKey(input.source),
    toArrayBuffer(ciphertext),
  ));
  try {
    return parseHostedInferenceRuntimeTarget(
      JSON.parse(HOSTED_INFERENCE_TARGET_ENVELOPE_TEXT_DECODER.decode(plaintext)),
    );
  } finally {
    plaintext.fill(0);
  }
}

function parseHostedInferenceTargetEnvelope(
  value: string,
): HostedInferenceTargetEnvelopeV1 {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || [...value].length > HOSTED_INFERENCE_TARGET_ENVELOPE_MAX_CODE_POINTS
  ) {
    throw new TypeError("Hosted inference target envelope is invalid.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError("Hosted inference target envelope is invalid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Hosted inference target envelope is invalid.");
  }
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).length !== 4
    || record.alg !== HOSTED_INFERENCE_TARGET_ENVELOPE_ALG
    || typeof record.ciphertext !== "string"
    || typeof record.iv !== "string"
    || record.schema !== HOSTED_INFERENCE_TARGET_ENVELOPE_SCHEMA
  ) {
    throw new TypeError("Hosted inference target envelope is invalid.");
  }
  return {
    alg: HOSTED_INFERENCE_TARGET_ENVELOPE_ALG,
    ciphertext: record.ciphertext,
    iv: record.iv,
    schema: HOSTED_INFERENCE_TARGET_ENVELOPE_SCHEMA,
  };
}

async function deriveHostedInferenceTargetEnvelopeKey(
  source: Readonly<Record<string, unknown>>,
): Promise<CryptoKey> {
  const secret = readHostedProviderEgressCredentialSigningSecret(source);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(HOSTED_INFERENCE_TARGET_ENVELOPE_TEXT_ENCODER.encode(secret)),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return await crypto.subtle.deriveKey(
    {
      hash: "SHA-256",
      info: toArrayBuffer(HOSTED_INFERENCE_TARGET_ENVELOPE_INFO),
      name: "HKDF",
      salt: toArrayBuffer(HOSTED_INFERENCE_TARGET_ENVELOPE_SALT),
    },
    baseKey,
    { length: 256, name: "AES-GCM" },
    false,
    ["decrypt", "encrypt"],
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const remainder = value.length % 4;
  if (remainder === 1) return null;
  const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}${
    remainder === 0 ? "" : "=".repeat(4 - remainder)
  }`;
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
''',
    )


def export_signing_secret_reader() -> None:
    replace_once(
        "apps/cloudflare/src/hosted-provider-egress-credential.ts",
        "function readHostedProviderEgressCredentialSigningSecret(\n",
        "export function readHostedProviderEgressCredentialSigningSecret(\n",
    )


def patch_runner_state_schema() -> None:
    replace_once(
        "apps/cloudflare/src/user-runner/runner-state-schema.ts",
        "const RUNNER_STATE_SCHEMA_VERSION = 13;",
        "const RUNNER_STATE_SCHEMA_VERSION = 14;",
    )
    for anchor in [
        "      active_provider_egress_token_hash TEXT,\n      active_runner_container_name TEXT,",
        '    active_provider_egress_token_hash: "TEXT",\n    active_runner_container_name: "TEXT",',
        '      "active_provider_egress_token_hash",\n      "active_runner_container_name",',
    ]:
        replacement = anchor.replace(
            "active_provider_egress_token_hash",
            "active_provider_egress_token_hash",
        )
        if " TEXT," in anchor:
            replacement = anchor.replace(
                "      active_runner_container_name TEXT,",
                "      active_custom_inference_envelope TEXT,\n      active_runner_container_name TEXT,",
            )
        elif ': "TEXT"' in anchor:
            replacement = anchor.replace(
                '    active_runner_container_name: "TEXT",',
                '    active_custom_inference_envelope: "TEXT",\n    active_runner_container_name: "TEXT",',
            )
        else:
            replacement = anchor.replace(
                '      "active_runner_container_name",',
                '      "active_custom_inference_envelope",\n      "active_runner_container_name",',
            )
        replace_once(
            "apps/cloudflare/src/user-runner/runner-state-schema.ts",
            anchor,
            replacement,
        )


def patch_runner_state_helpers() -> None:
    replace_once(
        "apps/cloudflare/src/user-runner/runner-state-helpers.ts",
        "  active_provider_egress_token_hash: string | null;\n  active_reason: string | null;",
        "  active_provider_egress_token_hash: string | null;\n  active_custom_inference_envelope: string | null;\n  active_reason: string | null;",
    )
    replace_once(
        "apps/cloudflare/src/user-runner/runner-state-helpers.ts",
        "    active_provider_egress_token_hash: null,\n    active_reason: null,",
        "    active_provider_egress_token_hash: null,\n    active_custom_inference_envelope: null,\n    active_reason: null,",
    )


def patch_runner_state_store() -> None:
    path = "apps/cloudflare/src/user-runner/runner-state-store.ts"
    replace_once(
        path,
        "      attemptId: string;\n      leaseGeneration: string;\n      owns: true;",
        "      attemptId: string;\n      customInferenceEnvelope?: string;\n      leaseGeneration: string;\n      owns: true;",
    )
    replace_once(
        path,
        "    meta.active_provider_egress_token_hash = providerEgressTokenHash;\n    meta.active_reason = processingMode;",
        "    meta.active_provider_egress_token_hash = providerEgressTokenHash;\n    meta.active_custom_inference_envelope = null;\n    meta.active_reason = processingMode;",
    )
    replace_once(
        path,
        '''  async bindWriteFenceWorkspaceVersion(input: {
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
''',
        '''  async bindWriteFenceInvocationFacts(input: {
    customInferenceEnvelope: string | null;
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
    this.writeMetaRowSync(meta);
    return {
      ...input.token,
      workspaceVersion: meta.active_workspace_version,
    };
  }

  async bindWriteFenceWorkspaceVersion(input: {
    token: RunnerWriteFenceToken;
    workspaceVersion: string;
  }): Promise<RunnerWriteFenceToken> {
    return await this.bindWriteFenceInvocationFacts({
      customInferenceEnvelope: null,
      token: input.token,
      workspaceVersion: input.workspaceVersion,
    });
  }
''',
    )
    replace_once(
        path,
        '''    return {
      attemptId: token.attemptId,
      leaseGeneration: token.leaseGeneration,
      owns: true,
      record: this.readStateFromMetaSync(meta),
      userId: token.userId,
      workspaceVersion: token.workspaceVersion,
    };
''',
        '''    return {
      attemptId: token.attemptId,
      ...(meta.active_custom_inference_envelope
        ? { customInferenceEnvelope: meta.active_custom_inference_envelope }
        : {}),
      leaseGeneration: token.leaseGeneration,
      owns: true,
      record: this.readStateFromMetaSync(meta),
      userId: token.userId,
      workspaceVersion: token.workspaceVersion,
    };
''',
    )
    replace_once(
        path,
        "        active_provider_egress_token_hash,\n        active_runner_container_name,",
        "        active_provider_egress_token_hash,\n        active_custom_inference_envelope,\n        active_runner_container_name,",
    )
    replace_once(
        path,
        '''        active_provider_egress_token_hash,
        active_runner_container_name,
        active_reason,
        active_started_at,
        active_workspace_version,
        failure_count,
        last_error_at,
        last_error_code,
        last_invocation_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
        '''        active_provider_egress_token_hash,
        active_custom_inference_envelope,
        active_runner_container_name,
        active_reason,
        active_started_at,
        active_workspace_version,
        failure_count,
        last_error_at,
        last_error_code,
        last_invocation_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
    )
    replace_once(
        path,
        "      meta.active_provider_egress_token_hash,\n      meta.active_runner_container_name,",
        "      meta.active_provider_egress_token_hash,\n      meta.active_custom_inference_envelope,\n      meta.active_runner_container_name,",
    )
    replace_once(
        path,
        "    meta.active_provider_egress_token_hash = null;\n    meta.active_reason = null;",
        "    meta.active_provider_egress_token_hash = null;\n    meta.active_custom_inference_envelope = null;\n    meta.active_reason = null;",
    )
    replace_once(
        path,
        '''function normalizeProviderKindOrNull(value: unknown): string | null {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(value.trim())
    ? value.trim()
    : null;
}
''',
        '''function normalizeProviderKindOrNull(value: unknown): string | null {
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
''',
    )


def patch_worker_contracts_and_runner_projection() -> None:
    replace_once(
        "apps/cloudflare/src/worker-contracts.ts",
        "      attemptId: string;\n      leaseGeneration: string;\n      owns: true;",
        "      attemptId: string;\n      customInferenceEnvelope?: string;\n      leaseGeneration: string;\n      owns: true;",
    )
    replace_once(
        "apps/cloudflare/src/user-runner/hosted-user-runner.ts",
        '''    return {
      attemptId: validation.attemptId,
      leaseGeneration: validation.leaseGeneration,
      owns: true,
      userId: validation.userId,
      workspaceVersion: validation.workspaceVersion,
    };
''',
        '''    return {
      attemptId: validation.attemptId,
      ...(validation.customInferenceEnvelope
        ? { customInferenceEnvelope: validation.customInferenceEnvelope }
        : {}),
      leaseGeneration: validation.leaseGeneration,
      owns: true,
      userId: validation.userId,
      workspaceVersion: validation.workspaceVersion,
    };
''',
    )


def patch_runtime_invocation() -> None:
    path = "apps/cloudflare/src/user-runner/runtime-invocation.ts"
    replace_once(
        path,
        '''import type {
  HostedAssistantModelOverride,
  HostedAssistantProviderOverride,
  HostedAssistantReasoningEffortOverride,
} from "@murphai/hosted-execution/assistant-model";
''',
        '''import type {
  HostedAssistantModelOverride,
  HostedAssistantProviderOverride,
  HostedAssistantReasoningEffortOverride,
} from "@murphai/hosted-execution/assistant-model";
import type {
  HostedAssistantCustomInferenceOverride,
} from "@murphai/hosted-execution/assistant-inference";
''',
    )
    replace_once(
        path,
        '''import {
  createHostedProviderEgressCredential,
} from "../hosted-provider-egress-credential.js";
''',
        '''import {
  createHostedProviderEgressCredential,
} from "../hosted-provider-egress-credential.js";
import {
  parseHostedInferenceRuntimeTarget,
  type HostedInferenceRuntimeTarget,
} from "../hosted-inference-runtime-target.ts";
import {
  sealHostedInferenceRuntimeTarget,
} from "../hosted-inference-target-envelope.ts";
''',
    )
    replace_once(
        path,
        "const RUNTIME_OWNER_RELEASE_CALLBACK_TIMEOUT_MS = 2_000;\n",
        "const RUNTIME_OWNER_RELEASE_CALLBACK_TIMEOUT_MS = 2_000;\nconst HOSTED_INFERENCE_RUNTIME_TARGET_MAX_BODY_BYTES = 16 * 1024;\nconst HOSTED_INFERENCE_RUNTIME_TARGET_PATH = \"/api/internal/hosted-inference/resolve\";\n",
    )
    replace_once(
        path,
        '''    const workspaceVersion = workspaceRead.workspace?.version ?? "0";
    const token = await this.input.stateStore.bindWriteFenceWorkspaceVersion({
      token: input.token,
      workspaceVersion,
    });
''',
        '''    const workspaceVersion = workspaceRead.workspace?.version ?? "0";
    const hostedAssistantCustomInferenceOverride =
      workspaceRead.hostedAssistantCustomInferenceOverride ?? null;
    const customInferenceTarget = hostedAssistantCustomInferenceOverride
      ? await this.readHostedInferenceRuntimeTargetFromWeb({
          override: hostedAssistantCustomInferenceOverride,
          timeoutMs: input.commandBudget
            ? readRuntimeProcessingCommandStepTimeoutMs({
                budget: input.commandBudget,
                stepTimeoutMs: this.input.env.webControlTimeoutMs,
              })
            : this.input.env.webControlTimeoutMs,
          userId: input.input.userId,
        })
      : null;
    const customInferenceEnvelope = customInferenceTarget
      ? await sealHostedInferenceRuntimeTarget({
          source: this.input.runnerRuntimeEnvSource,
          target: customInferenceTarget,
        })
      : null;
    const token = await this.input.stateStore.bindWriteFenceInvocationFacts({
      customInferenceEnvelope,
      token: input.token,
      workspaceVersion,
    });
''',
    )
    replace_once(
        path,
        '''      hostedAssistantModelOverride:
        workspaceRead.hostedAssistantModelOverride ?? null,
''',
        '''      hostedAssistantCustomInferenceOverride,
      hostedAssistantModelOverride:
        workspaceRead.hostedAssistantModelOverride ?? null,
''',
    )
    replace_once(
        path,
        '''  private async prepareWorkspaceRunnerInvocation(input: {
    commandBudget?: RuntimeProcessingCommandBudget;
    hostedAssistantModelOverride: HostedAssistantModelOverride | null;
''',
        '''  private async readHostedInferenceRuntimeTargetFromWeb(input: {
    override: HostedAssistantCustomInferenceOverride;
    timeoutMs: number;
    userId: string;
  }): Promise<HostedInferenceRuntimeTarget> {
    const response = await fetchHostedExecutionWebControlPlaneResponse({
      ...(this.input.env.hostedWebAllowHttpHosts
        ? { allowHttpHosts: this.input.env.hostedWebAllowHttpHosts }
        : {}),
      baseUrl: this.input.readHostedWebControlBaseUrl(),
      boundUserId: input.userId,
      callbackSigning: this.input.env.webCallbackSigning,
      method: "GET",
      path: HOSTED_INFERENCE_RUNTIME_TARGET_PATH,
      search: `?revision=${input.override.revision}`,
      timeoutMs: input.timeoutMs,
    });
    if (!response.ok) {
      throw new Error(
        `Hosted custom inference resolution failed with HTTP ${response.status}.`,
      );
    }
    const text = await response.text();
    if (
      new TextEncoder().encode(text).byteLength
      > HOSTED_INFERENCE_RUNTIME_TARGET_MAX_BODY_BYTES
    ) {
      throw new RangeError("Hosted custom inference resolution response was too large.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new TypeError("Hosted custom inference resolution response was invalid.");
    }
    const target = parseHostedInferenceRuntimeTarget(parsed);
    if (
      target.contextWindowTokens !== input.override.contextWindowTokens
      || target.protocol !== input.override.protocol
      || target.revision !== input.override.revision
      || target.supportsImages !== input.override.supportsImages
      || target.verificationProfile !== input.override.verificationProfile
    ) {
      throw new Error("Hosted custom inference resolution did not match workspace projection.");
    }
    return target;
  }

  private async prepareWorkspaceRunnerInvocation(input: {
    commandBudget?: RuntimeProcessingCommandBudget;
    hostedAssistantCustomInferenceOverride:
      HostedAssistantCustomInferenceOverride | null;
    hostedAssistantModelOverride: HostedAssistantModelOverride | null;
''',
    )


def main() -> None:
    add_runtime_target_parser()
    add_target_envelope()
    export_signing_secret_reader()
    patch_runner_state_schema()
    patch_runner_state_helpers()
    patch_runner_state_store()
    patch_worker_contracts_and_runner_projection()
    patch_runtime_invocation()


if __name__ == "__main__":
    main()
