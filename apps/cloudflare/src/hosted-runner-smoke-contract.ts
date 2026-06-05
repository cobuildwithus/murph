export const HOSTED_RUNNER_SMOKE_RESULT_SCHEMA = "murph.cloudflare-hosted-runner-smoke.v1";
export const HOSTED_RUNNER_SMOKE_CLI_VAULT_COMMAND_PROOF_COUNT = 11;
export const HOSTED_RUNNER_SMOKE_CLI_VAULT_WRITE_PROOF_COUNT = 2;

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
  codexHostedConfigShellEnvironmentPolicyAllowlisted: boolean;
  codexHostedCliSchemaVaultOptionHidden: boolean;
  codexHostedCliVaultCommandProofCount: number;
  codexHostedCliVaultWriteProofCount: number;
  codexHostedShellMurphPathBytes: number;
  codexHostedShellPythonVersion: string;
  codexHostedShellVaultCliLlmsBytes: number;
  codexVersion: string;
  healthCommonsCatalogHash: string;
  healthCommonsCliProtocolListBytes: number;
  healthCommonsFinnishDrySaunaTitle: string;
  healthCommonsRuntimeProtocolHitKeys: readonly string[];
  healthCommonsRuntimeSearchHitKeys: readonly string[];
  murphCommandDiscovered: boolean;
  normalizedTranscriptMatchesExpectedSnippet: boolean;
  normalizedTranscriptProviderId: string;
  normalizedTranscriptSha256: string;
  operatorHomeRebound: boolean;
  pdfParserProviderId: string;
  pdfTextSha256: string;
  pythonVersion: string;
  reportedVaultIdMatchesExpected: boolean;
  schema: typeof HOSTED_RUNNER_SMOKE_RESULT_SCHEMA;
  vaultCliCommandDiscovered: boolean;
  vaultRootRebound: boolean;
  vaultShowBytes: number;
  wavTranscriptMatchesExpectedSnippet: boolean;
  wavTranscriptProviderId: string;
  wavTranscriptSha256: string;
}

