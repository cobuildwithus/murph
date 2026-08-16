# Prefer Telegram Rich Messages for structured replies

Status: active
Created: 2026-08-16
Updated: 2026-08-16

## Goal

- Make Telegram Rich Messages the preferred presentation for structured replies in direct and group conversations.
- Keep ordinary conversation as plain text when a card would not improve readability.
- Solve the behavior through concise model guidance and existing card tools, without new retry or enforcement systems.

## Success criteria

- Authenticated Telegram direct and group turns can use the generic Rich Message tool.
- Prompt guidance prefers Rich Messages for structured plans, instructions, schedules, lists, and exercise guidance.
- Existing specialized cards remain optional examples and useful building blocks, not exclusive presentation owners.
- Exercise images are recommended when useful and available, but are not required.
- Safety and data-authority rules for nutrition and tracked workouts remain unchanged.
- Focused prompt, tool-routing, and execution tests pass.
- Required PR review and CI checks pass on the exact candidate commit.

## Scope

- In scope:
  - Assistant system prompt and dynamic tool descriptions.
  - Generic Telegram Rich Message availability in authenticated group turns.
  - Exercise catalog presentation guidance.
  - Focused tests and durable product, architecture, and reliability documentation.
  - A member-facing changelog entry.
- Out of scope:
  - Card schemas, renderers, Telegram delivery, outbox, retry, or provider changes.
  - Image support inside generic Rich Message HTML.
  - Migration or rewriting of existing scheduled automation instructions.
  - Changes to nutrition or tracked-workout source-of-truth rules.

## Constraints

- Technical constraints:
  - Reuse the current Telegram Rich Message and exercise card paths.
  - Do not add state, retries, validators, or a second delivery path.
  - Keep group access behind the existing authenticated Telegram group route.
- Product/process constraints:
  - Prefer the smallest maintainable change.
  - Do not force cards for normal conversation.
  - Do not copy the private user screenshot or its distinctive wording into repository artifacts.

## Risks and mitigations

1. Risk: A group turn could attach a card outside an authorized Telegram room.
   Mitigation: Expose and admit the generic card only after the existing authenticated group-route check.
2. Risk: Generic cards could bypass nutrition or tracked-workout safety rules.
   Mitigation: Keep those domain rules explicit while removing presentation exclusivity.
3. Risk: The model could over-format casual conversation.
   Mitigation: Tie the preference to content structure and state that normal conversation can remain plain text.

## Tasks

1. Record the current prompt, tool-routing, execution, and documentation constraints.
2. Simplify Rich Message guidance and make the generic tool available in authenticated Telegram groups.
3. Update exercise presentation guidance so images are recommended and cards are optional patterns.
4. Add focused direct and group routing, prompt, and execution coverage.
5. Update durable documentation and the public changelog.
6. Run focused verification, preliminary specialist review, PR review, and CI.

## Decisions

- The user approved a prompt-primary solution instead of code enforcement.
- Rich Messages apply to direct and group Telegram conversations.
- Content structure decides whether to use a card. Message length alone does not decide it.
- Existing card tools are examples and reusable options. The model may compose a custom Rich Message.
- Images are optional but recommended when they make exercise instructions easier to understand.

## Verification

- Commands to run:
  - Focused Vitest files for assistant prompt, tool catalog, dynamic execution, and turn planning.
  - The narrow typecheck or package verification required by affected TypeScript packages.
  - `git diff --check` and the repository merge-tree preflight.
  - Required GitHub Actions and ReviewGPT gates on the exact PR head.
- Expected outcomes:
  - The generic Rich Message tool is present for authenticated Telegram group turns and rejected elsewhere.
  - Prompt and tool descriptions express the approved preference without rigid templates or voice-specific examples.
  - Direct Telegram behavior remains valid and no existing safety owner is weakened.
