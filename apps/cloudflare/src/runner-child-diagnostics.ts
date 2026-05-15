export type HostedRunnerChildFirstCompletionKind = "child_result" | "close";

const HOSTED_RUNNER_CHILD_FIRST_COMPLETION_KINDS = new Set<string>([
  "child_result",
  "close",
]);

const HOSTED_RUNNER_CHILD_OUTPUT_MARKER_VALUES = [
  "hosted_assistant_config_required",
  "hosted_child_debug_after_run",
  "hosted_child_debug_before_run",
  "hosted_child_debug_run_error",
  "hosted_child_failed_unexpectedly",
  "hosted_child_parse_failed",
  "hosted_child_prepared",
  "ipc_channel_required",
  "module_resolution_failed",
  "syntax_error",
  "tsx_import_failure",
  "uncaught_exception",
] as const;

export type HostedRunnerChildOutputMarker =
  typeof HOSTED_RUNNER_CHILD_OUTPUT_MARKER_VALUES[number];

const HOSTED_RUNNER_CHILD_OUTPUT_MARKERS = new Set<string>(
  HOSTED_RUNNER_CHILD_OUTPUT_MARKER_VALUES,
);

const HOSTED_RUNNER_CHILD_OUTPUT_MARKER_PATTERNS: ReadonlyArray<{
  marker: HostedRunnerChildOutputMarker;
  pattern: RegExp;
}> = [
  {
    marker: "hosted_child_prepared",
    pattern: /Hosted node runner child prepared workspace invocation/iu,
  },
  {
    marker: "hosted_child_parse_failed",
    pattern: /Hosted node runner child failed to parse its bootstrap payload/iu,
  },
  {
    marker: "hosted_child_failed_unexpectedly",
    pattern: /Hosted node runner child failed unexpectedly/iu,
  },
  {
    marker: "hosted_child_debug_before_run",
    pattern: /\[hosted-runner-child:before-run\]/iu,
  },
  {
    marker: "hosted_child_debug_after_run",
    pattern: /\[hosted-runner-child:after-run\]/iu,
  },
  {
    marker: "hosted_child_debug_run_error",
    pattern: /\[hosted-runner-child:run-error\]/iu,
  },
  {
    marker: "hosted_assistant_config_required",
    pattern: /HOSTED_ASSISTANT_CONFIG_REQUIRED/iu,
  },
  {
    marker: "module_resolution_failed",
    pattern: /ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package/iu,
  },
  {
    marker: "syntax_error",
    pattern: /SyntaxError/iu,
  },
  {
    marker: "tsx_import_failure",
    pattern: /tsx.*(?:ERR_|import|loader|register)|(?:ERR_|import|loader|register).*tsx/iu,
  },
  {
    marker: "ipc_channel_required",
    pattern: /requires an IPC|IPC result channel|IPC runtime wake channel|ERR_IPC_CHANNEL_CLOSED/iu,
  },
  {
    marker: "uncaught_exception",
    pattern: /Uncaught Exception|UnhandledPromiseRejection|unhandled rejection/iu,
  },
];

export function collectHostedRunnerChildOutputMarkers(
  value: string,
): HostedRunnerChildOutputMarker[] {
  const markers = new Set<HostedRunnerChildOutputMarker>();
  for (const { marker, pattern } of HOSTED_RUNNER_CHILD_OUTPUT_MARKER_PATTERNS) {
    if (pattern.test(value)) {
      markers.add(marker);
    }
  }

  return [...markers].sort();
}

export function countHostedRunnerOutputLines(value: string): number {
  const trimmed = value.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\r?\n/u).length;
}

export function readHostedRunnerChildFirstCompletionKind(
  value: unknown,
): HostedRunnerChildFirstCompletionKind | null {
  return typeof value === "string" && isHostedRunnerChildFirstCompletionKind(value)
    ? value
    : null;
}

export function readHostedRunnerChildOutputMarkers(
  value: unknown,
): HostedRunnerChildOutputMarker[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const markers = value
    .flatMap((entry): HostedRunnerChildOutputMarker[] => {
      return typeof entry === "string" && isHostedRunnerChildOutputMarker(entry)
        ? [entry]
        : [];
    })
    .slice(0, 16);

  return markers.length > 0 ? markers : null;
}

function isHostedRunnerChildFirstCompletionKind(
  value: string,
): value is HostedRunnerChildFirstCompletionKind {
  return HOSTED_RUNNER_CHILD_FIRST_COMPLETION_KINDS.has(value);
}

function isHostedRunnerChildOutputMarker(
  value: string,
): value is HostedRunnerChildOutputMarker {
  return HOSTED_RUNNER_CHILD_OUTPUT_MARKERS.has(value);
}
