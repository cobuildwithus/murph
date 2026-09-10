/** Private experiment selection; the member identifier never enters deploy config. */
export function readSmallRunnerEnabled(source: Readonly<Record<string, unknown>>): boolean {
  const value = source.HOSTED_EXECUTION_SMALL_RUNNER_ENABLED;
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new Error("HOSTED_EXECUTION_SMALL_RUNNER_ENABLED must be true or false.");
}

export function assertSmallRunnerSelection(source: Readonly<Record<string, unknown>>): void {
  if (readSmallRunnerEnabled(source)) readMemberDigest(source);
}

export async function isSmallRunnerMember(
  source: Readonly<Record<string, unknown>>,
  userId: string,
): Promise<boolean> {
  if (!readSmallRunnerEnabled(source)) return false;
  const expected = readMemberDigest(source);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  const actual = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
  return actual === expected;
}

function readMemberDigest(source: Readonly<Record<string, unknown>>): string {
  const digest = source.HOSTED_EXECUTION_SMALL_RUNNER_MEMBER_SHA256;
  if (typeof digest !== "string" || !/^[a-f0-9]{64}$/u.test(digest)) {
    throw new Error("The enabled small runner requires a valid private member SHA-256 selector.");
  }
  return digest;
}
