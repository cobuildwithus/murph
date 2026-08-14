export const HOSTED_RUNNER_SMOKE_RESULT_SCHEMA = "murph.cloudflare-hosted-runner-smoke.v1";
export const HOSTED_RUNNER_SMOKE_CLI_SURFACE_HOT_PATH_PROOF_COUNT = 4;
export const HOSTED_RUNNER_SMOKE_CLI_VAULT_COMMAND_PROOF_COUNT = 11;
export const HOSTED_RUNNER_SMOKE_CLI_VAULT_WRITE_PROOF_COUNT = 2;
export const HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_AUTOMATION_MUTATION_DENIED_COUNT = 5;
export const HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_AUTOMATION_READ_PROOF_COUNT = 2;
export const HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_LOCAL_MUTATION_PROOF_COUNT = 5;

export interface HostedRunnerSmokeInput {
  bundle: string;
  expectedVaultId: string;
  wavRelativePath: string;
}

export interface HostedRunnerSmokeResult {
  audioNormalizedMp3Bytes: number;
  audioPreparedWavBytes: number;
  childCwdIsIsolated: boolean;
  codexAppServerHelpBytes: number;
  codexCommandDiscovered: boolean;
  codexGroupReadAuthorizedFileRead: boolean;
  codexGroupReadDeepEnvReadDenied: boolean;
  codexGroupReadGroupWriteDenied: boolean;
  codexGroupReadNetworkDenied: boolean;
  codexGroupReadOutsideRootReadDenied: boolean;
  codexGroupReadPermissionProfileAttested: boolean;
  codexGroupReadRuntimeReadDenied: boolean;
  codexGroupReadSecretEnvironmentDenied: boolean;
  codexGroupReadSiblingRootReadDenied: boolean;
  codexMemberWorkspaceAutomationMutationDeniedCount: number;
  codexMemberWorkspaceAutomationReadProofCount: number;
  codexMemberWorkspaceAutomationTreeUnchanged: boolean;
  codexMemberWorkspaceLocalMutationProofCount: number;
  codexMemberWorkspacePermissionProfileAttested: boolean;
  codexMemberWorkspacePreloadBypassDenied: boolean;
  codexMemberWorkspaceTempWriteAllowed: boolean;
  codexMemberWorkspaceVaultWriteAllowed: boolean;
  codexHostedCliSurfaceContractBytes: number;
  codexHostedCliSurfaceHotPathProofCount: number;
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
  operatorHomeRebound: boolean;
  pdfParserProviderId: string;
  pdfTextSha256: string;
  pythonVersion: string;
  reportedVaultIdMatchesExpected: boolean;
  ripgrepCommandDiscovered: boolean;
  ripgrepVersion: string;
  schema: typeof HOSTED_RUNNER_SMOKE_RESULT_SCHEMA;
  vaultCliCommandDiscovered: boolean;
  vaultRootRebound: boolean;
  vaultShowBytes: number;
}

const HOSTED_RUNNER_SMOKE_RESULT_KEYS = new Set([
  "audioNormalizedMp3Bytes",
  "audioPreparedWavBytes",
  "childCwdIsIsolated",
  "codexAppServerHelpBytes",
  "codexCommandDiscovered",
  "codexGroupReadAuthorizedFileRead",
  "codexGroupReadDeepEnvReadDenied",
  "codexGroupReadGroupWriteDenied",
  "codexGroupReadNetworkDenied",
  "codexGroupReadOutsideRootReadDenied",
  "codexGroupReadPermissionProfileAttested",
  "codexGroupReadRuntimeReadDenied",
  "codexGroupReadSecretEnvironmentDenied",
  "codexGroupReadSiblingRootReadDenied",
  "codexMemberWorkspaceAutomationMutationDeniedCount",
  "codexMemberWorkspaceAutomationReadProofCount",
  "codexMemberWorkspaceAutomationTreeUnchanged",
  "codexMemberWorkspaceLocalMutationProofCount",
  "codexMemberWorkspacePermissionProfileAttested",
  "codexMemberWorkspacePreloadBypassDenied",
  "codexMemberWorkspaceTempWriteAllowed",
  "codexMemberWorkspaceVaultWriteAllowed",
  "codexHostedCliSurfaceContractBytes",
  "codexHostedCliSurfaceHotPathProofCount",
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
  "operatorHomeRebound",
  "pdfParserProviderId",
  "pdfTextSha256",
  "pythonVersion",
  "reportedVaultIdMatchesExpected",
  "ripgrepCommandDiscovered",
  "ripgrepVersion",
  "schema",
  "vaultCliCommandDiscovered",
  "vaultRootRebound",
  "vaultShowBytes",
]);