const HOSTED_RUNNER_SMOKE_RESULT_KEYS = new Set([
  "childCwdIsIsolated",
  "codexAppServerHelpBytes",
  "codexCommandDiscovered",
  "codexHostedConfigShellEnvironmentPolicyAllowlisted",
  "codexHostedCliSchemaVaultOptionHidden",
  "codexHostedCliVaultCommandProofCount",
  "codexHostedCliVaultWriteProofCount",
  "codexHostedShellMurphPathBytes",
  "codexHostedShellPythonVersion",
  "codexHostedShellVaultCliLlmsBytes",
  "codexVersion",
  "healthCommonsCatalogHash",
  "healthCommonsCliProtocolListBytes",
  "healthCommonsFinnishDrySaunaTitle",
  "healthCommonsRuntimeProtocolHitKeys",
  "healthCommonsRuntimeSearchHitKeys",
  "murphCommandDiscovered",
  "normalizedTranscriptMatchesExpectedSnippet",
  "normalizedTranscriptProviderId",
  "normalizedTranscriptSha256",
  "operatorHomeRebound",
  "pdfParserProviderId",
  "pdfTextSha256",
  "pythonVersion",
  "reportedVaultIdMatchesExpected",
  "schema",
  "vaultCliCommandDiscovered",
  "vaultRootRebound",
  "vaultShowBytes",
  "wavTranscriptMatchesExpectedSnippet",
  "wavTranscriptProviderId",
  "wavTranscriptSha256",
]);

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
  assertOnlyKnownKeys(record, "Hosted runner smoke result", HOSTED_RUNNER_SMOKE_RESULT_KEYS);

  if (record.schema !== HOSTED_RUNNER_SMOKE_RESULT_SCHEMA) {
    throw new TypeError(
      `Hosted runner smoke result.schema must be ${HOSTED_RUNNER_SMOKE_RESULT_SCHEMA}.`,
    );
  }

  return {
    childCwdIsIsolated: readTrue(
      record.childCwdIsIsolated,
      "Hosted runner smoke result.childCwdIsIsolated",
    ),
    codexAppServerHelpBytes: readFiniteNumber(
      record.codexAppServerHelpBytes,
      "Hosted runner smoke result.codexAppServerHelpBytes",
    ),
    codexCommandDiscovered: readTrue(
      record.codexCommandDiscovered,
      "Hosted runner smoke result.codexCommandDiscovered",
    ),
    codexHostedConfigShellEnvironmentPolicyAllowlisted: readTrue(
      record.codexHostedConfigShellEnvironmentPolicyAllowlisted,
      "Hosted runner smoke result.codexHostedConfigShellEnvironmentPolicyAllowlisted",
    ),
    codexHostedCliSchemaVaultOptionHidden: readTrue(
      record.codexHostedCliSchemaVaultOptionHidden,
      "Hosted runner smoke result.codexHostedCliSchemaVaultOptionHidden",
    ),
    codexHostedCliVaultCommandProofCount: readMinimumFiniteNumber(
      record.codexHostedCliVaultCommandProofCount,
      "Hosted runner smoke result.codexHostedCliVaultCommandProofCount",
      HOSTED_RUNNER_SMOKE_CLI_VAULT_COMMAND_PROOF_COUNT,
    ),
    codexHostedCliVaultWriteProofCount: readMinimumFiniteNumber(
      record.codexHostedCliVaultWriteProofCount,
      "Hosted runner smoke result.codexHostedCliVaultWriteProofCount",
      HOSTED_RUNNER_SMOKE_CLI_VAULT_WRITE_PROOF_COUNT,
    ),
    codexHostedShellMurphPathBytes: readPositiveFiniteNumber(
      record.codexHostedShellMurphPathBytes,
      "Hosted runner smoke result.codexHostedShellMurphPathBytes",
    ),
    codexHostedShellPythonVersion: readPython3VersionString(
      record.codexHostedShellPythonVersion,
      "Hosted runner smoke result.codexHostedShellPythonVersion",
    ),
    codexHostedShellVaultCliLlmsBytes: readPositiveFiniteNumber(
      record.codexHostedShellVaultCliLlmsBytes,
      "Hosted runner smoke result.codexHostedShellVaultCliLlmsBytes",
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
    murphCommandDiscovered: readTrue(
      record.murphCommandDiscovered,
      "Hosted runner smoke result.murphCommandDiscovered",
    ),
    normalizedTranscriptMatchesExpectedSnippet: readTrue(
      record.normalizedTranscriptMatchesExpectedSnippet,
      "Hosted runner smoke result.normalizedTranscriptMatchesExpectedSnippet",
    ),
    normalizedTranscriptProviderId: readNonEmptyString(
      record.normalizedTranscriptProviderId,
      "Hosted runner smoke result.normalizedTranscriptProviderId",
    ),
    normalizedTranscriptSha256: readSha256HexString(
      record.normalizedTranscriptSha256,
      "Hosted runner smoke result.normalizedTranscriptSha256",
    ),
    operatorHomeRebound: readTrue(
      record.operatorHomeRebound,
      "Hosted runner smoke result.operatorHomeRebound",
    ),
    pdfParserProviderId: readNonEmptyString(
      record.pdfParserProviderId,
      "Hosted runner smoke result.pdfParserProviderId",
    ),
    pdfTextSha256: readSha256HexString(
      record.pdfTextSha256,
      "Hosted runner smoke result.pdfTextSha256",
    ),
    pythonVersion: readPython3VersionString(
      record.pythonVersion,
      "Hosted runner smoke result.pythonVersion",
    ),
    reportedVaultIdMatchesExpected: readTrue(
      record.reportedVaultIdMatchesExpected,
      "Hosted runner smoke result.reportedVaultIdMatchesExpected",
    ),
    schema: HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
    vaultCliCommandDiscovered: readTrue(
      record.vaultCliCommandDiscovered,
      "Hosted runner smoke result.vaultCliCommandDiscovered",
    ),
    vaultRootRebound: readTrue(
      record.vaultRootRebound,
      "Hosted runner smoke result.vaultRootRebound",
    ),
    vaultShowBytes: readFiniteNumber(
      record.vaultShowBytes,
      "Hosted runner smoke result.vaultShowBytes",
    ),
    wavTranscriptMatchesExpectedSnippet: readTrue(
      record.wavTranscriptMatchesExpectedSnippet,
      "Hosted runner smoke result.wavTranscriptMatchesExpectedSnippet",
    ),
    wavTranscriptProviderId: readNonEmptyString(
      record.wavTranscriptProviderId,
      "Hosted runner smoke result.wavTranscriptProviderId",
    ),
    wavTranscriptSha256: readSha256HexString(
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

function assertOnlyKnownKeys(
  record: Record<string, unknown>,
  label: string,
  knownKeys: ReadonlySet<string>,
): void {
  if (Object.keys(record).some((key) => !knownKeys.has(key))) {
    throw new TypeError(`${label} must not include unexpected fields.`);
  }
}

function readFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function readPositiveFiniteNumber(value: unknown, label: string): number {
  const parsed = readFiniteNumber(value, label);
  if (parsed <= 0) {
    throw new TypeError(`${label} must be a positive finite number.`);
  }

  return parsed;
}

function readMinimumFiniteNumber(value: unknown, label: string, minimum: number): number {
  const parsed = readFiniteNumber(value, label);
  if (parsed < minimum) {
    throw new TypeError(`${label} must be at least ${minimum}.`);
  }

  return parsed;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

function readTrue(value: unknown, label: string): true {
  const parsed = readBoolean(value, label);
  if (!parsed) {
    throw new TypeError(`${label} must be true.`);
  }

  return true;
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

function readPython3VersionString(value: unknown, label: string): string {
  const normalized = readNonEmptyString(value, label);
  if (!/^Python\s+3\./u.test(normalized)) {
    throw new TypeError(`${label} must be a Python 3 version string.`);
  }

  return normalized;
}

function readSha256HexString(value: unknown, label: string): string {
  const normalized = readNonEmptyString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new TypeError(`${label} must be a SHA-256 hex string.`);
  }

  return normalized;
}

function readNullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return readNonEmptyString(value, label);
}
