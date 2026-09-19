import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  annotateHostedWorkspaceSnapshotProcessFailure,
  captureHostedWorkspaceSnapshotProcessStderr,
  readHostedWorkspaceSnapshotProcessFailureDiagnostics,
  type HostedWorkspaceSnapshotProcessFailureDiagnostics,
} from "../src/workspace-snapshot-process-diagnostics.ts";

function failureDiagnostics(
  overrides: Partial<HostedWorkspaceSnapshotProcessFailureDiagnostics> = {},
): HostedWorkspaceSnapshotProcessFailureDiagnostics {
  return {
    exitCode: 17,
    label: "tar",
    signal: null,
    stderrByteCount: 0,
    stderrLineCount: 0,
    stderrMarkers: [],
    stderrTruncated: false,
    ...overrides,
  };
}

describe("workspace snapshot process diagnostics", () => {
  it("projects an absent stderr stream as empty diagnostics", () => {
    expect(captureHostedWorkspaceSnapshotProcessStderr(null).read()).toEqual({
      stderrByteCount: 0,
      stderrLineCount: 0,
      stderrMarkers: [],
      stderrTruncated: false,
    });
  });

  it("classifies split stderr chunks without retaining private text in the projection", () => {
    const stream = new PassThrough();
    const capture = captureHostedWorkspaceSnapshotProcessStderr(stream);
    const chunks = [
      "private-snapshot-detail: permi",
      "ssion denied\n",
      "no such file: synthetic-private-entry",
    ];
    for (const chunk of chunks) {
      stream.write(chunk);
    }
    stream.end();

    expect(capture.read()).toEqual({
      stderrByteCount: Buffer.byteLength(chunks.join("")),
      stderrLineCount: 2,
      stderrMarkers: ["not_found", "permission_denied"],
      stderrTruncated: false,
    });
    expect(JSON.stringify(capture.read())).not.toContain("private-snapshot-detail");
    expect(JSON.stringify(capture.read())).not.toContain("synthetic-private-entry");
  });

  it("keeps aggregate counts and earlier markers when the scan window truncates", () => {
    const stream = new PassThrough();
    const capture = captureHostedWorkspaceSnapshotProcessStderr(stream);
    const prefix = "no space left\n";
    const tail = `${"x".repeat(8192)}\nbroken pipe\n`;
    stream.write(prefix);
    stream.write(tail);
    stream.end();

    expect(capture.read()).toEqual({
      stderrByteCount: Buffer.byteLength(prefix + tail),
      stderrLineCount: 3,
      stderrMarkers: ["broken_pipe", "no_space_left"],
      stderrTruncated: true,
    });
  });

  it("annotates the original error non-enumerably and reads through nested causes", () => {
    const processError = new Error("synthetic process failure");
    const diagnostics = failureDiagnostics({
      stderrByteCount: 20,
      stderrLineCount: 1,
      stderrMarkers: ["io_error"],
    });
    annotateHostedWorkspaceSnapshotProcessFailure(processError, diagnostics);
    const wrapped = new Error("synthetic restore failure", { cause: processError });

    expect(wrapped.cause).toBe(processError);
    expect(readHostedWorkspaceSnapshotProcessFailureDiagnostics(wrapped)).toEqual(diagnostics);
    expect(Object.keys(processError)).toEqual([]);
    expect(JSON.stringify(processError)).toBe("{}");
    expect({ ...processError }).toEqual({});
  });

  it("returns the nearest process diagnostic when nested failures are annotated", () => {
    const inner = new Error("inner");
    const outer = new Error("outer", { cause: inner });
    annotateHostedWorkspaceSnapshotProcessFailure(inner, failureDiagnostics({ label: "tar" }));
    annotateHostedWorkspaceSnapshotProcessFailure(outer, failureDiagnostics({ label: "zstd" }));

    expect(readHostedWorkspaceSnapshotProcessFailureDiagnostics(outer)?.label).toBe("zstd");
  });

  it("does not mask a frozen process error when annotation is unavailable", () => {
    const error = Object.freeze(new Error("synthetic process failure"));

    expect(() => annotateHostedWorkspaceSnapshotProcessFailure(error, failureDiagnostics()))
      .not.toThrow();
    expect(readHostedWorkspaceSnapshotProcessFailureDiagnostics(error)).toBeNull();
  });

  it("terminates cyclic cause traversal while preserving a reachable diagnostic", () => {
    const first = new Error("first");
    const second = new Error("second", { cause: first });
    first.cause = second;

    expect(readHostedWorkspaceSnapshotProcessFailureDiagnostics(first)).toBeNull();
    annotateHostedWorkspaceSnapshotProcessFailure(second, failureDiagnostics());
    expect(readHostedWorkspaceSnapshotProcessFailureDiagnostics(first)).toEqual(failureDiagnostics());
  });

  it.each([-1, 0.5, 1024 * 1024 + 1])(
    "rejects a diagnostic with an out-of-contract stderr count (%s)",
    (stderrByteCount) => {
      const error = new Error("synthetic process failure");
      annotateHostedWorkspaceSnapshotProcessFailure(error, failureDiagnostics({ stderrByteCount }));

      expect(readHostedWorkspaceSnapshotProcessFailureDiagnostics(error)).toBeNull();
    },
  );

  it("filters invalid exit details and returns unique ordered markers", () => {
    const error = new Error("synthetic process failure");
    annotateHostedWorkspaceSnapshotProcessFailure(error, failureDiagnostics({
      exitCode: 0.5,
      signal: "private signal detail",
      stderrMarkers: ["permission_denied", "io_error", "permission_denied"],
    }));

    expect(readHostedWorkspaceSnapshotProcessFailureDiagnostics(error)).toEqual(failureDiagnostics({
      exitCode: null,
      signal: null,
      stderrMarkers: ["io_error", "permission_denied"],
    }));
  });
});
