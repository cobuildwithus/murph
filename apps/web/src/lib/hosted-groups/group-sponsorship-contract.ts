export const HOSTED_GROUP_SPONSORSHIP_MONTHLY_CAPS_MINOR = [
  500,
  1_000,
  2_000,
  5_000,
] as const;

export type HostedGroupSponsorshipMonthlyCapMinor =
  (typeof HOSTED_GROUP_SPONSORSHIP_MONTHLY_CAPS_MINOR)[number];

export function parseHostedGroupSponsorshipMonthlyCapMinor(
  value: unknown,
): HostedGroupSponsorshipMonthlyCapMinor | null {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null;
  }
  for (const monthlyCapMinor of HOSTED_GROUP_SPONSORSHIP_MONTHLY_CAPS_MINOR) {
    if (value === monthlyCapMinor) {
      return monthlyCapMinor;
    }
  }
  return null;
}
