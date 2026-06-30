import type {
  HostedRuntimeDeviceSyncPort,
} from "./platform.ts";

type HostedDeviceSyncRuntimeSnapshot = Awaited<
  ReturnType<HostedRuntimeDeviceSyncPort["fetchSnapshot"]>
>;
type HostedDeviceSyncRuntimeConnectionSnapshot =
  HostedDeviceSyncRuntimeSnapshot["connections"][number];
type HostedDeviceSyncRuntimeConnectionSourceSnapshot = NonNullable<
  HostedDeviceSyncRuntimeConnectionSnapshot["sources"]
>[number];

export interface HostedDeviceSyncStatusPromptReconnectTarget {
  connectTarget: string;
  connectTargetAmbiguous?: boolean | null;
  label: string;
  provider: string;
  sourceProviderSlug?: string | null;
}

interface HostedDeviceSyncReconnectNotice {
  commandConnectTarget: string | null;
  commandConnectTargetAmbiguous: boolean;
  errorCode: string;
  label: string;
  sourceProviderSlug: string | null;
}

const HOSTED_DEVICE_SYNC_RECONNECT_REQUIRED_SOURCE_ERROR_CODES = new Set([
  "INVALID_GRANT",
  "OAUTH_REAUTHORIZATION_REQUIRED",
  "PROVIDER_CREDENTIAL_ERROR",
  "TOKEN_REFRESH_EXPIRED",
  "TOKEN_REFRESH_FAILED",
]);
const HOSTED_DEVICE_SYNC_RECONNECT_NOTICE_LIMIT = 4;

export async function buildHostedDeviceSyncStatusPrompt(input: {
  deviceSyncPort: HostedRuntimeDeviceSyncPort | null | undefined;
  reconnectTargets: readonly HostedDeviceSyncStatusPromptReconnectTarget[];
  signal?: AbortSignal | null;
}): Promise<string | null> {
  if (!input.deviceSyncPort) {
    return null;
  }

  const snapshot = await fetchHostedDeviceSyncReconnectStatusSnapshot({
    deviceSyncPort: input.deviceSyncPort,
    reconnectTargets: input.reconnectTargets,
    signal: input.signal ?? null,
  });
  if (!snapshot) {
    return null;
  }

  return buildHostedDeviceSyncStatusPromptFromSnapshot({
    reconnectTargets: input.reconnectTargets,
    snapshot,
  });
}

async function fetchHostedDeviceSyncReconnectStatusSnapshot(input: {
  deviceSyncPort: HostedRuntimeDeviceSyncPort;
  reconnectTargets: readonly HostedDeviceSyncStatusPromptReconnectTarget[];
  signal: AbortSignal | null;
}): Promise<HostedDeviceSyncRuntimeSnapshot | null> {
  if (input.reconnectTargets.length === 0) {
    return null;
  }

  const snapshots = await Promise.all(
    input.reconnectTargets.map(async (target) => {
      const sourceProviderSlug = normalizeHostedDeviceSyncKey(target.sourceProviderSlug);
      const provider = normalizeHostedDeviceSyncKey(target.provider);
      if (!sourceProviderSlug && !provider) {
        return null;
      }

      return await input.deviceSyncPort.fetchSnapshot({
        includeCredentialMaterial: false,
        limit: HOSTED_DEVICE_SYNC_RECONNECT_NOTICE_LIMIT,
        ...(sourceProviderSlug ? { sourceProviderSlug } : { provider }),
        signal: input.signal,
      }).catch(() => null);
    }),
  );

  return mergeHostedDeviceSyncStatusSnapshots(snapshots);
}

function mergeHostedDeviceSyncStatusSnapshots(
  snapshots: readonly (HostedDeviceSyncRuntimeSnapshot | null)[],
): HostedDeviceSyncRuntimeSnapshot | null {
  const connections = new Map<string, HostedDeviceSyncRuntimeConnectionSnapshot>();
  let generatedAt: string | null = null;
  let userId: string | null = null;

  for (const snapshot of snapshots) {
    if (!snapshot) {
      continue;
    }
    generatedAt ??= snapshot.generatedAt;
    userId ??= snapshot.userId;
    for (const entry of snapshot.connections) {
      connections.set(entry.connection.id, entry);
    }
  }

  if (connections.size === 0 || !generatedAt || !userId) {
    return null;
  }

  return {
    connections: [...connections.values()],
    generatedAt,
    userId,
  };
}

