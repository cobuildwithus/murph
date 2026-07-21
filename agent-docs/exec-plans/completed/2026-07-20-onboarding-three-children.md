# Onboarding three-child ingestion and lab voice closer

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Keep onboarding moving immediately after a dense voice memo by splitting its
  independent movement/protocol, supplement, and medical persistence work
  across three concurrent one-shot Codex children, then asking the final lab
  question as a generated voice memo.

## Success criteria

- Hosted Codex continues to admit root plus at least three concurrent children,
  and the workspace boundary waits for and scans every same-root child rather
  than retaining only the latest one.
- A dense onboarding memo starts exactly three bounded children when all three
  work families are present: movement/protocol context, supplement
  persistence/enrichment, and medical/safety persistence.
- The visible reply does not wait on those children and truthfully says Murph's
  people are sorting and saving what the member shared without promising
  completion.
- The final recent-labs question is attached as a short voice memo whenever the
  voice tool is available and voice has not been declined; text remains the
  honest fallback.
- Focused lifecycle, prompt, and skill tests; required completion audits; CI;
  and ReviewGPT all pass on the exact pushed head.

## Scope

- In scope: assistant-engine resident-child lifecycle tracking, focused
  lifecycle tests, global non-blocking delegation prompt text, Murph onboarding
  skill and product contract, matching architecture/runtime contracts, and
  focused prompt/skill tests.
- Out of scope: a new job queue or durable child registry, changes to canonical
  health-record owners, additional onboarding checkpoints, provider delivery
  transport changes, or deployment.

## Constraints

- Use Codex MultiAgent V2's existing configured root-plus-three capacity; do not
  add Murph-side orchestration or a second lifecycle owner.
- Treat the accepted current message as the durable source for delegated
  onboarding persistence. Each child gets one self-contained task and exact
  source words, remains a one-shot leaf, and performs only its named family.
- Keep user-facing messaging truthful: spawning proves the team was started,
  not that canonical writes or enrichment completed.
- Preserve unrelated work and reconcile the existing broad PR #221
  assistant-engine overlap only through ordinary Git conflict handling.

## Risks and mitigations

1. Risk: three children start but checkpoint publication observes only the last
   one and snapshots while earlier children still write.
   Mitigation: retain a set of every admitted child per root, wait for every
   terminal result, and scan every root and child for background terminals.
2. Risk: delegation moves required health facts off-path without a durable
   source.
   Mitigation: bind each child task to the already accepted message text and
   require idempotent canonical writes through existing owners.
3. Risk: visible copy overstates background completion.
   Mitigation: allow present-tense sorting/saving language only in the spawning
   reply and keep later completion claims behind canonical readback.
4. Risk: a voice-generation failure suppresses the onboarding closer.
   Mitigation: retain the same question as an immediate text fallback.

## Tasks

1. Replace singular same-root child tracking with exact bounded set tracking and
   add a three-concurrent-child checkpoint regression.
2. Align the global delegation prompt, onboarding skill, and durable contracts
   with the existing root-plus-three runtime capacity.
3. Split dense memo ingestion into three immediate child assignments and make
   the lab closer voice-first with a text fallback.
4. Run focused and diff-aware verification, required prompt/coverage and
   cross-cutting review gates, then parent final review.
5. Finish the plan through the scoped commit helper, open the PR, start
   ReviewGPT alongside CI, and resolve every accepted finding.

## Verification

- Focused assistant-engine lifecycle tests for three concurrent same-root
  children and background-terminal scans: passed.
- Focused assistant-engine skill/prompt regression tests: passed (95 tests).
- Full assistant-engine suite: passed (2,527 tests; five skipped).
- `pnpm docs:drift`: passed.
- `pnpm test:diff`: passed, including the assistant CLI, assistant runtime,
  setup CLI, and Cloudflare reverse-dependent app verification.
- Required `prompt-review` and `coverage-write` passes: passed with no remaining
  findings or coverage gaps. PR-lane ReviewGPT remains the post-commit
  cross-cutting gate.
Completed: 2026-07-20
