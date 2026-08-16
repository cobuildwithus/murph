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
  - The shared card-audience rule at outbox and hosted delivery boundaries.
  - Exercise catalog presentation guidance.
  - Focused tests and durable product, architecture, and reliability documentation.
  - A member-facing changelog entry.
- Out of scope:
  - Card schemas, renderers, Telegram transport, retry, or provider changes.
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
   Mitigation: Expose and admit the presentation cards only after the existing authenticated group-route check, then enforce the same narrow audience rule at every durable delivery boundary.
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
- The accepted review finding showed that group cards reached the tool layer but
  failed at the outbox. One shared pure predicate now keeps the outbox,
  persisted-intent parser, and hosted parser aligned without a new delivery path.

## Verification

- Focused assistant tests passed: 224 passed and 6 skipped across prompt,
  tool-catalog, execution, skill-asset, and route-planning coverage.
- Assistant Engine typecheck passed.
- Web typecheck passed after its normal Prisma and generated-content setup.
- Changelog generation passed. Changelog fragment and registry tests passed with
  45 tests.
- The pinned real Codex App Server provider-input capture passed for identical
  synthetic direct and group Telegram turns in production code mode. With
  `gpt-tokenizer` 3.4.0 `o200k_harmony`, the normalized complete request changed
  from 29,214 to 29,140 tokens for direct turns (-74, -0.2533%) and from 20,864
  to 22,252 tokens for group turns (+1,388, +6.6526%). The direct byte delta was
  -432; the group byte delta was +6,562. Volatile request item ids and temporary
  workspace paths were normalized identically.
- `TELEGRAM_PREVIEW_CHAT_ID` was absent, so the consent-bound live Telegram
  preview was not available.
- Current official OpenAI prompt guidance was checked before prompt review. The
  final guidance uses clear high-level rules and bounded examples while leaving
  layout choice to the model.
- Remaining gates: exact-head ReviewGPT, required GitHub Actions, merge-tree
  preflight, merge, and worktree retirement.
