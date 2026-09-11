import type { Readable } from "node:stream";

const HOSTED_WORKSPACE_SNAPSHOT_PROCESS_FAILURE_MARKER =
  Symbol("hosted.workspace-snapshot.process-failure");
const HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_SCAN_LIMIT_BYTES = 8192;

export const HOSTED_WORKSPACE_SNAPSHOT_PROCESS_LABELS = [
  "tar",
  "zstd",
] as const;

export type HostedWorkspaceSnapshotProcessLabel =
  typeof HOSTED_WORKSPACE_SNAPSHOT_PROCESS_LABELS[number];

export const HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_MARKERS = [
  "broken_pipe",
  "corrupt_archive",
  "io_error",
  "no_space_left",
  "not_found",
  "permission_denied",
  "unexpected_eof",
  "unsupported_format",
] as const;

export type HostedWorkspaceSnapshotProcessStderrMarker =
  typeof HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_MARKERS[number];

export interface HostedWorkspaceSnapshotProcessFailureDiagnostics {
  exitCode: number | null;
  label: HostedWorkspaceSnapshotProcessLabel;
  signal: string | null;
  stderrByteCount: number;
  stderrLineCount: number;
  stderrMarkers: readonly HostedWorkspaceSnapshotProcessStderrMarker[];
  stderrTruncated: boolean;
}

type HostedWorkspaceSnapshotProcessStderrCapture = {
  read(): Omit<
    HostedWorkspaceSnapshotProcessFailureDiagnostics,
    "exitCode" | "label" | "signal"
  >;
};

const HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_MARKER_PATTERNS:
  ReadonlyArray<{
    marker: HostedWorkspaceSnapshotProcessStderrMarker;
    pattern: RegExp;
  }> = [
    {
      marker: "broken_pipe",
      pattern: /(?:broken pipe|\bEPIPE\b)/iu,
    },
    {
      marker: "corrupt_archive",
      pattern: /(?:corrupt|checksum|decompression error|invalid compressed data|data corruption)/iu,
    },
    {
      marker: "io_error",
      pattern: /(?:I\/O error|input\/output error|read error|write error)/iu,
    },
    {
      marker: "no_space_left",
      pattern: /no space left/iu,
    },
    {
      marker: "not_found",
      pattern: /(?:no such file|cannot stat|not found)/iu,
    },
    {
      marker: "permission_denied",
      pattern: /(?:permission denied|operation not permitted)/iu,
    },
    {
      marker: "unexpected_eof",
      pattern: /(?:unexpected eof|unexpected end|premature end)/iu,
    },
    {
      marker: "unsupported_format",
      pattern: /(?:unsupported format|unknown frame descriptor|format not recognized|not a zstd file)/iu,
    },
  ];

export function readHostedWorkspaceSnapshotProcessFailureDiagnostics(
  error: unknown,
): HostedWorkspaceSnapshotProcessFailureDiagnostics | null {
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as Record<PropertyKey, unknown>;
    const diagnostics = readHostedWorkspaceSnapshotProcessFailureDiagnosticsValue(
      record[HOSTED_WORKSPACE_SNAPSHOT_PROCESS_FAILURE_MARKER],
    );
    if (diagnostics) {
      return diagnostics;
    }
    current = (current as { cause?: unknown }).cause;
  }

  return null;
}

export function annotateHostedWorkspaceSnapshotProcessFailure(
  error: Error,
  diagnostics: HostedWorkspaceSnapshotProcessFailureDiagnostics,
): void {
  try {
    Object.defineProperty(error, HOSTED_WORKSPACE_SNAPSHOT_PROCESS_FAILURE_MARKER, {
      configurable: true,
      enumerable: false,
      value: diagnostics,
    });
  } catch {
    // Best-effort diagnostics only; never mask the original process failure.
  }
}

