import { sha256Hex } from "../primitives";
import { normalizePhoneNumber } from "./phone";

export const HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE =
  "group_line_recovery";

const BACKUP_NUMBER_PLACEHOLDER = "{backupNumber}";

const HOSTED_LINQ_GROUP_LINE_RECOVERY_VARIANTS = [
  `Murph is having trouble replying from the number in that group. Add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat, then send the intro again.`,
  `The Murph number in that group is not able to answer right now. Add ${BACKUP_NUMBER_PLACEHOLDER} to the same group chat, then retry the intro.`,
  `I need to move that group onto another Murph number. Add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat, then send the intro again.`,
  `That group reached a Murph number that cannot reply right now. Add ${BACKUP_NUMBER_PLACEHOLDER} to the existing group chat, then retry the introduction.`,
  `Murph cannot safely answer from the number currently in that group. Add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat, then send the intro again.`,
  `Please add ${BACKUP_NUMBER_PLACEHOLDER} inside that existing group chat, then send the intro again. Murph will pick it up from this number.`,
  `The group needs this Murph number instead: ${BACKUP_NUMBER_PLACEHOLDER}. Add it inside the existing group chat, then retry the intro.`,
  `I cannot use the Murph number that is in that group right now. Add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat, then send the intro again.`,
  `To keep that group working, add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat, then send the introduction again.`,
  `Murph needs a fresh number in that same group. Add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat, then retry the intro.`,
  `The current Murph group number is not available for replies. Add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat, then send the intro again.`,
  `Use this Murph number for that group: ${BACKUP_NUMBER_PLACEHOLDER}. Add it inside the existing group chat, then retry the introduction.`,
  `I can help once the group includes ${BACKUP_NUMBER_PLACEHOLDER}. Add it inside the existing group chat, then send the intro again.`,
  `That group needs to include ${BACKUP_NUMBER_PLACEHOLDER} before Murph can answer. Add it inside the existing group chat, then retry the intro.`,
  `Please bring ${BACKUP_NUMBER_PLACEHOLDER} into the existing group chat, then send the intro again so Murph can respond there.`,
  `Murph cannot respond from the number currently present. Add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat, then retry the intro.`,
  `Add ${BACKUP_NUMBER_PLACEHOLDER} inside that existing group chat, then resend the introduction. Murph will answer from this number.`,
  `The group is pointed at a Murph number that cannot reply now. Add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat, then retry the intro.`,
  `To restart that group with Murph, add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat, then send the intro again.`,
  `Murph needs ${BACKUP_NUMBER_PLACEHOLDER} added to the existing group chat. After that, send the intro again.`,
  `The number in that group cannot carry Murph's reply. Add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat, then retry the intro.`,
  `Please add this Murph number inside the existing group chat: ${BACKUP_NUMBER_PLACEHOLDER}. Then send the intro again.`,
  `That group is not reachable from the current Murph number. Add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat, then retry the introduction.`,
  `I can answer that group from ${BACKUP_NUMBER_PLACEHOLDER}. Add it inside the existing group chat, then send the intro again.`,
  `Move that group to this Murph number: ${BACKUP_NUMBER_PLACEHOLDER}. Add it inside the existing group chat, then retry the intro.`,
  `The group needs a working Murph sender. Add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat, then send the introduction again.`,
  `Please update the existing group chat by adding ${BACKUP_NUMBER_PLACEHOLDER}, then retry the intro there.`,
  `Murph will use ${BACKUP_NUMBER_PLACEHOLDER} for that group. Add it inside the existing group chat, then send the intro again.`,
  `That group cannot be handled from the current Murph number. Add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat, then retry the intro.`,
  `Add ${BACKUP_NUMBER_PLACEHOLDER} to the existing group chat and send the intro again. That lets Murph answer from this working number.`,
  `The Murph number in that group needs to be replaced. Add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat, then retry the introduction.`,
  `Please add ${BACKUP_NUMBER_PLACEHOLDER} to that same group chat, then resend the intro so Murph can join from this number.`,
  `Murph cannot continue from the number already in the group. Add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat, then send the intro again.`,
  `The working Murph number for that group is ${BACKUP_NUMBER_PLACEHOLDER}. Add it inside the existing group chat, then retry the intro.`,
  `Add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat, then send the introduction again. Murph will respond from this number.`,
  `The group needs ${BACKUP_NUMBER_PLACEHOLDER} as the Murph contact. Add it inside the existing group chat, then retry the intro.`,
  `I need that group to include ${BACKUP_NUMBER_PLACEHOLDER}. Add it inside the existing group chat, then send the intro again.`,
  `Please add the working Murph number, ${BACKUP_NUMBER_PLACEHOLDER}, inside the existing group chat, then retry the introduction.`,
  `That group cannot receive a Murph reply from its current number. Add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat, then send the intro again.`,
  `Use ${BACKUP_NUMBER_PLACEHOLDER} for Murph in that group. Add it inside the existing group chat, then retry the intro.`,
  `Murph needs to answer from ${BACKUP_NUMBER_PLACEHOLDER}. Add it inside the existing group chat, then send the intro again.`,
  `Please add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat before retrying the intro with Murph.`,
  `That existing group chat needs this Murph number: ${BACKUP_NUMBER_PLACEHOLDER}. Add it, then send the intro again.`,
  `I cannot reply in that group until ${BACKUP_NUMBER_PLACEHOLDER} is added inside the existing group chat. Then retry the intro.`,
  `Add ${BACKUP_NUMBER_PLACEHOLDER} to the existing group chat, then send the intro again so Murph can answer from the healthy number.`,
  `The current Murph sender for that group is unavailable. Add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat, then retry the intro.`,
  `Please invite ${BACKUP_NUMBER_PLACEHOLDER} into the existing group chat, then send the intro again for Murph.`,
  `Murph can continue in that group through ${BACKUP_NUMBER_PLACEHOLDER}. Add it inside the existing group chat, then retry the intro.`,
  `That group needs a different Murph line. Add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat, then send the introduction again.`,
  `Add ${BACKUP_NUMBER_PLACEHOLDER} inside the existing group chat and retry the intro. Murph will use this number there.`,
] as const;