export function buildHostedDeviceSyncStatusPromptFromSnapshot(input: {
  reconnectTargets: readonly HostedDeviceSyncStatusPromptReconnectTarget[];
  snapshot: HostedDeviceSyncRuntimeSnapshot;
}): string | null {
  const notices = collectHostedDeviceSyncReconnectNotices({
    reconnectTargets: input.reconnectTargets,
    snapshot: input.snapshot,
  });
  if (notices.length === 0) {
    return null;
  }

  const noticeLines = notices
    .slice(0, HOSTED_DEVICE_SYNC_RECONNECT_NOTICE_LIMIT)
    .map(renderHostedDeviceSyncReconnectNoticeLine);

  return [
    "Connected wearable sync status for this turn:",
    ...noticeLines,
    "",
    "Use this operational context when answering:",
    "- For sleep, recovery, activity, workout, health digest, stale wearable data, or missing-device questions, say the affected wearable needs reconnect before interpreting gaps.",
    "- Do not treat missing wearable data after the latest imported day as no sleep, no workouts, no activity, or failed adherence.",
    "- When the exact latest imported data day matters, verify it with `vault-cli wearables sources list --format json` or the relevant normalized `vault-cli wearables ... --format json` command before naming a date.",
    "- In user-facing replies, use product labels such as WHOOP. Mention Junction only when debugging low-level sync plumbing.",
  ].join("\n");
}

function collectHostedDeviceSyncReconnectNotices(input: {
  reconnectTargets: readonly HostedDeviceSyncStatusPromptReconnectTarget[];
  snapshot: HostedDeviceSyncRuntimeSnapshot;
}): HostedDeviceSyncReconnectNotice[] {
  const notices: HostedDeviceSyncReconnectNotice[] = [];
  const seen = new Set<string>();

  for (const entry of input.snapshot.connections) {
    for (const source of entry.sources ?? []) {
      const sourceNotice = buildHostedDeviceSyncSourceReconnectNotice({
        reconnectTargets: input.reconnectTargets,
        source,
      });
      if (sourceNotice) {
        addHostedDeviceSyncReconnectNotice(notices, seen, sourceNotice);
      }
    }

    const accountNotice = buildHostedDeviceSyncAccountReconnectNotice({
      connection: entry,
      reconnectTargets: input.reconnectTargets,
    });
    if (accountNotice) {
      addHostedDeviceSyncReconnectNotice(notices, seen, accountNotice);
    }
  }

  return notices;
}

function buildHostedDeviceSyncSourceReconnectNotice(input: {
  reconnectTargets: readonly HostedDeviceSyncStatusPromptReconnectTarget[];
  source: HostedDeviceSyncRuntimeConnectionSourceSnapshot;
}): HostedDeviceSyncReconnectNotice | null {
  if (input.source.status !== "error") {
    return null;
  }

  const errorCode = normalizeHostedDeviceSyncErrorCode(input.source.lastErrorCode);
  if (
    !errorCode
    || !HOSTED_DEVICE_SYNC_RECONNECT_REQUIRED_SOURCE_ERROR_CODES.has(errorCode)
  ) {
    return null;
  }

  const reconnectTarget = resolveHostedDeviceSyncReconnectTargetForSource({
    reconnectTargets: input.reconnectTargets,
    sourceProviderSlug: input.source.sourceProviderSlug,
  });

  return {
    commandConnectTarget: reconnectTarget?.connectTarget ?? null,
    commandConnectTargetAmbiguous: reconnectTarget?.connectTargetAmbiguous === true,
    errorCode,
    label: reconnectTarget?.label
      ?? input.source.displayName
      ?? formatHostedDeviceSyncProviderLabel(input.source.sourceProviderSlug),
    sourceProviderSlug: normalizeHostedDeviceSyncKey(input.source.sourceProviderSlug),
  };
}

function buildHostedDeviceSyncAccountReconnectNotice(input: {
  connection: HostedDeviceSyncRuntimeConnectionSnapshot;
  reconnectTargets: readonly HostedDeviceSyncStatusPromptReconnectTarget[];
}): HostedDeviceSyncReconnectNotice | null {
  if (input.connection.connection.status !== "reauthorization_required") {
    return null;
  }

  const provider = normalizeHostedDeviceSyncKey(input.connection.connection.provider);
  if (!provider) {
    return null;
  }

  const reconnectTarget = resolveHostedDeviceSyncReconnectTargetForProvider({
    provider,
    reconnectTargets: input.reconnectTargets,
  }) ?? resolveHostedDeviceSyncReconnectTargetForConnectionSources({
    connection: input.connection,
    reconnectTargets: input.reconnectTargets,
  });
  const errorCode = normalizeHostedDeviceSyncErrorCode(
    input.connection.localState.lastErrorCode,
  ) ?? "REAUTHORIZATION_REQUIRED";

  return {
    commandConnectTarget: reconnectTarget?.connectTarget ?? null,
    commandConnectTargetAmbiguous: reconnectTarget?.connectTargetAmbiguous === true,
    errorCode,
    label: reconnectTarget?.label
      ?? input.connection.connection.displayName
      ?? formatHostedDeviceSyncProviderLabel(provider),
    sourceProviderSlug: null,
  };
}

