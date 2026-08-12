import {
  DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE,
  isDeviceSyncConnectionSetupConfirmed,
  isEstablishedDeviceSyncConnection,
  requiresHistoricalResetDeviceSyncSource,
} from "@murphai/device-syncd/public-account";

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
  connectionAvailable?: boolean | null;
  connectTarget: string;
  connectTargetAmbiguous?: boolean | null;
  connectTargetCommandSafe?: boolean | null;
  label: string;
  provider: string;
  sourceProviderSlug?: string | null;
}

interface HostedDeviceSyncReconnectNotice {
  commandConnectTarget: string | null;
  commandConnectTargetSafe: boolean;
  errorCode: string;
  label: string;
  sourceProviderSlug: string | null;
}

const HOSTED_DEVICE_SYNC_RECONNECT_REQUIRED_SOURCE_ERROR_CODES = new Set([
  DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE,
  "INVALID_GRANT",
  "OAUTH_REAUTHORIZATION_REQUIRED",
  "PROVIDER_CREDENTIAL_ERROR",
  "TOKEN_REFRESH_EXPIRED",
  "TOKEN_REFRESH_FAILED",
]);
const HOSTED_DEVICE_SYNC_STATUS_NOTICE_LIMIT = 4;

export async function buildHostedDeviceSyncStatusPrompt(input: {
  deviceSyncPort: HostedRuntimeDeviceSyncPort | null | undefined;
  reconnectTargets: readonly HostedDeviceSyncStatusPromptReconnectTarget[];
  signal?: AbortSignal | null;
}): Promise<string | null> {
  if (!input.deviceSyncPort) {
    return null;
  }

  const snapshot = await fetchHostedDeviceSyncStatusSnapshot({
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

export async function resolveHostedDeviceSyncRecoveryConnectTarget(input: {
  deviceSyncPort: HostedRuntimeDeviceSyncPort;
  reconnectTargets: readonly HostedDeviceSyncStatusPromptReconnectTarget[];
  requestedConnectTarget: string;
  signal?: AbortSignal | null;
}): Promise<string | null> {
  const requestedConnectTarget = normalizeHostedDeviceSyncKey(
    input.requestedConnectTarget,
  );
  if (!requestedConnectTarget) {
    return null;
  }

  const reconnectTarget = input.reconnectTargets.find((target) =>
    target.connectionAvailable !== false
    && isHostedDeviceSyncReconnectCommandSafe(target)
    && normalizeHostedDeviceSyncKey(target.connectTarget) === requestedConnectTarget
  );
  if (!reconnectTarget) {
    return null;
  }

  const snapshot = await fetchHostedDeviceSyncStatusSnapshot({
    deviceSyncPort: input.deviceSyncPort,
    reconnectTargets: [reconnectTarget],
    signal: input.signal ?? null,
  });
  if (!snapshot) {
    return null;
  }

  const notice = collectHostedDeviceSyncReconnectNotices({
    reconnectTargets: [reconnectTarget],
    snapshot,
  }).find((candidate) =>
    candidate.commandConnectTargetSafe
    && normalizeHostedDeviceSyncKey(candidate.commandConnectTarget)
      === requestedConnectTarget
  );
  return notice?.commandConnectTarget ?? null;
}

async function fetchHostedDeviceSyncStatusSnapshot(input: {
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
        limit: HOSTED_DEVICE_SYNC_STATUS_NOTICE_LIMIT,
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
      const existing = connections.get(entry.connection.id);
      connections.set(
        entry.connection.id,
        existing
          ? mergeHostedDeviceSyncStatusConnectionSnapshots(existing, entry)
          : entry,
      );
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

function mergeHostedDeviceSyncStatusConnectionSnapshots(
  existing: HostedDeviceSyncRuntimeConnectionSnapshot,
  next: HostedDeviceSyncRuntimeConnectionSnapshot,
): HostedDeviceSyncRuntimeConnectionSnapshot {
  return {
    ...existing,
    sources: mergeHostedDeviceSyncStatusSources(
      existing.sources ?? [],
      next.sources ?? [],
    ),
  };
}

function mergeHostedDeviceSyncStatusSources(
  existingSources: readonly HostedDeviceSyncRuntimeConnectionSourceSnapshot[],
  nextSources: readonly HostedDeviceSyncRuntimeConnectionSourceSnapshot[],
): HostedDeviceSyncRuntimeConnectionSourceSnapshot[] {
  const merged = new Map<string, HostedDeviceSyncRuntimeConnectionSourceSnapshot>();

  for (const source of [...existingSources, ...nextSources]) {
    const key = buildHostedDeviceSyncSourceMergeKey(source);
    if (!merged.has(key)) {
      merged.set(key, source);
    }
  }

  return [...merged.values()];
}

function buildHostedDeviceSyncSourceMergeKey(
  source: HostedDeviceSyncRuntimeConnectionSourceSnapshot,
): string {
  const sourceInstanceKey = normalizeHostedDeviceSyncMergeKey(source.sourceInstanceKey);
  if (sourceInstanceKey) {
    return `instance:${sourceInstanceKey}`;
  }

  return `provider:${normalizeHostedDeviceSyncMergeKey(source.sourceProviderSlug) ?? ""}`;
}

function normalizeHostedDeviceSyncMergeKey(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function buildHostedDeviceSyncStatusPromptFromSnapshot(input: {
  reconnectTargets: readonly HostedDeviceSyncStatusPromptReconnectTarget[];
  snapshot: HostedDeviceSyncRuntimeSnapshot;
}): string | null {
  const activeConnections = collectHostedDeviceSyncActiveConnections({
    reconnectTargets: input.reconnectTargets,
    snapshot: input.snapshot,
  });
  const notices = collectHostedDeviceSyncReconnectNotices({
    reconnectTargets: input.reconnectTargets,
    snapshot: input.snapshot,
  });
  const reconnectLabels = new Set(
    notices.map((notice) => notice.label.trim().toLowerCase()),
  );
  const activeConnectionLines = activeConnections
    .filter((label) => !reconnectLabels.has(label.trim().toLowerCase()))
    .slice(0, HOSTED_DEVICE_SYNC_STATUS_NOTICE_LIMIT)
    .map((label) => `- ${label} has an active connection.`);
  const noticeLines = notices
    .slice(0, HOSTED_DEVICE_SYNC_STATUS_NOTICE_LIMIT)
    .map(renderHostedDeviceSyncReconnectNoticeLine);
  const statusLines = [...activeConnectionLines, ...noticeLines];
  if (statusLines.length === 0) {
    return null;
  }

  return [
    "Wearable connection status for this turn:",
    ...statusLines,
    "",
    "Use this operational context when answering:",
    "- Treat every active or reconnect-required wearable above as already set up. Do not offer initial wearable connection; offer reconnect only when the status explicitly says it is required.",
    ...(notices.length > 0
      ? [
          "- For sleep, recovery, activity, workout, health digest, stale wearable data, or missing-device questions, say the affected wearable needs reconnect before interpreting gaps.",
          "- Do not treat missing wearable data after the latest imported day as no sleep, no workouts, no activity, or failed adherence.",
        ]
      : []),
    "- When the exact latest imported data day matters, verify it with `vault-cli wearables sources list --format json` or the relevant normalized `vault-cli wearables ... --format json` command before naming a date.",
    "- In user-facing replies, use product labels such as WHOOP. Never name the internal sync provider; for low-level problems, say device connection or sync service.",
  ].join("\n");
}

function collectHostedDeviceSyncActiveConnections(input: {
  reconnectTargets: readonly HostedDeviceSyncStatusPromptReconnectTarget[];
  snapshot: HostedDeviceSyncRuntimeSnapshot;
}): string[] {
  const labels = new Map<string, string>();

  for (const entry of input.snapshot.connections) {
    if (!isEstablishedDeviceSyncConnection(entry.connection)) {
      continue;
    }

    let hasLabeledSource = false;
    for (const source of entry.sources ?? []) {
      if (source.status !== "connected") {
        continue;
      }

      const reconnectTarget = resolveHostedDeviceSyncReconnectTargetForSource({
        reconnectTargets: input.reconnectTargets,
        sourceProviderSlug: source.sourceProviderSlug,
      });
      const label = reconnectTarget?.label
        ?? formatHostedDeviceSyncProviderLabel(source.sourceProviderSlug);
      labels.set(label.trim().toLowerCase(), label);
      hasLabeledSource = true;
    }

    if (hasLabeledSource) {
      continue;
    }

    const provider = normalizeHostedDeviceSyncKey(entry.connection.provider);
    const reconnectTarget = provider
      ? resolveHostedDeviceSyncReconnectTargetForProvider({
          provider,
          reconnectTargets: input.reconnectTargets,
        })
      : null;
    const label = reconnectTarget?.label
      ?? (provider && provider !== "junction"
        ? formatHostedDeviceSyncProviderLabel(provider)
        : null);
    if (label) {
      labels.set(label.trim().toLowerCase(), label);
    }
  }

  return [...labels.values()];
}

function collectHostedDeviceSyncReconnectNotices(input: {
  reconnectTargets: readonly HostedDeviceSyncStatusPromptReconnectTarget[];
  snapshot: HostedDeviceSyncRuntimeSnapshot;
}): HostedDeviceSyncReconnectNotice[] {
  const notices: HostedDeviceSyncReconnectNotice[] = [];
  const seen = new Set<string>();

  for (const entry of input.snapshot.connections) {
    if (
      entry.connection.status === "disconnected"
      || !isDeviceSyncConnectionSetupConfirmed(entry.connection)
    ) {
      continue;
    }

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
  if (
    errorCode === DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE
    && !requiresHistoricalResetDeviceSyncSource(input.source)
  ) {
    return null;
  }

  const reconnectTarget = resolveHostedDeviceSyncReconnectTargetForSource({
    reconnectTargets: input.reconnectTargets,
    sourceProviderSlug: input.source.sourceProviderSlug,
  });
  const sourceProviderSlug = normalizeHostedDeviceSyncKey(input.source.sourceProviderSlug);

  return {
    commandConnectTarget: reconnectTarget?.connectionAvailable === false
      ? null
      : reconnectTarget?.connectTarget ?? null,
    commandConnectTargetSafe: isHostedDeviceSyncReconnectCommandSafe(reconnectTarget),
    errorCode,
    label: reconnectTarget?.label
      ?? formatHostedDeviceSyncProviderLabel(input.source.sourceProviderSlug),
    sourceProviderSlug,
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

  const reconnectTarget = resolveHostedDeviceSyncReconnectTargetForConnectionSources({
    connection: input.connection,
    reconnectTargets: input.reconnectTargets,
  }) ?? resolveHostedDeviceSyncReconnectTargetForProvider({
    provider,
    reconnectTargets: input.reconnectTargets,
  });
  const errorCode = normalizeHostedDeviceSyncErrorCode(
    input.connection.localState.lastErrorCode,
  ) ?? "REAUTHORIZATION_REQUIRED";

  return {
    commandConnectTarget: reconnectTarget?.connectionAvailable === false
      ? null
      : reconnectTarget?.connectTarget ?? null,
    commandConnectTargetSafe: isHostedDeviceSyncReconnectCommandSafe(reconnectTarget),
    errorCode,
    label: reconnectTarget?.label
      ?? (provider === "junction"
        ? "Wearable connection"
        : formatHostedDeviceSyncProviderLabel(provider)),
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
  if (notice.errorCode === DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE) {
    const recoveryLabel = notice.sourceProviderSlug === "garmin" ? "Garmin" : notice.label;
    return `- ${notice.label} historical data remained incomplete after bounded sync checks (error \`${notice.errorCode}\`). Current data may still arrive. Do not send a connect-only link because it cannot restart the historical export. Guide the member to wearable settings, explain that the existing connection reset may also disconnect other wearables on that shared connection, and ask them to explicitly confirm the disconnect before reconnecting ${recoveryLabel}.`;
  }

  const subjectText = notice.sourceProviderSlug
    ? `source \`${notice.sourceProviderSlug}\` is`
    : "account is";
  const reconnectText = notice.commandConnectTarget && notice.commandConnectTargetSafe
    ? ` To send a reconnect link, run \`vault-cli device connect ${notice.commandConnectTarget} --format json\` and use the returned \`connectUrl\`.`
    : notice.commandConnectTarget
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
    && normalizeHostedDeviceSyncKey(target.sourceProviderSlug) === null
  ) ?? null;
}

function isHostedDeviceSyncReconnectCommandSafe(
  reconnectTarget: HostedDeviceSyncStatusPromptReconnectTarget | null,
): boolean {
  if (!reconnectTarget) {
    return false;
  }

  if (reconnectTarget.connectTargetCommandSafe === true) {
    return true;
  }

  if (reconnectTarget.connectTargetCommandSafe === false) {
    return false;
  }

  return reconnectTarget.connectTargetAmbiguous !== true;
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
