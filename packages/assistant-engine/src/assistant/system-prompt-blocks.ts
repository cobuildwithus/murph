/**
 * Identifiers for the blocks that make up Murph's developer instructions.
 *
 * A block is one independently admitted section of the prompt. Its id, layer,
 * audience and boundary flag travel beside the text and are never rendered, so
 * tests can assert which blocks reach which route without quoting a sentence.
 *
 * Audience is declared here, apart from the conditionals that admit a block,
 * so a test can catch a private block admitted to a group or unverified route.
 */
export type AssistantPromptBlockLayer = "core" | "route" | "thread" | "turn";

export type AssistantPromptBlockAudience =
  /** Any route, including an unverified external audience. */
  | "any"
  /** Private direct conversations only. */
  | "private"
  /** Hosted group rooms only. */
  | "group"
  /** A verified audience: private conversations and group rooms. */
  | "private-or-group"
  /** An audience that was not classified as private or group. */
  | "unverified";

interface AssistantPromptBlockDefinition {
  audience: AssistantPromptBlockAudience;
  /** The block states a privacy, safety or authority rule its routes must carry. */
  boundary?: true;
  layer: AssistantPromptBlockLayer;
}

export const ASSISTANT_PROMPT_BLOCK_DEFINITIONS = {
  // Static cacheable core.
  "core.unverified-external": { layer: "core", audience: "unverified", boundary: true },
  "core.identity.direct": { layer: "core", audience: "private", boundary: true },
  "core.identity.group": { layer: "core", audience: "group", boundary: true },
  "core.social-role.group": { layer: "core", audience: "group", boundary: true },
  "core.humor.group": { layer: "core", audience: "group", boundary: true },
  // Reserved for the resident sentences about games; admits nothing until they exist.
  "core.games.group": { layer: "core", audience: "group" },
  "core.private-data.group": { layer: "core", audience: "group", boundary: true },
  "core.product-principles": { layer: "core", audience: "group" },
  "core.how-you-help.direct": { layer: "core", audience: "private" },
  "core.understand-before-recommending.direct": { layer: "core", audience: "private" },
  "core.understand-before-recommending.group": { layer: "core", audience: "group" },
  "core.follow-through-authorization": { layer: "core", audience: "group", boundary: true },
  "core.health-evidence-safety.direct": { layer: "core", audience: "private", boundary: true },
  "core.health-evidence-safety.group": { layer: "core", audience: "group", boundary: true },
  "core.chronic-support": { layer: "core", audience: "private-or-group" },
  "core.health-commons": { layer: "core", audience: "private-or-group" },
  "core.tool-truthfulness.direct": { layer: "core", audience: "private", boundary: true },
  "core.tool-truthfulness.group": { layer: "core", audience: "group", boundary: true },

  // Stable route capabilities.
  "route.turn-priority.direct": { layer: "route", audience: "private" },
  "route.turn-priority.group": { layer: "route", audience: "group" },
  "route.current-state": { layer: "route", audience: "private" },
  "route.tool-discovery": { layer: "route", audience: "private-or-group" },
  "route.delegated-initiative": { layer: "route", audience: "group" },
  "route.acting-permission.direct": { layer: "route", audience: "private", boundary: true },
  "route.native-polls": { layer: "route", audience: "private-or-group" },
  "route.private-delivery-context": { layer: "route", audience: "private-or-group", boundary: true },
  "route.low-usage": { layer: "route", audience: "private-or-group" },
  "route.low-usage.group-email": { layer: "route", audience: "group" },
  "route.non-blocking-delegation": { layer: "route", audience: "private" },
  "route.capability-offers": { layer: "route", audience: "private-or-group" },
  "route.message-reactions": { layer: "route", audience: "private-or-group" },
  "route.labs": { layer: "route", audience: "private" },
  "route.ios-app": { layer: "route", audience: "private-or-group" },
  "route.apple-health-relay": { layer: "route", audience: "private" },
  "route.android-health-connect-relay": { layer: "route", audience: "private" },
  "route.vault-navigation": { layer: "route", audience: "private" },
  "route.member-content-saving": { layer: "route", audience: "private" },
  "route.vault-file-sends": { layer: "route", audience: "private" },
  "route.health-commons-tools": { layer: "route", audience: "private-or-group" },
  "route.late-child-results": { layer: "route", audience: "group" },
  "route.group-email-health": { layer: "route", audience: "group" },
  "route.skill-router": { layer: "route", audience: "private-or-group" },
  "route.execution-behavior": { layer: "route", audience: "private-or-group" },
  "route.cli-guidance": { layer: "route", audience: "private-or-group" },
  "route.computer-use": { layer: "route", audience: "private", boundary: true },
  "route.phone-calls": { layer: "route", audience: "private" },
  "route.connected-apps.direct": { layer: "route", audience: "private" },
  "route.connected-apps.group": { layer: "route", audience: "group", boundary: true },
  "route.product-updates": { layer: "route", audience: "private-or-group" },
  "route.product-feedback.direct": { layer: "route", audience: "private" },
  "route.product-feedback.group": { layer: "route", audience: "group" },
  "route.style-settings.direct": { layer: "route", audience: "private" },
  "route.style-settings.group": { layer: "route", audience: "group" },
  "route.family-plan.direct": { layer: "route", audience: "private" },
  "route.family-plan.group": { layer: "route", audience: "group", boundary: true },
  "route.habitat": { layer: "route", audience: "private" },
  "route.hosted-groups.private-consult": { layer: "route", audience: "private", boundary: true },
  "route.hosted-groups": { layer: "route", audience: "private-or-group", boundary: true },
  "route.hosted-groups.shared-data-detail": { layer: "route", audience: "group", boundary: true },
  "route.knowledge": { layer: "route", audience: "private" },
  "route.automation": { layer: "route", audience: "private-or-group" },
  "route.automation.unavailable": { layer: "route", audience: "private-or-group" },
  "route.automation.group-email": { layer: "route", audience: "group" },
  "route.private-reminder-location": { layer: "route", audience: "private" },
  "route.group-cli-boundary": { layer: "route", audience: "group", boundary: true },
  "route.group-email-no-cli": { layer: "route", audience: "group", boundary: true },
  "route.cli-contract": { layer: "route", audience: "private" },

  // Thread-birth-stable context.
  "thread.conversation-scope.direct": { layer: "thread", audience: "private", boundary: true },
  "thread.conversation-scope.group": { layer: "thread", audience: "group", boundary: true },
  "thread.conversation-scope.unverified": { layer: "thread", audience: "unverified", boundary: true },
  "thread.time-style": { layer: "thread", audience: "private-or-group" },
  "thread.date-style.unverified": { layer: "thread", audience: "unverified" },
  "thread.product-base-url": { layer: "thread", audience: "private-or-group" },
  "thread.workout-access": { layer: "thread", audience: "any" },
  "thread.strength-training": { layer: "thread", audience: "private" },
  "thread.persona": { layer: "thread", audience: "private-or-group" },
  "thread.tone": { layer: "thread", audience: "private-or-group" },
  "thread.personality-dials": { layer: "thread", audience: "private-or-group" },
  "thread.reply-style": { layer: "thread", audience: "any" },
  "thread.message-shape.group": { layer: "thread", audience: "group" },
  "thread.onboarding": { layer: "thread", audience: "private" },
  "thread.link-self-check": { layer: "thread", audience: "any" },

  // Per-turn context.
  "turn.current-time": { layer: "turn", audience: "private" },
  "turn.current-date": { layer: "turn", audience: "any" },
  "turn.ordinary-inbound": { layer: "turn", audience: "private-or-group" },
  "turn.injected-context": { layer: "turn", audience: "private-or-group" },
  "turn.execution-context": { layer: "turn", audience: "any" },
  "turn.scheduled-occurrence": { layer: "turn", audience: "any" },
  "turn.delivery-decision-contract": { layer: "turn", audience: "any" },

  // Whole-prompt blocks for turns that do not use the route prompt.
  "maintenance.execution": { layer: "core", audience: "private-or-group" },
  "maintenance.date-context": { layer: "turn", audience: "private-or-group" },
  "output-only.ask-continuation": { layer: "core", audience: "private-or-group", boundary: true },
  "output-only.system-notification": { layer: "core", audience: "private-or-group", boundary: true },
  "output-only.operator-message": { layer: "core", audience: "private", boundary: true },
} as const satisfies Record<string, AssistantPromptBlockDefinition>;

