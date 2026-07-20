import { Buffer } from "node:buffer";

const INLINE_SOURCE_MAP_PREFIX =
  "sourceMappingURL=data:application/json;charset=utf-8;base64,";

export const HOSTED_TEMPORAL_WORKFLOW_BUNDLE_MAX_BYTES = 2_359_296;

const HOSTED_TEMPORAL_WORKFLOW_BUNDLE_FORBIDDEN_SOURCES = [
  {
    fragment: "/packages/contracts/",
    label: "@murphai/contracts",
  },
  {
    fragment: "/packages/hosted-execution/src/vault-share.ts",
    label: "hosted-execution vault-share",
  },
] as const;

export interface HostedTemporalWorkflowBundleSummary {
  byteLength: number;
  sourceCount: number;
}

export function assertHostedTemporalWorkflowBundle(
  code: string,
): HostedTemporalWorkflowBundleSummary {
  const byteLength = Buffer.byteLength(code, "utf8");
  if (byteLength > HOSTED_TEMPORAL_WORKFLOW_BUNDLE_MAX_BYTES) {
    throw new Error(
      `Hosted Temporal workflow bundle is ${byteLength} bytes; the production limit is ${HOSTED_TEMPORAL_WORKFLOW_BUNDLE_MAX_BYTES} bytes. Keep Workflow imports dependency-light.`,
    );
  }

  const sources = readInlineSourceMapSources(code);
  for (const forbidden of HOSTED_TEMPORAL_WORKFLOW_BUNDLE_FORBIDDEN_SOURCES) {
    if (
      sources.some((source) =>
        normalizeSourcePath(source).includes(forbidden.fragment)
      )
    ) {
      throw new Error(
        `Hosted Temporal workflow bundle includes forbidden source ${forbidden.label}. Keep Workflow imports dependency-light and move shared constants into leaf modules.`,
      );
    }
  }

  return {
    byteLength,
    sourceCount: sources.length,
  };
}

function readInlineSourceMapSources(code: string): readonly string[] {
  const markerIndex = code.lastIndexOf(INLINE_SOURCE_MAP_PREFIX);
  if (markerIndex === -1) {
    throw new Error(
      "Hosted Temporal workflow bundle is missing its inline source map; dependency-policy verification cannot continue.",
    );
  }

  const encodedSourceMap = code
    .slice(markerIndex + INLINE_SOURCE_MAP_PREFIX.length)
    .trim();
  if (!encodedSourceMap) {
    throw new Error(
      "Hosted Temporal workflow bundle has an empty inline source map; dependency-policy verification cannot continue.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encodedSourceMap, "base64").toString("utf8"));
  } catch {
    throw new Error(
      "Hosted Temporal workflow bundle has an invalid inline source map; dependency-policy verification cannot continue.",
    );
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.sources)) {
    throw new Error(
      "Hosted Temporal workflow bundle source map has no sources list; dependency-policy verification cannot continue.",
    );
  }
  const sources: string[] = [];
  for (const source of parsed.sources) {
    if (typeof source !== "string") {
      throw new Error(
        "Hosted Temporal workflow bundle source map contains an invalid source entry; dependency-policy verification cannot continue.",
      );
    }
    sources.push(source);
  }
  return sources;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSourcePath(source: string): string {
  return source.replaceAll("\\", "/");
}
