export const MURPH_CLUBS_EMAIL = "clubs@withmurph.ai";

const DEFAULT_CLUB_CHALLENGE_SUBJECT = "Start a Murph club challenge";
const DEFAULT_CLUB_CHALLENGE_BODY = [
  "Club or community:",
  "Approximate participants:",
  "Challenge idea:",
  "Ideal start date:",
].join("\n");

export function buildClubChallengeMailto({
  body = DEFAULT_CLUB_CHALLENGE_BODY,
  subject = DEFAULT_CLUB_CHALLENGE_SUBJECT,
}: {
  body?: string;
  subject?: string;
} = {}): string {
  return `mailto:${MURPH_CLUBS_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
