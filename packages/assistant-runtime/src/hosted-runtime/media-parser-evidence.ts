import type {
  AssistantInputAttachmentDescriptor,
  AssistantInputEventRecord,
} from "@murphai/assistant-engine";

export type HostedAssistantInputMediaSemanticState =
  | "failed"
  | "not_required"
  | "pending"
  | "ready";

const HOSTED_INTERNAL_STAGING_NOTE_PREFIX = "Internal staging note:";
const HOSTED_LEGACY_GENERATED_MEDIA_TEXT_PATTERN =
  /^Received a (?:Linq|Telegram) message with [1-9][0-9]* attachments?\.$/u;

export function classifyHostedAssistantInputMediaSemanticState(
  event: Pick<AssistantInputEventRecord, "attachmentEvidence" | "content">,
): HostedAssistantInputMediaSemanticState {
  if (hasUserAuthoredAssistantInputText(event.content.userMessageContent)) {
    return "not_required";
  }

  const mediaDescriptors = event.content.attachmentDescriptors
    .filter(isAudioVideoAssistantInputDescriptor);
  const mediaEvidence = event.attachmentEvidence.attachments
    .filter((attachment) => attachment.kind === "audio" || attachment.kind === "video");
  if (mediaDescriptors.length === 0 && mediaEvidence.length === 0) {
    return "not_required";
  }
  if (event.attachmentEvidence.status === "failed") {
    return "failed";
  }

  if (mediaEvidence.length === 0) {
    return "pending";
  }
  if (
    mediaEvidence.length < mediaDescriptors.length
    || mediaEvidence.some((attachment) =>
      attachment.parseState === null
      || attachment.parseState === "pending"
      || attachment.parseState === "running"
    )
  ) {
    return "pending";
  }
  if (
    mediaEvidence.some((attachment) =>
      attachment.parseState !== "succeeded"
      || !attachment.inlineFragments.some((fragment) =>
        (fragment.kind === "attachment_transcript"
          || fragment.kind === "attachment_extracted_text")
        && fragment.text.trim().length > 0
      )
    )
  ) {
    return "failed";
  }
  return "ready";
}

function hasUserAuthoredAssistantInputText(
  content: AssistantInputEventRecord["content"]["userMessageContent"],
): boolean {
  return (content ?? []).some((part) =>
    part.type === "text"
    && part.text.trim().length > 0
    && !part.text.trimStart().startsWith(HOSTED_INTERNAL_STAGING_NOTE_PREFIX)
    && !HOSTED_LEGACY_GENERATED_MEDIA_TEXT_PATTERN.test(part.text.trim())
  );
}

function isAudioVideoAssistantInputDescriptor(
  descriptor: AssistantInputAttachmentDescriptor,
): boolean {
  const kind = descriptor.kind?.trim().toLowerCase() ?? "";
  if (
    kind === "audio"
    || kind === "voice"
    || kind === "voice_memo"
    || kind === "video"
    || kind === "video_note"
    || kind === "animation"
  ) {
    return true;
  }
  const contentType = descriptor.contentType?.trim().toLowerCase() ?? "";
  if (contentType.startsWith("audio/") || contentType.startsWith("video/")) {
    return true;
  }
  const fileName = descriptor.fileName?.trim().toLowerCase() ?? "";
  return /\.(?:aac|aiff?|amr|avi|flac|m4a|m4v|mkv|mov|mp3|mp4|mpeg|mpg|oga|ogg|opus|wav|webm|wma|wmv)$/u
    .test(fileName);
}
