export const MURPH_CLUBS_EMAIL = "clubs@withmurph.ai";

const DEFAULT_CLUB_PILOT_SUBJECT = "Club challenge pilot";
const DEFAULT_CLUB_PILOT_BODY = [
  "Club or community:",
  "Approximate participants:",
  "Challenge idea:",
  "Ideal start date:",
].join("\n");

export function buildClubPilotMailto({
  body = DEFAULT_CLUB_PILOT_BODY,
  subject = DEFAULT_CLUB_PILOT_SUBJECT,
}: {
  body?: string;
  subject?: string;
} = {}): string {
  const query = new URLSearchParams({ body, subject });
  return `mailto:${MURPH_CLUBS_EMAIL}?${query.toString()}`;
}
