export const HOSTED_RUNNER_AUDIO_BENCHMARK_SCHEMA =
  "murph.cloudflare-hosted-runner-audio-benchmark.v1";

export interface HostedRunnerAudioBenchmarkInput {
  bundle: string;
  expectedTranscriptSnippet: string | null;
  targetDurationSeconds: number;
  wavRelativePath: string;
}

export interface HostedRunnerAudioBenchmarkCgroupSnapshot {
  cpuMax: string | null;
  cpusetCpusEffective: string | null;
  memoryCurrentBytes: number | null;
  memoryLimitBytes: number | null;
  memoryPeakBytes: number | null;
}

export interface HostedRunnerAudioBenchmarkResult {
  audioDurationSeconds: number;
  cgroupAfter: HostedRunnerAudioBenchmarkCgroupSnapshot;
  cgroupBefore: HostedRunnerAudioBenchmarkCgroupSnapshot;
  fixtureEncodeMs: number;
  parseAttachmentMs: number;
  parsedMetadataDurationMs: number | null;
  processMaxRssKb: number;
  providerId: "whisper.cpp";
  schema: typeof HOSTED_RUNNER_AUDIO_BENCHMARK_SCHEMA;
  sourceBytes: number;
  sourceMime: "audio/mp4";
  totalMs: number;
  transcriptChars: number;
  transcriptMatchesExpectedSnippet: boolean;
  transcriptSha256: string;
}

const DEFAULT_TARGET_DURATION_SECONDS = 65;

const HOSTED_RUNNER_AUDIO_BENCHMARK_RESULT_KEYS = new Set([
  "audioDurationSeconds",
  "cgroupAfter",
  "cgroupBefore",
  "fixtureEncodeMs",
  "parseAttachmentMs",
  "parsedMetadataDurationMs",
  "processMaxRssKb",
  "providerId",
  "schema",
  "sourceBytes",
  "sourceMime",
  "totalMs",
  "transcriptChars",
  "transcriptMatchesExpectedSnippet",
  "transcriptSha256",
]);

const CGROUP_SNAPSHOT_KEYS = new Set([
  "cpuMax",
  "cpusetCpusEffective",
  "memoryCurrentBytes",
  "memoryLimitBytes",
  "memoryPeakBytes",
]);

export function parseHostedRunnerAudioBenchmarkInput(
  value: unknown,
): HostedRunnerAudioBenchmarkInput {
  const record = readObjectRecord(value, "Hosted runner audio benchmark input");
  const targetDurationSeconds = record.targetDurationSeconds === undefined
    ? DEFAULT_TARGET_DURATION_SECONDS
    : readPositiveFiniteNumber(
      record.targetDurationSeconds,
      "Hosted runner audio benchmark input.targetDurationSeconds",
    );

  return {
    bundle: readNonEmptyString(record.bundle, "Hosted runner audio benchmark input.bundle"),
    expectedTranscriptSnippet: readNullableString(
      record.expectedTranscriptSnippet,
      "Hosted runner audio benchmark input.expectedTranscriptSnippet",
    ),
    targetDurationSeconds,
    wavRelativePath: readNonEmptyString(
      record.wavRelativePath,
      "Hosted runner audio benchmark input.wavRelativePath",
    ),
  };
}

