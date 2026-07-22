# PR 750 ReviewGPT Round 8 privacy fixes

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Keep scheduled consented private-answer continuations composable while closing
  every Round 8 authority and persistence gap through existing owners.

## Success criteria

- Existing outbox fallback atomically supersedes both text and media, and a
  malformed fallback carrying media cannot enter the provider.
- Existing completion authority is checked before the continuation model and
  immediately before each effect-capable tool call.
- Reviewed completions use one-shot, non-persistent turn semantics without
  losing normal group send/skip or independently authorized tools.
- No new table, queue, key namespace, coordinator, lifecycle, or durable result
  owner is introduced.
- Focused tests, required repo verification, coverage-write, exact-head
  ReviewGPT, and required CI all pass.

## Scope

- In scope: reviewed-completion fallback mutation/dispatch checks, scheduled
  continuation authority hooks, one-shot notification-turn persistence, focused
  tests, directly affected durable docs, current-main merge, PR review/CI.
- Out of scope: new disclosure primitives, generic tool authorization redesign,
  personal connected-app access, phone-call scheduling, new persisted state.

## Constraints

- Technical constraints: reuse the current completion ID/key, Web-owned live
  authority predicate, normal notification/outbox delivery, and existing
  isolated-session semantics; keep final payload ownership in the outbox.
- Product/process constraints: preserve normal scheduled group composition and
  live-grant behavior; fail closed before any private-data boundary after
  authority loss; preserve the immutable ReviewGPT lineage.

## Risks and mitigations

1. Risk: reintroducing the blanket no-person-facing policy while isolating the
   turn.
   Mitigation: separate persistence semantics from the existing normal output
   and tool profile; prove send, skip, and allowed tools still work.
2. Risk: checking authority only at one boundary leaves a later race.
   Mitigation: reuse the same predicate before provider start, before every
   effect-capable tool, and at final dispatch.
3. Risk: fallback text is safe while compound media is not.
   Mitigation: atomically replace the full user-visible payload and validate the
   fallback shape at provider admission.

## Tasks

1. Merge current main and resolve the docs index by preserving both branches'
   truthful entries.
2. Trace the outbox fallback, provider/tool authority, and notification-session
   persistence paths and add failing focused tests.
3. Implement the smallest owner-local corrections and update durable contracts.
4. Run focused verification, coverage-write, full required verification, and
   parent final review.
5. Commit/push, run ReviewGPT Round 9 concurrently with CI, and reach a clean
   exact-head result.

## Decisions

- Accepted all three Round 8 findings. Each is corrected at an existing owner;
  no new durable primitive is justified.
- Current main's release-harness fixture fix is inherited through the normal
  merge rather than duplicated in this PR.
- Kept the authority proof as optional data on the existing route resolver,
  reused the existing provider/tool hooks, and kept fallback replacement in the
  existing outbox. The final simplification pass found no smaller design that
  preserves all four effect-boundary checks.

## Verification

- Focused assistant-engine tests: 173 passed.
- Assistant-engine and assistant-runtime typechecks: passed.
- Focused assistant-runtime tests: 425 passed.
- `pnpm docs:drift`: passed.
- `git diff --check`: passed.
- Authoritative diff-aware verification with the repository's bounded worker
  settings: passed in 356 seconds, including all affected typechecks, package
  tests, and Cloudflare verification.
- Coverage-write added only test proof for provider/tool/delivery/skip authority
  loss and ephemeral model-skip behavior; it found no missing production owner.
- Remaining external gates after this scoped commit: exact-head ReviewGPT Round
  9 and GitHub PR checks.
Completed: 2026-07-20
