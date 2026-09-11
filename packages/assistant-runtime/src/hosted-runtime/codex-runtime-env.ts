import {
  HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID,
  HOSTED_LOCAL_TEST_VENICE_CODEX_MODEL_PROVIDER_ID,
  HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID,
} from "@murphai/operator-config/assistant/target-runtime";

// Set during Codex runtime preparation so hosted assistant context uses the
// same provider id as the generated Codex config.
export const HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV =
  "MURPH_HOSTED_CODEX_MODEL_PROVIDER_ID";

// Operator tasks keep OpenAI/Sol independently of the member's provider, but
// must use the authentication and transport registered in the hosted config.
export function resolveHostedOperatorModelProvider(
  memberModelProvider: string | null | undefined,
): string {
  if (memberModelProvider === HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID) {
    return memberModelProvider;
  }
  if (
    memberModelProvider === HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID
    || memberModelProvider === HOSTED_LOCAL_TEST_VENICE_CODEX_MODEL_PROVIDER_ID
  ) {
    return HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID;
  }
  return HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID;
}
