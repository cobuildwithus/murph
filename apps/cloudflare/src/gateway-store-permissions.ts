import {
  gatewayPermissionRequestSchema,
  gatewayProjectionSnapshotSchema,
  type GatewayPermissionRequest,
  type GatewayProjectionSnapshot,
} from "@murphai/gateway-core";

export interface GatewayPermissionResolutionOverride {
  note: string | null;
  requestId: string;
  resolvedAt: string;
  status: Exclude<GatewayPermissionRequest["status"], "open">;
}

export function mergeGatewayPermissionOverrides(
  snapshot: GatewayProjectionSnapshot | null,
  overrides: readonly GatewayPermissionResolutionOverride[],
): GatewayProjectionSnapshot | null {
  if (!snapshot || overrides.length === 0) {
    return snapshot;
  }

  const overridesByRequestId = new Map(overrides.map((override) => [override.requestId, override]));
  let changed = false;
  let generatedAt = snapshot.generatedAt;
  const permissions = snapshot.permissions.map((permission) => {
    const override = overridesByRequestId.get(permission.requestId);
    if (!override) {
      return permission;
    }

    if (override.resolvedAt.localeCompare(generatedAt) > 0) {
      generatedAt = override.resolvedAt;
    }

    if (sameGatewayPermissionOverrideApplication(permission, override)) {
      return permission;
    }

    changed = true;
    return gatewayPermissionRequestSchema.parse({
      ...permission,
      note: override.note,
      resolvedAt: override.resolvedAt,
      status: override.status,
    });
  });

  if (!changed && generatedAt === snapshot.generatedAt) {
    return snapshot;
  }

  return gatewayProjectionSnapshotSchema.parse({
    ...snapshot,
    generatedAt,
    permissions,
  });
}

export function readGatewayPermissionOverrides(
  value: unknown,
): GatewayPermissionResolutionOverride[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    invalidGatewayStateStorage();
  }

  return value
    .map(parseGatewayPermissionResolutionOverride)
    .sort((left, right) => left.requestId.localeCompare(right.requestId));
}

export function sameGatewayPermissionResolutionOverrides(
  left: readonly GatewayPermissionResolutionOverride[],
  right: readonly GatewayPermissionResolutionOverride[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => sameGatewayPermissionResolutionOverride(entry, right[index]));
}

export function pruneGatewayPermissionOverrides(
  overrides: readonly GatewayPermissionResolutionOverride[],
  snapshot: GatewayProjectionSnapshot,
): GatewayPermissionResolutionOverride[] {
  if (overrides.length === 0) {
    return [];
  }

  const requestIds = new Set(snapshot.permissions.map((permission) => permission.requestId));
  return overrides.filter((override) => requestIds.has(override.requestId));
}

export function upsertGatewayPermissionOverride(
  overrides: readonly GatewayPermissionResolutionOverride[],
  permission: GatewayPermissionRequest,
): GatewayPermissionResolutionOverride[] {
  const status = permission.status;
  if (status === "open") {
    throw new TypeError("Gateway permission overrides must not store open permissions.");
  }

  const nextOverrides = overrides.filter((override) => override.requestId !== permission.requestId);
  nextOverrides.push({
    note: permission.note,
    requestId: permission.requestId,
    resolvedAt: permission.resolvedAt ?? new Date().toISOString(),
    status,
  });

  return nextOverrides.sort((left, right) => left.requestId.localeCompare(right.requestId));
}

function parseGatewayPermissionResolutionOverride(
  value: unknown,
): GatewayPermissionResolutionOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidGatewayStateStorage();
  }

  const record = value as Record<string, unknown>;
  const requestId = record.requestId;
  if (typeof requestId !== "string" || requestId.length === 0) {
    invalidGatewayStateStorage();
  }

  const status = record.status;
  if (!isGatewayPermissionResolutionStatus(status)) {
    invalidGatewayStateStorage();
  }

  const resolvedAt = record.resolvedAt;
  if (typeof resolvedAt !== "string" || Number.isNaN(Date.parse(resolvedAt))) {
    invalidGatewayStateStorage();
  }

  return {
    note: normalizeGatewayPermissionResolutionNote(record.note),
    requestId,
    resolvedAt,
    status,
  };
}

function sameGatewayPermissionOverrideApplication(
  permission: GatewayPermissionRequest,
  override: GatewayPermissionResolutionOverride,
): boolean {
  return (
    permission.note === override.note
    && permission.requestId === override.requestId
    && permission.resolvedAt === override.resolvedAt
    && permission.status === override.status
  );
}

function sameGatewayPermissionResolutionOverride(
  left: GatewayPermissionResolutionOverride,
  right: GatewayPermissionResolutionOverride | undefined,
): boolean {
  return Boolean(
    right
    && left.note === right.note
    && left.requestId === right.requestId
    && left.resolvedAt === right.resolvedAt
    && left.status === right.status
  );
}

function normalizeGatewayPermissionResolutionNote(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    invalidGatewayStateStorage();
  }

  return value.length > 0 ? value : null;
}

function isGatewayPermissionResolutionStatus(
  value: unknown,
): value is GatewayPermissionResolutionOverride["status"] {
  return value === "approved" || value === "denied" || value === "expired";
}

function invalidGatewayStateStorage(): never {
  throw new TypeError("gateway.state storage is invalid.");
}