export function parseHostedRunnerAudioBenchmarkResult(
  value: unknown,
): HostedRunnerAudioBenchmarkResult {
  const record = readObjectRecord(value, "Hosted runner audio benchmark result");
  assertOnlyKnownKeys(record, "Hosted runner audio benchmark result", HOSTED_RUNNER_AUDIO_BENCHMARK_RESULT_KEYS);

  if (record.schema !== HOSTED_RUNNER_AUDIO_BENCHMARK_SCHEMA) {
    throw new TypeError(
      `Hosted runner audio benchmark result.schema must be ${HOSTED_RUNNER_AUDIO_BENCHMARK_SCHEMA}.`,
    );
  }

  const providerId = readNonEmptyString(
    record.providerId,
    "Hosted runner audio benchmark result.providerId",
  );
  if (providerId !== "whisper.cpp") {
    throw new TypeError("Hosted runner audio benchmark result.providerId must be whisper.cpp.");
  }

  const sourceMime = readNonEmptyString(
    record.sourceMime,
    "Hosted runner audio benchmark result.sourceMime",
  );
  if (sourceMime !== "audio/mp4") {
    throw new TypeError("Hosted runner audio benchmark result.sourceMime must be audio/mp4.");
  }

  return {
    audioDurationSeconds: readPositiveFiniteNumber(
      record.audioDurationSeconds,
      "Hosted runner audio benchmark result.audioDurationSeconds",
    ),
    cgroupAfter: readCgroupSnapshot(
      record.cgroupAfter,
      "Hosted runner audio benchmark result.cgroupAfter",
    ),
    cgroupBefore: readCgroupSnapshot(
      record.cgroupBefore,
      "Hosted runner audio benchmark result.cgroupBefore",
    ),
    fixtureEncodeMs: readNonNegativeFiniteNumber(
      record.fixtureEncodeMs,
      "Hosted runner audio benchmark result.fixtureEncodeMs",
    ),
    parseAttachmentMs: readNonNegativeFiniteNumber(
      record.parseAttachmentMs,
      "Hosted runner audio benchmark result.parseAttachmentMs",
    ),
    parsedMetadataDurationMs: readNullableFiniteNumber(
      record.parsedMetadataDurationMs,
      "Hosted runner audio benchmark result.parsedMetadataDurationMs",
    ),
    processMaxRssKb: readPositiveFiniteNumber(
      record.processMaxRssKb,
      "Hosted runner audio benchmark result.processMaxRssKb",
    ),
    providerId: "whisper.cpp",
    schema: HOSTED_RUNNER_AUDIO_BENCHMARK_SCHEMA,
    sourceBytes: readPositiveFiniteNumber(
      record.sourceBytes,
      "Hosted runner audio benchmark result.sourceBytes",
    ),
    sourceMime: "audio/mp4",
    totalMs: readNonNegativeFiniteNumber(
      record.totalMs,
      "Hosted runner audio benchmark result.totalMs",
    ),
    transcriptChars: readPositiveFiniteNumber(
      record.transcriptChars,
      "Hosted runner audio benchmark result.transcriptChars",
    ),
    transcriptMatchesExpectedSnippet: readBoolean(
      record.transcriptMatchesExpectedSnippet,
      "Hosted runner audio benchmark result.transcriptMatchesExpectedSnippet",
    ),
    transcriptSha256: readSha256HexString(
      record.transcriptSha256,
      "Hosted runner audio benchmark result.transcriptSha256",
    ),
  };
}

function readCgroupSnapshot(value: unknown, label: string): HostedRunnerAudioBenchmarkCgroupSnapshot {
  const record = readObjectRecord(value, label);
  assertOnlyKnownKeys(record, label, CGROUP_SNAPSHOT_KEYS);

  return {
    cpuMax: readNullableString(record.cpuMax, `${label}.cpuMax`),
    cpusetCpusEffective: readNullableString(record.cpusetCpusEffective, `${label}.cpusetCpusEffective`),
    memoryCurrentBytes: readNullableFiniteNumber(record.memoryCurrentBytes, `${label}.memoryCurrentBytes`),
    memoryLimitBytes: readNullableFiniteNumber(record.memoryLimitBytes, `${label}.memoryLimitBytes`),
    memoryPeakBytes: readNullableFiniteNumber(record.memoryPeakBytes, `${label}.memoryPeakBytes`),
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
  for (const key of Object.keys(record)) {
    if (!knownKeys.has(key)) {
      throw new TypeError(`${label} contains unexpected key: ${key}.`);
    }
  }
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return trimmed;
}

function readNullableString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string or null.`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

function readPositiveFiniteNumber(value: unknown, label: string): number {
  const numberValue = readFiniteNumber(value, label);
  if (numberValue <= 0) {
    throw new TypeError(`${label} must be positive.`);
  }

  return numberValue;
}

function readNonNegativeFiniteNumber(value: unknown, label: string): number {
  const numberValue = readFiniteNumber(value, label);
  if (numberValue < 0) {
    throw new TypeError(`${label} must be non-negative.`);
  }

  return numberValue;
}

function readNullableFiniteNumber(value: unknown, label: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  return readNonNegativeFiniteNumber(value, label);
}

function readFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function readSha256HexString(value: unknown, label: string): string {
  const text = readNonEmptyString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(text)) {
    throw new TypeError(`${label} must be a SHA-256 hex string.`);
  }

  return text;
}