export type AssistantPromptBlockId = keyof typeof ASSISTANT_PROMPT_BLOCK_DEFINITIONS;

export interface AssistantPromptBlock {
  audience: AssistantPromptBlockAudience;
  boundary: boolean;
  id: AssistantPromptBlockId;
  layer: AssistantPromptBlockLayer;
  text: string;
}

export type AssistantPromptBlockEntry =
  | AssistantPromptBlock
  | null
  | readonly (AssistantPromptBlock | null)[];

/** Tags text with its block id. Empty text admits no block, as before. */
export function promptBlock(
  id: AssistantPromptBlockId,
  text: string | null | undefined | false,
): AssistantPromptBlock | null {
  if (!text) {
    return null;
  }
  const definition: AssistantPromptBlockDefinition =
    ASSISTANT_PROMPT_BLOCK_DEFINITIONS[id];
  return {
    audience: definition.audience,
    boundary: definition.boundary === true,
    id,
    layer: definition.layer,
    text,
  };
}

export function collectPromptBlocks(
  ...entries: AssistantPromptBlockEntry[]
): AssistantPromptBlock[] {
  return entries
    .flat()
    .filter((block): block is AssistantPromptBlock => block !== null);
}

/** Blocks render as their text joined by a blank line. Ids are not rendered. */
export function renderPromptBlocks(
  blocks: readonly AssistantPromptBlock[],
): string {
  return blocks.map((block) => block.text).join("\n\n");
}
