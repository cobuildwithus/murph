import {
  DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE,
  isDeviceSyncConnectionSetupConfirmed,
  isEstablishedDeviceSyncConnection,
  requiresHistoricalResetDeviceSyncSource,
} from "@murphai/device-syncd/public-account";
import type {
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";

import {
  fetchCompleteHostedDeviceSyncRuntimeSnapshot,
  type HostedDeviceSyncRuntimeSnapshotReader,
} from "./device-sync-snapshot-pagination.ts";

type HostedDeviceSyncRuntimeSnapshot = HostedExecutionDeviceSyncRuntimeSnapshotResponse;
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
  connectionAvailable: boolean | null;
  errorCode: string;
  label: string;
  sourceProviderSlug: string | null;
}

interface HostedDeviceSyncMemberEditConflictNotice {
  label: string;
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
const HOSTED_DEVICE_SYNC_MEMBER_EDIT_CONFLICT_ERROR_CODE =
  "DEVICE_DATA_MEMBER_EDIT_CONFLICT";

export async function buildHostedDeviceSyncStatusPrompt(input: {
  deviceSyncPort: HostedDeviceSyncRuntimeSnapshotReader | null | undefined;
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

async function fetchHostedDeviceSyncStatusSnapshot(input: {
  deviceSyncPort: HostedDeviceSyncRuntimeSnapshotReader;
  reconnectTargets: readonly HostedDeviceSyncStatusPromptReconnectTarget[];
  signal: AbortSignal | null;
}): Promise<HostedDeviceSyncRuntimeSnapshot | null> {
  if (input.reconnectTargets.length === 0) {
    return null;
  }

  const snapshot = await fetchCompleteHostedDeviceSyncRuntimeSnapshot({
    deviceSyncPort: input.deviceSyncPort,
    includeCredentialMaterial: false,
    signal: input.signal,
  }).catch(() => null);

  return snapshot
    ? projectHostedDeviceSyncStatusSnapshot({
        reconnectTargets: input.reconnectTargets,
        snapshot,
      })
    : null;
}

function projectHostedDeviceSyncStatusSnapshot(input: {
  reconnectTargets: readonly HostedDeviceSyncStatusPromptReconnectTarget[];
  snapshot: HostedDeviceSyncRuntimeSnapshot;
}): HostedDeviceSyncRuntimeSnapshot | null {
  const connections = input.snapshot.connections.flatMap((entry) => {
    const provider = normalizeHostedDeviceSyncKey(entry.connection.provider);
    const providerTarget = provider
      ? resolveHostedDeviceSyncReconnectTargetForProvider({
          provider,
          reconnectTargets: input.reconnectTargets,
        })
      : null;
    const sources = (entry.sources ?? []).filter((source) =>
      providerTarget !== null
      || hasHostedDeviceSyncReconnectTargetForConnectionSource({
        provider,
        reconnectTargets: input.reconnectTargets,
        sourceProviderSlug: source.sourceProviderSlug,
      })
    );

    return providerTarget || sources.length > 0
      ? [{ ...entry, sources }]
      : [];
  });

  if (connections.length === 0) {
    return null;
  }

  return {
    ...input.snapshot,
    connections: sortHostedDeviceSyncStatusConnections(connections),
  };
}

function hasHostedDeviceSyncReconnectTargetForConnectionSource(input: {
  provider: string | null;
  reconnectTargets: readonly HostedDeviceSyncStatusPromptReconnectTarget[];
  sourceProviderSlug: string;
}): boolean {
  const sourceProviderSlug = normalizeHostedDeviceSyncKey(input.sourceProviderSlug);
  if (!input.provider || !sourceProviderSlug) {
    return false;
  }

  return input.reconnectTargets.some((target) =>
    normalizeHostedDeviceSyncKey(target.provider) === input.provider
    && normalizeHostedDeviceSyncKey(target.sourceProviderSlug) === sourceProviderSlug
  );
}

function sortHostedDeviceSyncStatusConnections(
  connections: readonly HostedDeviceSyncRuntimeConnectionSnapshot[],
): HostedDeviceSyncRuntimeConnectionSnapshot[] {
  return [...connections].sort((left, right) => {
    const leftUpdatedAt = left.connection.updatedAt
      ?? left.connection.createdAt;
    const rightUpdatedAt = right.connection.updatedAt
      ?? right.connection.createdAt;
    return rightUpdatedAt.localeCompare(leftUpdatedAt)
      || right.connection.id.localeCompare(left.connection.id);
  });
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
  const memberEditConflictNotices = collectHostedDeviceSyncMemberEditConflictNotices({
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
  const memberEditConflictLines = memberEditConflictNotices
    .slice(0, HOSTED_DEVICE_SYNC_STATUS_NOTICE_LIMIT)
    .map(({ label }) =>
      `- ${label} has a connected-data conflict with a member correction (error \`${HOSTED_DEVICE_SYNC_MEMBER_EDIT_CONFLICT_ERROR_CODE}\`). Ask the member to choose either “keep my correction” or “use the connected source.” Only after an explicit choice, call \`murph.device\` with \`action: "list_accounts"\`, select the matching account whose \`lastErrorCode\` is \`${HOSTED_DEVICE_SYNC_MEMBER_EDIT_CONFLICT_ERROR_CODE}\`, then call \`action: "reconcile"\` with \`resolution: "keep_member"\` or \`resolution: "use_provider"\`. Do not expose internal event identities or provider payload values.`,
    );
  const statusLines = [...activeConnectionLines, ...noticeLines, ...memberEditConflictLines];
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
    ...(memberEditConflictNotices.length > 0
      ? [
          "- A member-edit conflict pauses only the conflicting atomic import. Do not imply either value won, and do not choose a resolution for the member.",
        ]
      : []),
    "- When the exact latest imported data day matters, verify it with `vault-cli wearables sources list --format json` or the relevant normalized `vault-cli wearables ... --format json` command before naming a date.",
    "- In user-facing replies, use product labels such as WHOOP. Never name the internal sync provider; for low-level problems, say device connection or sync service.",
  ].join("\n");
}

function collectHostedDeviceSyncMemberEditConflictNotices(input: {
  reconnectTargets: readonly HostedDeviceSyncStatusPromptReconnectTarget[];
  snapshot: HostedDeviceSyncRuntimeSnapshot;
}): HostedDeviceSyncMemberEditConflictNotice[] {
  const notices = new Map<string, HostedDeviceSyncMemberEditConflictNotice>();
  for (const entry of input.snapshot.connections) {
    if (
      !isEstablishedDeviceSyncConnection(entry.connection)
      || normalizeHostedDeviceSyncErrorCode(entry.localState.lastErrorCode)
        !== HOSTED_DEVICE_SYNC_MEMBER_EDIT_CONFLICT_ERROR_CODE
    ) {
      continue;
    }
    const reconnectTarget = resolveHostedDeviceSyncReconnectTargetForConnectionSources({
      connection: entry,
      reconnectTargets: input.reconnectTargets,
    }) ?? resolveHostedDeviceSyncReconnectTargetForProvider({
      provider: entry.connection.provider,
      reconnectTargets: input.reconnectTargets,
    });
    const label = reconnectTarget?.label
      ?? (normalizeHostedDeviceSyncKey(entry.connection.provider) === "junction"
        ? "Wearable connection"
        : formatHostedDeviceSyncProviderLabel(entry.connection.provider));
    notices.set(label.trim().toLowerCase(), { label });
  }
  return [...notices.values()];
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
    connectionAvailable: reconnectTarget?.connectionAvailable ?? null,
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
    connectionAvailable: reconnectTarget?.connectionAvailable ?? null,
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
  const reconnectText = notice.connectionAvailable === false
    ? " Reconnect is not currently available for this wearable/source. Do not offer or issue a reconnect link."
    : notice.commandConnectTarget && notice.commandConnectTargetSafe
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
