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

    const merged = gatewayPermissionRequestSchema.parse({
      ...permission,
      note: override.note,
      resolvedAt: override.resolvedAt,
      status: override.status,
    });
    if (!sameStructuredValue(permission, merged)) {
      changed = true;
    }
    return merged;
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
    throw new TypeError("gateway.state storage is invalid.");
  }

  return value.map((entry): GatewayPermissionResolutionOverride => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("gateway.state storage is invalid.");
    }

    const record = entry as Record<string, unknown>;
    if (typeof record.requestId !== "string" || record.requestId.length === 0) {
      throw new TypeError("gateway.state storage is invalid.");
    }

    const status = record.status;
    if (status !== "approved" && status !== "denied" && status !== "expired") {
      throw new TypeError("gateway.state storage is invalid.");
    }

    if (typeof record.resolvedAt !== "string" || Number.isNaN(Date.parse(record.resolvedAt))) {
      throw new TypeError("gateway.state storage is invalid.");
    }

    if (record.note !== null && record.note !== undefined && typeof record.note !== "string") {
      throw new TypeError("gateway.state storage is invalid.");
    }

    return {
      note: typeof record.note === "string" && record.note.length > 0 ? record.note : null,
      requestId: record.requestId,
      resolvedAt: record.resolvedAt,
      status,
    };
  }).sort((left, right) => left.requestId.localeCompare(right.requestId));
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

function sameStructuredValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