export function captureHostedWorkspaceSnapshotProcessStderr(
  stream: Readable | null,
): HostedWorkspaceSnapshotProcessStderrCapture {
  let byteCount = 0;
  let lineBreakCount = 0;
  let scanText = "";
  let sawNonWhitespace = false;
  let endedWithLineBreak = false;
  const markers = new Set<HostedWorkspaceSnapshotProcessStderrMarker>();

  stream?.on("data", (chunk: Buffer | string) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    byteCount += Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(text);
    lineBreakCount += countHostedWorkspaceSnapshotLineBreaks(text);
    sawNonWhitespace = sawNonWhitespace || text.trim().length > 0;
    endedWithLineBreak = /(?:\r\n|\r|\n)$/u.test(text);
    scanText = `${scanText}${text}`.slice(
      -HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_SCAN_LIMIT_BYTES,
    );
    for (const marker of collectHostedWorkspaceSnapshotProcessStderrMarkers(scanText)) {
      markers.add(marker);
    }
  });
  stream?.resume();

  return {
    read: () => ({
      stderrByteCount: byteCount,
      stderrLineCount: sawNonWhitespace
        ? lineBreakCount + (endedWithLineBreak ? 0 : 1)
        : 0,
      stderrMarkers: [...markers].sort(),
      stderrTruncated:
        byteCount > HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_SCAN_LIMIT_BYTES,
    }),
  };
}

function collectHostedWorkspaceSnapshotProcessStderrMarkers(
  value: string,
): HostedWorkspaceSnapshotProcessStderrMarker[] {
  const markers = new Set<HostedWorkspaceSnapshotProcessStderrMarker>();
  for (const { marker, pattern } of HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_MARKER_PATTERNS) {
    if (pattern.test(value)) {
      markers.add(marker);
    }
  }
  return [...markers];
}

function countHostedWorkspaceSnapshotLineBreaks(value: string): number {
  return value.match(/\r\n|\r|\n/gu)?.length ?? 0;
}

function readHostedWorkspaceSnapshotProcessFailureDiagnosticsValue(
  value: unknown,
): HostedWorkspaceSnapshotProcessFailureDiagnostics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const label = readHostedWorkspaceSnapshotProcessLabel(record.label);
  if (!label) {
    return null;
  }
  const exitCode = readNullableHostedWorkspaceSnapshotProcessInteger(record.exitCode);
  const signal = readNullableHostedWorkspaceSnapshotProcessSignal(record.signal);
  const stderrByteCount = readHostedWorkspaceSnapshotProcessCount(
    record.stderrByteCount,
  );
  const stderrLineCount = readHostedWorkspaceSnapshotProcessCount(
    record.stderrLineCount,
  );
  if (stderrByteCount === null || stderrLineCount === null) {
    return null;
  }
  return {
    exitCode,
    label,
    signal,
    stderrByteCount,
    stderrLineCount,
    stderrMarkers: readHostedWorkspaceSnapshotProcessStderrMarkers(
      record.stderrMarkers,
    ),
    stderrTruncated: record.stderrTruncated === true,
  };
}

function readHostedWorkspaceSnapshotProcessLabel(
  value: unknown,
): HostedWorkspaceSnapshotProcessLabel | null {
  return typeof value === "string"
    && HOSTED_WORKSPACE_SNAPSHOT_PROCESS_LABELS.includes(
      value as HostedWorkspaceSnapshotProcessLabel,
    )
    ? value as HostedWorkspaceSnapshotProcessLabel
    : null;
}

function readNullableHostedWorkspaceSnapshotProcessInteger(
  value: unknown,
): number | null {
  if (value === null) {
    return null;
  }
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function readNullableHostedWorkspaceSnapshotProcessSignal(
  value: unknown,
): string | null {
  if (value === null) {
    return null;
  }
  return typeof value === "string" && /^[A-Z0-9]+$/u.test(value)
    ? value
    : null;
}

function readHostedWorkspaceSnapshotProcessCount(value: unknown): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 1024 * 1024
    ? value
    : null;
}

function readHostedWorkspaceSnapshotProcessStderrMarkers(
  value: unknown,
): HostedWorkspaceSnapshotProcessStderrMarker[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const allowed = new Set<HostedWorkspaceSnapshotProcessStderrMarker>();
  for (const entry of value) {
    if (
      typeof entry === "string"
      && HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_MARKERS.includes(
        entry as HostedWorkspaceSnapshotProcessStderrMarker,
      )
    ) {
      allowed.add(entry as HostedWorkspaceSnapshotProcessStderrMarker);
    }
  }
  return [...allowed].sort();
}
