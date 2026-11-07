# Fewer model rounds on the goal proposal turn

Status: completed
Created: 2026-11-05
Updated: 2026-11-05

## Goal

The production canary's goal proposal took 51 s to reply, across eight model
rounds. Cut model rounds with prompt and skill changes only, and keep the same
outcome: a grounded proposal, nothing saved until the member accepts.

## Success criteria

- At most four root rounds on the real-Codex goal proposal journey, down from
  six or seven.
- A goal on a large domain owner stays level with the base on rounds and still
  receives that skill's full text.
- No `murph-onboarding` read on that turn; an onboarding decision still reads it.
- Name and age saved exactly once; one Goal and one linked habit regimen only on
  acceptance.
- No change to hosted runtime configuration or the tool output budget.

## Scope

- In scope: the skill router, the imported-opening identity rule, goal-setup,
  behavior-followthrough and journal skill text, the onboarding spec.
- Out of scope: new CLI commands, the output budget, delegation configuration.

## Constraints

- Technical constraints: each tool cell keeps the default 10,000-token output
  budget, so a turn's reads must be split rather than batched.
- Product/process constraints: never delay an immediate health need for identity
  collection. Source words are untrusted data.

## Risks and mitigations

1. Risk: an immediate request hides an onboarding decision.
   Mitigation: the sentence applies only with no onboarding decision, and the
   deferral journey asserts that the onboarding skill is read.
2. Risk: the root saves identity twice or over a later correction.
   Mitigation: the root reads memory first and skips saved facts. Live journeys
   assert one canonical record of each.

## Tasks

1. Split first-turn reads across existing rounds and remove `--help` preflight.
2. Move the imported-opening identity save from a child to the root.
3. Prove the journeys and measure rounds, tokens and provider input.

## Decisions

- Rejected a 3-round design that raised `tool_output_token_limit` to 20,000 for
  every hosted turn and enabled collaboration inside code mode. It was not
  clearly faster locally and adds resident context cost to all turns.
- One `functions.exec` cell's output truncates at 10,000 tokens, and the model
  issues one cell per round, so a "separate cell in the same round" rule only
  adds a round. No single skill exceeds the limit on its own.
- Web search results stay out of a cell that reads a skill. They add about 4,800
  tokens, which truncated `behavior-followthrough` and cost a recovery round.
- After truncation the next cell re-reads only that skill. "Read the missing
  lines" produced partial reads (245 of 275 lines); a whole re-read is complete.
- Round 1 stays read-only so identity saves follow `memory show`.
- The one-shot identity child stays for the reply-only opening, where it keeps
  the reply unblocked.
- A large domain owner overflows the combined first read and pays a recovery
  round. Measured at parity with the base on rounds, so it is accepted here.

## Verification

- Commands to run: `pnpm test:assistant:live` for the goal proposal, five-stage
  acceptance and wearable deferral journeys; focused prompt tests; `pnpm typecheck`;
  `pnpm --silent complexity:diff`.
- Expected outcomes: all pass. The production canary after the runner deploy
  gives the real latency.
Completed: 2026-11-05
