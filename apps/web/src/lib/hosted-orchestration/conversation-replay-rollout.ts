export const HOSTED_CONVERSATION_REPLAY_V2_ENABLED_ENV =
  "HOSTED_CONVERSATION_REPLAY_V2_ENABLED";

export function isHostedConversationReplayV2Enabled(
  source: NodeJS.ProcessEnv = process.env,
): boolean {
  return source[HOSTED_CONVERSATION_REPLAY_V2_ENABLED_ENV] === "1";
}
