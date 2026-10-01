# Count Telegram activity for automation engagement

Status: completed
Created: 2026-09-08
Updated: 2026-09-08

## Outcome and invariant

Active Telegram members with a dormant Linq route remain eligible for ordinary scheduled assistant work. Preserve the 28-day inactivity window, usage authorization, consent, route authority, fresh-conversation priority, and deterministic system processing.

## Cause and correction

Web reconciliation checks Linq inbound days and accepted meal captures but ignores accepted Telegram conversations. Extend its existing bounded mailbox lookup using the ingress-owned Telegram dedupe prefix. Structural retention is 30 days, longer than the 28-day window. Payload expiry does not erase engagement. No new state, queue, schema, or provider call is needed.

## Product UX

Effort: Patch.
Affected paths: recent Telegram activity with dormant Linq; existing meal capture and Linq activity; inactive and usage-denied members; fresh conversation and model-free work.
Proof: synthetic PostgreSQL predicate proof and reconciliation route regressions. Model instructions, tools, output selection, and delivery are unchanged; live-model proof would not exercise this deterministic admission fix.

## Tasks

1. Reproduce missing Telegram engagement with synthetic PostgreSQL rows.
2. Extend the existing lookup; update policy documentation and release note.
3. Run focused tests, Web typecheck, complexity check, and parent review.
4. Close the plan and make a scoped commit. Deployment remains separate.

## Verification

- Before the fix, the real PostgreSQL regression rejected recent Telegram activity as expected.
- Focused mailbox, reconciliation, PostgreSQL, and changelog tests: 145 passed across four files.
- Web typecheck passed. Focused ESLint passed with one pre-existing unused-helper warning in the reconciliation test.
- Complexity diff: passed; no added cyclomatic debt. Existing unrelated hotspots are unchanged.
- Parent review: existing lookup remains one member-bound LIMIT 1 query using the existing member/kind/creation index. No extra database call, concurrent transaction, payload decode, provider call, or foreground latency is introduced.
- Product UX: Ready for this admission patch. Recent and boundary Telegram messages qualify even after consumption/content retirement; old, unrelated-member, email, and system-only rows do not. Meal activity, inactivity pause, and usage denial retain their contracts.
- Deployment: Web-only forward release; no schema migration, runtime rollout, or Temporal mutation. Live scheduled completion remains unverified until deployment.
- No pull request or production change was requested; this handoff is a tested local commit. CI and PR ReviewGPT remain delivery gates when a PR is opened.
Completed: 2026-09-08
