import { createHash } from "node:crypto";

const LINK_DELAY_NOTICES = [
  "The link is taking longer to send. I'll keep trying.",
  "The link is slow to send. I'll give it another try.",
  "I'm having trouble sending the link. I'll keep trying.",
  "Sending the link hit a delay. I'll give it another try.",
  "The link is held up. I'll retry the send.",
  "This link send needs another attempt. I'll try again.",
  "I'm still trying to get the link through to you.",
  "The link send is delayed. I'll keep working on it.",
  "There's a delay getting the link to you. I'll try again.",
  "Getting the link to you is taking longer. I'll keep at it.",
  "The link is still waiting to go through. I'll retry it.",
  "I'm running into trouble sending the link. Another try is queued.",
  "The link needs another send attempt. I'll take care of that.",
  "There's a snag with the link send. I'll give it another go.",
  "Sending the link is taking longer than expected. I'll retry it.",
  "I'm retrying the link after a delay sending it.",
  "I'm waiting on the link send and will keep trying.",
  "The link got held up during sending. I'll try again.",
  "I'm still working on sending the link. It's queued for another try.",
  "There's a hold-up with the link send. I'll keep at it.",
  "The link is proving tricky to send. I'll give it another try.",
  "I hit a snag sending the link. I'll retry it.",
  "The link is delayed. I'll keep trying to send it.",
  "A delay is holding up the link. I've queued another send attempt.",
  "I'm having to retry the link send after a hold-up.",
  "The link is taking a while to get through. I'll try again.",
  "The link send ran into trouble. I'll keep trying to get it through.",
  "I'm giving the link another try after a send delay.",
  "I'm having trouble getting the link through. I'll retry it.",
  "I'm still on the link send. It's delayed, so I'll try again.",
] as const;

export function buildHostedLinqLinkDelayNotice(intentId: string): string {
  // Derive variation from the existing identity so same-key attempts keep
  // the same body without another persisted field or random draw.
  const index = createHash("sha256").update(intentId).digest().readUInt32BE(0)
    % LINK_DELAY_NOTICES.length;
  return LINK_DELAY_NOTICES[index]!;
}
