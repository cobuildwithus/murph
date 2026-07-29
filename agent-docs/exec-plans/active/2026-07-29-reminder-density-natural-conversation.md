# Natural reminder density conversations

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Make dense private reminder support feel like one bounded, reciprocal conversation instead of an open-ended series of one-way notifications.

## Success criteria

- Same-purpose reminders in one practical action window are offered as one useful interruption without silently changing requested timing.
- Dense personal action cadences use a finite conversational check-in with natural replies, one-occurrence carry-forward, and a quiet stop after an unanswered combined grace message.
- Group, one-time, low-frequency informational, passive-monitoring, and safety-critical reminder behavior is not broadened into this private dense-loop policy.
- The Assistant Engine prompt and skill regressions, canonical diff verification, product-experience review, preliminary ReviewGPT prompt/coverage review, CI, and mergeability proof pass.

## Scope

- In scope: the Assistant Engine automation preference prompt, the behavior-followthrough skill, focused reminder-density prompt/skill regressions, and the matching iMessage deliverability rule.
- Out of scope: new automation schemas, scheduler/runtime state, delivery transports, message-count changes outside dense private support, or a second reminder lifecycle owner.

## Constraints

- Preserve canonical automation ownership and ordinary scheduled-turn execution.
- Keep user-facing copy conversational: no prescribed keywords, status syntax, internal lifecycle terms, or accumulated reminder debt.
- Keep the behavior finite, consented, and easy to pause or end.
- Treat the supplied patch as intent and retain only changes that fit current `origin/main`.

## Risks and mitigations

1. Risk: dense-cadence guidance could leak into group or low-frequency reminders.
   Mitigation: scope the system prompt to direct conversations and state explicit exclusions in the skill.
2. Risk: the carry-forward rule could create duplicate follow-ups or reminder debt.
   Mitigation: carry only the immediately preceding occurrence and require `skip` after one unanswered combined grace message.
3. Risk: prompt-only policy could drift from executable runtime constraints.
   Mitigation: reuse existing finite `check_in`, `activeUntil`, `continuityPolicy`, and `skip` primitives; add exact prompt and skill regressions without new state.

## Tasks

1. Apply and inspect the supplied four-file patch against current `origin/main`.
2. Run focused Assistant Engine tests and canonical `pnpm test:diff` verification.
3. Complete the required product-experience review and preliminary ReviewGPT prompt/coverage pass.
4. Resolve accepted findings, run the parent final review, and close the plan with a scoped commit.
5. Push the exact head, open the PR, run CI and mergeability proof, merge to `main`, and retire the worktree.

## Decisions

- Use the existing private-direct prompt assembly and behavior-followthrough skill as the sole policy owners.
- Do not add runtime state or delivery mechanics; the existing canonical automation and `skip` behavior already provide the required execution primitives.
- Skip the separate final ReviewGPT gate unless integration broadens beyond prompt-primary behavior.
- Accept the product-experience delivery finding: provider acceptance, `sent`, and ambiguous post-dispatch outcomes consume the one grace occurrence because SMS/MMS normally has no handset receipt; only confirmed non-delivery preserves it.
- Accept all preliminary specialist findings: make exhausted dense grace override generic repair, delete the stale keyword-confirmation example, and add a gated real-Codex setup/save/quiet-stop scenario at the existing model boundary.
- Keep the independently authorized bounded `review` automation as the only post-grace question; the dense `check_in` cannot turn its own silence into repair.

## Verification

- Passed: focused Assistant Engine policy/behavior/skill suite (3 files, 99 tests).
- Passed: Assistant Engine package typecheck.
- Passed: real-Codex E2E file compiles and its ordinary non-live cases run (4 passed, 8 skipped).
- Blocked before model invocation: the focused real-Codex dense-reminder scenario requires the harness's external API credential, which is not present in this checkout.
- Completed: product-experience review; one material delivery-semantics finding accepted and corrected.
- Completed: preliminary ReviewGPT prompt/coverage review of pushed head `81d9225`; all three findings accepted and corrected without rerunning the one substantive pass.
- Superseded diagnostic: the first canonical diff run passed the touched Assistant Engine, assistant-runtime, and assistantd owners, then existing CLI tests hit repeated 60-second timeouts and the exact owned session was stopped after producing no new output; rerun on the corrected head remains pending.
