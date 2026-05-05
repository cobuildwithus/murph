import path from "node:path";

import {
  isHostedBundleArtifactEntry,
  parseHostedBundleArchive,
  serializeHostedBundleArchive,
} from "./hosted-bundle.ts";
import {
  analyzeHostedWorkspaceSnapshotProviderContinuity,
} from "./hosted-bundles.ts";
import {
  ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH,
} from "./local-state-taxonomy.ts";

export interface LegacyHostedWorkspaceSnapshotProviderContinuityRepair {
  bundle: Uint8Array | ArrayBuffer;
  removedMalformedSessionCount: number;
  scrubbedSessionCount: number;
}

export function repairLegacyHostedWorkspaceSnapshotProviderContinuity(input: {
  bundle: Uint8Array | ArrayBuffer;
}): LegacyHostedWorkspaceSnapshotProviderContinuityRepair {
  const analysis = analyzeHostedWorkspaceSnapshotProviderContinuity(input);
  if (!analysis.hasProviderResumeState || analysis.hasCodexProviderContinuity) {
    return {
      bundle: input.bundle,
      removedMalformedSessionCount: 0,
      scrubbedSessionCount: 0,
    };
  }

  const archive = parseHostedBundleArchive(input.bundle);
  let removedMalformedSessionCount = 0;
  let scrubbedSessionCount = 0;
  const files = archive.files.flatMap((file) => {
    if (
      file.root !== "vault"
      || isHostedBundleArtifactEntry(file)
      || !hasWorkspaceSnapshotPathPrefix(
        normalizeWorkspaceSnapshotRelativePath(file.path),
        `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/sessions`,
      )
    ) {
      return [file];
    }

    const text = Buffer.from(file.contentsBase64, "base64").toString("utf8");
    const scrubbed = scrubAssistantSessionProviderResumeState(text);
    if (!scrubbed.changed) {
      return [file];
    }

    if (scrubbed.text === null) {
      removedMalformedSessionCount += 1;
      return [];
    }

    scrubbedSessionCount += 1;
    return [
      {
        ...file,
        contentsBase64: Buffer.from(scrubbed.text, "utf8").toString("base64"),
      },
    ];
  });

  return {
    bundle: serializeHostedBundleArchive({
      ...archive,
      files,
    }),
    removedMalformedSessionCount,
    scrubbedSessionCount,
  };
}

function scrubAssistantSessionProviderResumeState(text: string): {
  changed: boolean;
  text: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      changed: true,
      text: null,
    };
  }

  if (!isRecord(parsed)) {
    return {
      changed: false,
      text,
    };
  }

  let changed = false;
  const next: Record<string, unknown> = { ...parsed };
  if (recordStringProperty(next, "providerSessionId") !== null) {
    delete next.providerSessionId;
    changed = true;
  }

  if (recordStringProperty(recordProperty(next, "resumeState"), "providerSessionId") !== null) {
    next.resumeState = null;
    changed = true;
  }

  return {
    changed,
    text: changed ? `${JSON.stringify(next)}\n` : text,
  };
}

function hasWorkspaceSnapshotPathPrefix(relativePath: string, prefix: string): boolean {
  const normalizedRelativePath = normalizeWorkspaceSnapshotRelativePath(relativePath);
  const normalizedPrefix = normalizeWorkspaceSnapshotRelativePath(prefix);
  return (
    normalizedRelativePath === normalizedPrefix
    || normalizedRelativePath.startsWith(`${normalizedPrefix}${path.posix.sep}`)
  );
}

function normalizeWorkspaceSnapshotRelativePath(relativePath: string): string {
  return relativePath
    .replaceAll("\\", path.posix.sep)
    .split(path.posix.sep)
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join(path.posix.sep);
}

function recordProperty(value: unknown, propertyName: string): unknown {
  if (!isRecord(value)) {
    return null;
  }

  return value[propertyName];
}

function recordStringProperty(value: unknown, propertyName: string): string | null {
  const propertyValue = recordProperty(value, propertyName);
  return typeof propertyValue === "string" && propertyValue.trim().length > 0
    ? propertyValue
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
