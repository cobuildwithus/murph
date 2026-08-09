export const HOSTED_GROUP_SPONSORSHIP_CREATIVE_FORMATS = [
  "message",
  "poem",
  "song",
] as const;

export type HostedGroupSponsorshipCreativeFormat =
  (typeof HOSTED_GROUP_SPONSORSHIP_CREATIVE_FORMATS)[number];

export interface HostedGroupSponsorshipCreativeRequest {
  format: HostedGroupSponsorshipCreativeFormat;
  prompt: string | null;
  styleRequest: string | null;
}

export interface HostedGroupSponsorshipDraft {
  creativeRequest?: HostedGroupSponsorshipCreativeRequest;
  publicAlias: string | null;
  runningBitRequest: string | null;
  sponsorMessage: string | null;
}

export interface HostedGroupSponsorshipDraftInput {
  creativeEnabled: boolean;
  creativeFormat: HostedGroupSponsorshipCreativeFormat;
  creativePrompt: string;
  creativeStyleRequest: string;
  publicAlias: string;
  runningBitAvailable: boolean;
  runningBitRequest: string;
}

export function buildHostedGroupSponsorshipDraftInput(
  input: HostedGroupSponsorshipDraftInput,
): HostedGroupSponsorshipDraft {
  const creativeRequest = input.creativeEnabled
    ? {
        format: input.creativeFormat,
        prompt: normalizeOptionalDraftText(input.creativePrompt),
        styleRequest:
          input.creativeFormat === "song"
            ? normalizeOptionalDraftText(input.creativeStyleRequest)
            : null,
      }
    : null;
  const runningBitRequest = input.runningBitAvailable
    ? normalizeOptionalDraftText(input.runningBitRequest)
    : null;

  return {
    ...(creativeRequest ? { creativeRequest } : {}),
    publicAlias:
      creativeRequest || runningBitRequest
        ? normalizeOptionalDraftText(input.publicAlias)
        : null,
    runningBitRequest,
    sponsorMessage: null,
  };
}

function normalizeOptionalDraftText(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export const HOSTED_GROUP_SPONSORSHIP_PUBLIC_ALIAS_MAX_CODE_POINTS = 80;
export const HOSTED_GROUP_SPONSORSHIP_MESSAGE_MAX_CODE_POINTS = 280;
export const HOSTED_GROUP_SPONSORSHIP_RUNNING_BIT_MAX_CODE_POINTS = 240;
export const HOSTED_GROUP_SPONSORSHIP_CREATIVE_PROMPT_MAX_CODE_POINTS = 280;
export const HOSTED_GROUP_SPONSORSHIP_CREATIVE_STYLE_MAX_CODE_POINTS = 160;
