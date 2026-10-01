import "server-only";

// This is a compatibility floor, not the newest available release. Raise it only
// after the replacement is publicly available for every supported storefront/OS.
export function readIOSMinimumBuild(): number | null {
  const value = process.env.HOSTED_IOS_MINIMUM_BUILD?.trim();
  if (!value) return null;
  if (!/^[1-9]\d{0,9}$/u.test(value) || Number(value) > 2147483647) {
    throw new Error("HOSTED_IOS_MINIMUM_BUILD must be a positive 32-bit integer.");
  }
  return Number(value);
}