export const HOSTED_LINQ_GROUP_LINE_RECOVERY_VARIANT_COUNT =
  HOSTED_LINQ_GROUP_LINE_RECOVERY_VARIANTS.length;

export type HostedLinqGroupLineRecoveryParticipantContact = {
  kind: "email" | "phone";
  value: string;
};

export function buildHostedLinqGroupLineRecoveryEffectId(input: {
  incomingRecipientPhone: string;
  memberId: string;
  threadId: string;
}): string {
  const incomingRecipientPhone = normalizePhoneNumber(input.incomingRecipientPhone);
  const memberId = input.memberId.trim();
  const threadId = input.threadId.trim();
  if (!incomingRecipientPhone || !memberId || !threadId) {
    throw new TypeError(
      "Hosted Linq group-line recovery requires a valid member, thread, and incoming line.",
    );
  }

  return `linq-group-line-recovery:${
    sha256Hex(JSON.stringify({
      incomingRecipientPhone,
      memberId,
      threadId,
    })).slice(0, 32)
  }`;
}

export function buildHostedLinqGroupLineRecoveryRecipientSourceRef(
  contact: HostedLinqGroupLineRecoveryParticipantContact,
): string {
  const value = contact.kind === "phone"
    ? normalizePhoneNumber(contact.value)
    : contact.value.trim().toLowerCase();
  if (!value) {
    throw new TypeError(
      "Hosted Linq group-line recovery requires a valid recipient contact.",
    );
  }

  return `linq-group-line-recovery-recipient:${
    sha256Hex(JSON.stringify({
      kind: contact.kind,
      value,
    })).slice(0, 32)
  }`;
}

export function readHostedLinqGroupLineRecoveryVariantIndex(
  seed: string,
): number {
  const digest = sha256Hex(`group-line-recovery-message:${seed}`);

  return Number.parseInt(digest.slice(0, 8), 16)
    % HOSTED_LINQ_GROUP_LINE_RECOVERY_VARIANTS.length;
}

export function buildHostedLinqGroupLineRecoveryMessage(input: {
  backupPhoneNumber: string;
  seed: string;
}): string {
  const backupNumber = formatHostedLinqGroupLineRecoveryPhoneNumber(
    input.backupPhoneNumber,
  );
  const variant =
    HOSTED_LINQ_GROUP_LINE_RECOVERY_VARIANTS[
      readHostedLinqGroupLineRecoveryVariantIndex(input.seed)
    ]!;

  return variant.replace(BACKUP_NUMBER_PLACEHOLDER, backupNumber);
}

export function readHostedLinqGroupLineRecoveryVariantTemplates():
  readonly string[] {
  return HOSTED_LINQ_GROUP_LINE_RECOVERY_VARIANTS;
}

function formatHostedLinqGroupLineRecoveryPhoneNumber(value: string): string {
  const normalized = normalizePhoneNumber(value);
  if (!normalized) {
    throw new TypeError(
      "Hosted Linq group line recovery requires a valid backup phone number.",
    );
  }

  return normalized;
}
