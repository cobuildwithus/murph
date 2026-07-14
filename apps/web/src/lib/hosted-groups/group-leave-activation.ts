import "server-only";

export const HOSTED_GROUP_LEAVE_ENABLED_ENV = "HOSTED_GROUP_LEAVE_ENABLED";

export function isHostedGroupLeaveEnabled(
  source: Record<string, string | undefined> = process.env,
): boolean {
  return source[HOSTED_GROUP_LEAVE_ENABLED_ENV] === "1";
}
