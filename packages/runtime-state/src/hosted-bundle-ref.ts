export type HostedExecutionBundleKind = "vault" | "agent-state";

export interface HostedExecutionBundleRef {
  hash: string;
  key: string;
  size: number;
  // updatedAt is write metadata. Payload identity is hash + size; key is an opaque storage locator.
  updatedAt: string;
}

export type HostedExecutionBundleRefIdentity = Pick<
  HostedExecutionBundleRef,
  "hash" | "key" | "size"
>;

export function sameHostedBundlePayloadRef(
  left: HostedExecutionBundleRefIdentity | null | undefined,
  right: HostedExecutionBundleRefIdentity | null | undefined,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.hash === right.hash && left.size === right.size;
}

export function sameHostedExecutionBundleRef(
  left: HostedExecutionBundleRef | null | undefined,
  right: HostedExecutionBundleRef | null | undefined,
): boolean {
  return sameHostedBundlePayloadRef(left, right);
}

export function parseHostedExecutionBundleRef(
  value: unknown,
  label = "Hosted execution bundle ref",
): HostedExecutionBundleRef | null {
  if (value === null || value === undefined) {
    return null;
  }

  const record = requireBundleRefRecord(value, label);

  return {
    hash: requireBundleRefString(record.hash, `${label}.hash`),
    key: requireBundleRefString(record.key, `${label}.key`),
    size: requireBundleRefNumber(record.size, `${label}.size`),
    updatedAt: requireBundleRefString(record.updatedAt, `${label}.updatedAt`),
  };
}

export function serializeHostedExecutionBundleRef(
  value: HostedExecutionBundleRef | null | undefined,
): string | null {
  return value ? JSON.stringify(value) : null;
}

function requireBundleRefRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireBundleRefString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireBundleRefNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a number.`);
  }

  return value;
}