export function parseHostedRunnerSmokeInput(value: unknown): HostedRunnerSmokeInput {
  const record = readObjectRecord(value, "Hosted runner smoke input");

  return {
    bundle: readNonEmptyString(record.bundle, "Hosted runner smoke input.bundle"),
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
    audioNormalizedMp3Bytes: readPositiveFiniteNumber(
      record.audioNormalizedMp3Bytes,
      "Hosted runner smoke result.audioNormalizedMp3Bytes",
    ),
    audioPreparedWavBytes: readPositiveFiniteNumber(
      record.audioPreparedWavBytes,
      "Hosted runner smoke result.audioPreparedWavBytes",
    ),
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
    codexGroupReadAuthorizedFileRead: readTrue(
      record.codexGroupReadAuthorizedFileRead,
      "Hosted runner smoke result.codexGroupReadAuthorizedFileRead",
    ),
    codexGroupReadDeepEnvReadDenied: readTrue(
      record.codexGroupReadDeepEnvReadDenied,
      "Hosted runner smoke result.codexGroupReadDeepEnvReadDenied",
    ),
    codexGroupReadGroupWriteDenied: readTrue(
      record.codexGroupReadGroupWriteDenied,
      "Hosted runner smoke result.codexGroupReadGroupWriteDenied",
    ),
    codexGroupReadNetworkDenied: readTrue(
      record.codexGroupReadNetworkDenied,
      "Hosted runner smoke result.codexGroupReadNetworkDenied",
    ),
    codexGroupReadOutsideRootReadDenied: readTrue(
      record.codexGroupReadOutsideRootReadDenied,
      "Hosted runner smoke result.codexGroupReadOutsideRootReadDenied",
    ),
    codexGroupReadPermissionProfileAttested: readTrue(
      record.codexGroupReadPermissionProfileAttested,
      "Hosted runner smoke result.codexGroupReadPermissionProfileAttested",
    ),
    codexGroupReadRuntimeReadDenied: readTrue(
      record.codexGroupReadRuntimeReadDenied,
      "Hosted runner smoke result.codexGroupReadRuntimeReadDenied",
    ),
    codexGroupReadSecretEnvironmentDenied: readTrue(
      record.codexGroupReadSecretEnvironmentDenied,
      "Hosted runner smoke result.codexGroupReadSecretEnvironmentDenied",
    ),
    codexGroupReadSiblingRootReadDenied: readTrue(
      record.codexGroupReadSiblingRootReadDenied,
      "Hosted runner smoke result.codexGroupReadSiblingRootReadDenied",
    ),
    codexMemberWorkspaceAutomationMutationDeniedCount: readMinimumFiniteNumber(
      record.codexMemberWorkspaceAutomationMutationDeniedCount,
      "Hosted runner smoke result.codexMemberWorkspaceAutomationMutationDeniedCount",
      HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_AUTOMATION_MUTATION_DENIED_COUNT,
    ),
    codexMemberWorkspaceAutomationReadProofCount: readMinimumFiniteNumber(
      record.codexMemberWorkspaceAutomationReadProofCount,
      "Hosted runner smoke result.codexMemberWorkspaceAutomationReadProofCount",
      HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_AUTOMATION_READ_PROOF_COUNT,
    ),
    codexMemberWorkspaceAutomationTreeUnchanged: readTrue(
      record.codexMemberWorkspaceAutomationTreeUnchanged,
      "Hosted runner smoke result.codexMemberWorkspaceAutomationTreeUnchanged",
    ),
    codexMemberWorkspaceLocalMutationProofCount: readMinimumFiniteNumber(
      record.codexMemberWorkspaceLocalMutationProofCount,
      "Hosted runner smoke result.codexMemberWorkspaceLocalMutationProofCount",
      HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_LOCAL_MUTATION_PROOF_COUNT,
    ),
    codexMemberWorkspacePermissionProfileAttested: readTrue(
      record.codexMemberWorkspacePermissionProfileAttested,
      "Hosted runner smoke result.codexMemberWorkspacePermissionProfileAttested",
    ),
    codexMemberWorkspacePreloadBypassDenied: readTrue(
      record.codexMemberWorkspacePreloadBypassDenied,
      "Hosted runner smoke result.codexMemberWorkspacePreloadBypassDenied",
    ),
    codexMemberWorkspaceTempWriteAllowed: readTrue(
      record.codexMemberWorkspaceTempWriteAllowed,
      "Hosted runner smoke result.codexMemberWorkspaceTempWriteAllowed",
    ),
    codexMemberWorkspaceVaultWriteAllowed: readTrue(
      record.codexMemberWorkspaceVaultWriteAllowed,
      "Hosted runner smoke result.codexMemberWorkspaceVaultWriteAllowed",
    ),
    codexHostedCliSurfaceContractBytes: readPositiveFiniteNumber(
      record.codexHostedCliSurfaceContractBytes,
      "Hosted runner smoke result.codexHostedCliSurfaceContractBytes",
    ),
    codexHostedCliSurfaceHotPathProofCount: readMinimumFiniteNumber(
      record.codexHostedCliSurfaceHotPathProofCount,
      "Hosted runner smoke result.codexHostedCliSurfaceHotPathProofCount",
      HOSTED_RUNNER_SMOKE_CLI_SURFACE_HOT_PATH_PROOF_COUNT,
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
    ripgrepCommandDiscovered: readTrue(
      record.ripgrepCommandDiscovered,
      "Hosted runner smoke result.ripgrepCommandDiscovered",
    ),
    ripgrepVersion: readRipgrepVersionString(
      record.ripgrepVersion,
      "Hosted runner smoke result.ripgrepVersion",
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
  };
}

export function countAssistantCliSurfaceHotPathProofs(contract: string): number {
  const lines = contract.split(/\r?\n/u);

  return assistantCliSurfaceHotPathProofs.filter(({ command, snippets }) => {
    const commandLine = lines.find((line) => line.includes(`\`${command}\``));
    return commandLine !== undefined &&
      snippets.every((snippet) => commandLine.includes(snippet));
  }
  ).length;
}

const assistantCliSurfaceHotPathProofs: readonly {
  command: string;
  snippets: readonly string[];
}[] = [
  {
    command: "memory upsert",
    snippets: [
      "args <text>",
      "--section=Identity|Preferences|Instructions|Context",
    ],
  },
  {
    command: "goal save",
    snippets: [
      "args <title>",
      "--status=active|paused|completed|abandoned",
      "--horizon=short_term|medium_term|long_term|ongoing",
      "--priority=integer",
      "repeat --domain=string",
    ],
  },
  {
    command: "device account list",
    snippets: [
      "--provider=string",
      "--source-provider=string",
    ],
  },
  {
    command: "device connect",
    snippets: [
      "args <provider>",
      "--returnTo=string",
    ],
  },
];

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

function readRipgrepVersionString(value: unknown, label: string): string {
  const normalized = readNonEmptyString(value, label);
  if (!/^ripgrep\s+\d/u.test(normalized)) {
    throw new TypeError(`${label} must be a ripgrep version string.`);
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
