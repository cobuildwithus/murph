export const HOSTED_RUNNER_SMOKE_RESULT_SCHEMA = "murph.cloudflare-hosted-runner-smoke.v1";

export interface HostedRunnerSmokeInput {
  bundle: string;
  expectedPdfText: string;
  expectedTranscriptSnippet: string | null;
  expectedVaultId: string;
  pdfRelativePath: string;
  wavRelativePath: string;
}

export interface HostedRunnerSmokeResult {
  childCwd: string;
  expectedPdfText: string;
  murphBin: string;
  normalizedTranscript: string;
  normalizedTranscriptProviderId: string;
  operatorHomeRoot: string;
  pdfProviderId: string;
  pdfText: string;
  reportedVaultId: string;
  schema: typeof HOSTED_RUNNER_SMOKE_RESULT_SCHEMA;
  vaultCliBin: string;
  vaultRoot: string;
  vaultShowBytes: number;
  wavTranscript: string;
  wavTranscriptProviderId: string;
}

export function parseHostedRunnerSmokeInput(value: unknown): HostedRunnerSmokeInput {
  const record = readObjectRecord(value, "Hosted runner smoke input");

  return {
    bundle: readNonEmptyString(record.bundle, "Hosted runner smoke input.bundle"),
    expectedPdfText: readNonEmptyString(
      record.expectedPdfText,
      "Hosted runner smoke input.expectedPdfText",
    ),
    expectedTranscriptSnippet: readNullableString(
      record.expectedTranscriptSnippet,
      "Hosted runner smoke input.expectedTranscriptSnippet",
    ),
    expectedVaultId: readNonEmptyString(
      record.expectedVaultId,
      "Hosted runner smoke input.expectedVaultId",
    ),
    pdfRelativePath: readNonEmptyString(
      record.pdfRelativePath,
      "Hosted runner smoke input.pdfRelativePath",
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
    childCwd: readNonEmptyString(record.childCwd, "Hosted runner smoke result.childCwd"),
    expectedPdfText: readNonEmptyString(
      record.expectedPdfText,
      "Hosted runner smoke result.expectedPdfText",
    ),
    murphBin: readNonEmptyString(record.murphBin, "Hosted runner smoke result.murphBin"),
    normalizedTranscript: readNonEmptyString(
      record.normalizedTranscript,
      "Hosted runner smoke result.normalizedTranscript",
    ),
    normalizedTranscriptProviderId: readNonEmptyString(
      record.normalizedTranscriptProviderId,
      "Hosted runner smoke result.normalizedTranscriptProviderId",
    ),
    operatorHomeRoot: readNonEmptyString(
      record.operatorHomeRoot,
      "Hosted runner smoke result.operatorHomeRoot",
    ),
    pdfProviderId: readNonEmptyString(
      record.pdfProviderId,
      "Hosted runner smoke result.pdfProviderId",
    ),
    pdfText: readNonEmptyString(record.pdfText, "Hosted runner smoke result.pdfText"),
    reportedVaultId: readNonEmptyString(
      record.reportedVaultId,
      "Hosted runner smoke result.reportedVaultId",
    ),
    schema: HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
    vaultCliBin: readNonEmptyString(
      record.vaultCliBin,
      "Hosted runner smoke result.vaultCliBin",
    ),
    vaultRoot: readNonEmptyString(record.vaultRoot, "Hosted runner smoke result.vaultRoot"),
    vaultShowBytes: readFiniteNumber(
      record.vaultShowBytes,
      "Hosted runner smoke result.vaultShowBytes",
    ),
    wavTranscript: readNonEmptyString(
      record.wavTranscript,
      "Hosted runner smoke result.wavTranscript",
    ),
    wavTranscriptProviderId: readNonEmptyString(
      record.wavTranscriptProviderId,
      "Hosted runner smoke result.wavTranscriptProviderId",
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
