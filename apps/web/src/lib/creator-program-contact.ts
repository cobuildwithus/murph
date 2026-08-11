export const MURPH_CREATOR_CONTACT_EMAIL = "support@withmurph.ai";

const DEFAULT_CREATOR_PROGRAM_SUBJECT = "Explore a Murph health partnership";
const DEFAULT_CREATOR_PROGRAM_BODY = [
  "Name, role, or health brand:",
  "Link to your work:",
  "What health topic or outcome does your audience trust you for?",
  "Which podcast, protocol, course, book, or coaching method should Murph bring to life?",
  "What should each participant be able to do or understand?",
  "What could the community work toward together?",
  "Approximate audience or member size:",
].join("\n");

export function buildCreatorProgramMailto({
  body = DEFAULT_CREATOR_PROGRAM_BODY,
  subject = DEFAULT_CREATOR_PROGRAM_SUBJECT,
}: {
  body?: string;
  subject?: string;
} = {}): string {
  const query = new URLSearchParams({ body, subject });

  return `mailto:${MURPH_CREATOR_CONTACT_EMAIL}?${query.toString()}`;
}
