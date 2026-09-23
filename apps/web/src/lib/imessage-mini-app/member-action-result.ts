import {
  IMESSAGE_APP_CARD_URL_MAX_LENGTH,
  IMESSAGE_APP_CARD_URL_PREFIX,
  buildWorkoutSessionAppCardEnvelopeV4,
  parseWorkoutSessionAppCardEnvelopeV4,
  type MemberActionStatusV1,
} from "@murphai/contracts";

/** Project a validated durable outcome for the requesting client's wire protocol. */
export function projectIMessageMemberActionStatus(
  status: MemberActionStatusV1,
  cardFormat: string | null,
): MemberActionStatusV1 {
  if (cardFormat === "envelope-v6" || status.status === "pending" || !status.result?.card) {
    return status;
  }
  const { result, ...outcome } = status;
  const presentation = parseWorkoutSessionAppCardEnvelopeV4(result.card);
  if (!presentation) throw new TypeError("Invalid stored workout card.");
  // Installed readers accept completed V4 summaries, but only active V6 editors.
  const envelope = presentation.workout.state === "completed"
    ? buildWorkoutSessionAppCardEnvelopeV4(presentation)
    : result.card;
  const cardUrl = IMESSAGE_APP_CARD_URL_PREFIX
    + Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
  if (cardUrl.length >= IMESSAGE_APP_CARD_URL_MAX_LENGTH) {
    // A presentation limit must not turn an already applied write into a failure.
    return result.kind === "workout.live.apply"
      ? outcome
      : { ...outcome, status: "rejected", reason: "workout_changed" };
  }
  return {
    ...outcome,
    result: { kind: result.kind, version: result.version, cardUrl },
  };
}