function addHostedDeviceSyncReconnectNotice(
  notices: HostedDeviceSyncReconnectNotice[],
  seen: Set<string>,
  notice: HostedDeviceSyncReconnectNotice,
): void {
  const key = [
    normalizeHostedDeviceSyncKey(notice.commandConnectTarget) ?? "",
    normalizeHostedDeviceSyncKey(notice.sourceProviderSlug) ?? "",
    normalizeHostedDeviceSyncErrorCode(notice.errorCode) ?? "",
    notice.label.trim().toLowerCase(),
  ].join("|");
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  notices.push(notice);
}

function renderHostedDeviceSyncReconnectNoticeLine(
  notice: HostedDeviceSyncReconnectNotice,
): string {
  const subjectText = notice.sourceProviderSlug
    ? `source \`${notice.sourceProviderSlug}\` is`
    : "account is";
  const reconnectText = notice.commandConnectTarget && !notice.commandConnectTargetAmbiguous
    ? ` To send a reconnect link, run \`vault-cli device connect ${notice.commandConnectTarget} --format json\` and use the returned \`connectUrl\`.`
    : notice.commandConnectTargetAmbiguous
      ? " A reconnect target is configured, but the generic device-connect command is ambiguous for this wearable/source; use an exact reconnect flow instead of `vault-cli device connect`."
    : " No hosted reconnect target is configured for this wearable/source in this turn.";

  return `- ${notice.label} currently needs reconnect: ${subjectText} in error state \`${notice.errorCode}\`. Murph may not see newer ${notice.label} data until reconnect completes.${reconnectText}`;
}

function resolveHostedDeviceSyncReconnectTargetForSource(input: {
  reconnectTargets: readonly HostedDeviceSyncStatusPromptReconnectTarget[];
  sourceProviderSlug: string;
}): HostedDeviceSyncStatusPromptReconnectTarget | null {
  const sourceProviderSlug = normalizeHostedDeviceSyncKey(input.sourceProviderSlug);
  if (!sourceProviderSlug) {
    return null;
  }

  return input.reconnectTargets.find((target) =>
    normalizeHostedDeviceSyncKey(target.sourceProviderSlug) === sourceProviderSlug
  ) ?? input.reconnectTargets.find((target) =>
    normalizeHostedDeviceSyncKey(target.provider) === sourceProviderSlug
  ) ?? null;
}

function resolveHostedDeviceSyncReconnectTargetForConnectionSources(input: {
  connection: HostedDeviceSyncRuntimeConnectionSnapshot;
  reconnectTargets: readonly HostedDeviceSyncStatusPromptReconnectTarget[];
}): HostedDeviceSyncStatusPromptReconnectTarget | null {
  for (const source of input.connection.sources ?? []) {
    if (source.status === "disconnected") {
      continue;
    }
    const reconnectTarget = resolveHostedDeviceSyncReconnectTargetForSource({
      reconnectTargets: input.reconnectTargets,
      sourceProviderSlug: source.sourceProviderSlug,
    });
    if (reconnectTarget) {
      return reconnectTarget;
    }
  }

  return null;
}

function resolveHostedDeviceSyncReconnectTargetForProvider(input: {
  provider: string;
  reconnectTargets: readonly HostedDeviceSyncStatusPromptReconnectTarget[];
}): HostedDeviceSyncStatusPromptReconnectTarget | null {
  const provider = normalizeHostedDeviceSyncKey(input.provider);
  if (!provider) {
    return null;
  }

  return input.reconnectTargets.find((target) =>
    normalizeHostedDeviceSyncKey(target.provider) === provider
  ) ?? null;
}

function normalizeHostedDeviceSyncErrorCode(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized ? normalized : null;
}

function normalizeHostedDeviceSyncKey(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return normalized ? normalized : null;
}

function formatHostedDeviceSyncProviderLabel(value: string): string {
  const normalized = normalizeHostedDeviceSyncKey(value);
  if (!normalized) {
    return "wearable source";
  }

  if (normalized === "whoop" || normalized === "whoop_v2") {
    return "WHOOP";
  }

  return normalized
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
