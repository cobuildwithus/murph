export const HOSTED_RUNNER_SMOKE_RESULT_SCHEMA = "murph.cloudflare-hosted-runner-smoke.v1";

export interface HostedRunnerSmokeInput {
  bundle: string;
  expectedTranscriptSnippet: string | null;
  expectedVaultId: string;
  wavRelativePath: string;
}

export interface HostedRunnerSmokeResult {
  childCwdIsIsolated: boolean;
  codexAppServerHelpBytes: number;
  codexCommandDiscovered: boolean;
  codexVersion: string;
  healthCommonsCatalogHash: string;
  healthCommonsCliProtocolListBytes: number;
  healthCommonsCliSearchBytes: number;
  healthCommonsFinnishDrySaunaTitle: string;
  healthCommonsRuntimeProtocolHitKeys: readonly string[];
  healthCommonsRuntimeSearchHitKeys: readonly string[];
  murphCommandDiscovered: boolean;
  normalizedTranscriptMatchesExpectedSnippet: boolean;
  normalizedTranscriptProviderId: string;
  normalizedTranscriptSha256: string;
  operatorHomeRebound: boolean;
  reportedVaultId: string;
  schema: typeof HOSTED_RUNNER_SMOKE_RESULT_SCHEMA;
  vaultCliCommandDiscovered: boolean;
  vaultRootRebound: boolean;
  vaultShowBytes: number;
  wavTranscriptMatchesExpectedSnippet: boolean;
  wavTranscriptProviderId: string;
  wavTranscriptSha256: string;
}

export function parseHostedRunnerSmokeInput(value: unknown): HostedRunnerSmokeInput {
  const record = readObjectRecord(value, "Hosted runner smoke input");

  return {
    bundle: readNonEmptyString(record.bundle, "Hosted runner smoke input.bundle"),
    expectedTranscriptSnippet: readNullableString(
      record.expectedTranscriptSnippet,
      "Hosted runner smoke input.expectedTranscriptSnippet",
    ),
    expectedVaultId: readNonEmptyString(
      record.expectedVaultId,
      "Hosted runner smoke input.expectedVaultId",
    ),
    wavRelativePath: readNonEmptyString(
      record.wavRelativePath,
      "Hosted runner smoke input.wavRelativePath",
    ),
  };
}

export function parseHostedRunnerSmokeResult(value: unknown): HostedRunnerSmokeResult {
  const record = readObjectRecord(value, "Hosted runner smoke result");

  if (record.schema !== HOSTED_RUNNER_SMOKE_RESULT_SCHEMA) {
    throw new TypeError(
      `Hosted runner smoke result.schema must be ${HOSTED_RUNNER_SMOKE_RESULT_SCHEMA}.`,
    );
  }

  return {
    childCwdIsIsolated: readBoolean(
      record.childCwdIsIsolated,
      "Hosted runner smoke result.childCwdIsIsolated",
    ),
    codexAppServerHelpBytes: readFiniteNumber(
      record.codexAppServerHelpBytes,
      "Hosted runner smoke result.codexAppServerHelpBytes",
    ),
    codexCommandDiscovered: readBoolean(
      record.codexCommandDiscovered,
      "Hosted runner smoke result.codexCommandDiscovered",
    ),
    codexVersion: readNonEmptyString(
      record.codexVersion,
      "Hosted runner smoke result.codexVersion",
    ),
    healthCommonsCatalogHash: readNonEmptyString(
      record.healthCommonsCatalogHash,
      "Hosted runner smoke result.healthCommonsCatalogHash",
    ),
    healthCommonsCliProtocolListBytes: readFiniteNumber(
      record.healthCommonsCliProtocolListBytes,
      "Hosted runner smoke result.healthCommonsCliProtocolListBytes",
    ),
    healthCommonsCliSearchBytes: readFiniteNumber(
      record.healthCommonsCliSearchBytes,
      "Hosted runner smoke result.healthCommonsCliSearchBytes",
    ),
    healthCommonsFinnishDrySaunaTitle: readNonEmptyString(
      record.healthCommonsFinnishDrySaunaTitle,
      "Hosted runner smoke result.healthCommonsFinnishDrySaunaTitle",
    ),
    healthCommonsRuntimeProtocolHitKeys: readNonEmptyStringArray(
      record.healthCommonsRuntimeProtocolHitKeys,
      "Hosted runner smoke result.healthCommonsRuntimeProtocolHitKeys",
    ),
    healthCommonsRuntimeSearchHitKeys: readNonEmptyStringArray(
      record.healthCommonsRuntimeSearchHitKeys,
      "Hosted runner smoke result.healthCommonsRuntimeSearchHitKeys",
    ),
    murphCommandDiscovered: readBoolean(
      record.murphCommandDiscovered,
      "Hosted runner smoke result.murphCommandDiscovered",
    ),
    normalizedTranscriptMatchesExpectedSnippet: readBoolean(
      record.normalizedTranscriptMatchesExpectedSnippet,
      "Hosted runner smoke result.normalizedTranscriptMatchesExpectedSnippet",
    ),
    normalizedTranscriptProviderId: readNonEmptyString(
      record.normalizedTranscriptProviderId,
      "Hosted runner smoke result.normalizedTranscriptProviderId",
    ),
    normalizedTranscriptSha256: readNonEmptyString(
      record.normalizedTranscriptSha256,
      "Hosted runner smoke result.normalizedTranscriptSha256",
    ),
    operatorHomeRebound: readBoolean(
      record.operatorHomeRebound,
      "Hosted runner smoke result.operatorHomeRebound",
    ),
    reportedVaultId: readNonEmptyString(
      record.reportedVaultId,
      "Hosted runner smoke result.reportedVaultId",
    ),
    schema: HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
    vaultCliCommandDiscovered: readBoolean(
      record.vaultCliCommandDiscovered,
      "Hosted runner smoke result.vaultCliCommandDiscovered",
    ),
    vaultRootRebound: readBoolean(
      record.vaultRootRebound,
      "Hosted runner smoke result.vaultRootRebound",
    ),
    vaultShowBytes: readFiniteNumber(
      record.vaultShowBytes,
      "Hosted runner smoke result.vaultShowBytes",
    ),
    wavTranscriptMatchesExpectedSnippet: readBoolean(
      record.wavTranscriptMatchesExpectedSnippet,
      "Hosted runner smoke result.wavTranscriptMatchesExpectedSnippet",
    ),
    wavTranscriptProviderId: readNonEmptyString(
      record.wavTranscriptProviderId,
      "Hosted runner smoke result.wavTranscriptProviderId",
    ),
    wavTranscriptSha256: readNonEmptyString(
      record.wavTranscriptSha256,
      "Hosted runner smoke result.wavTranscriptSha256",
    ),
  };
}

function readObjectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

function readNonEmptyStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  if (value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array.`);
  }

  return value.map((entry, index) =>
    readNonEmptyString(entry, `${label}[${index}]`)
  );
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return normalized;
}

function readNullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return readNonEmptyString(value, label);
}
