export type HostedExecutionBundleKind = "vault" | "agent-state";

export interface HostedExecutionBundleRef {
  hash: string;
  key: string;
  size: number;
  // updatedAt is write metadata. Payload identity is hash + key + size.
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

  return left.hash === right.hash && left.key === right.key && left.size === right.size;
}

export function sameHostedExecutionBundleRef(
  left: HostedExecutionBundleRef | null | undefined,
  right: HostedExecutionBundleRef | null | undefined,
): boolean {
  return sameHostedBundlePayloadRef(left, right);
}
