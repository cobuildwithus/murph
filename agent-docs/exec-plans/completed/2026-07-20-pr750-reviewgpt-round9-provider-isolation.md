# PR 750 ReviewGPT Round 9 provider isolation

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Close both Round 9 findings by making the existing scheduled reviewed turn
  truly ephemeral at the provider boundary and by applying the same
  non-persistence rule to its deterministic fallback.

## Success criteria

- The reviewed model turn uses the existing App Server `ephemeral` option, a
  read-only sandbox, and the existing native-tool disable overrides.
- Independently authorized Murph group tools remain available and continue to
  pass through the existing Web authority check.
- Scheduled reviewed fallback queues the existing fixed text and empty media
  without resolving or persisting a canonical session, receipt, transcript,
  finalizer state, or provider resume state.
- Interactive reviewed-exact delivery retains its existing explicit-session
  behavior.
- No new state owner, queue, scheduler, coordinator, key namespace, policy
  framework, or compatibility lifecycle is introduced.
- Focused tests, required repo verification, coverage-write, exact-head
  ReviewGPT, and required CI pass.

## Scope

- In scope: scheduled reviewed notification profile/provider options,
  scheduled reviewed exact fallback persistence, focused provider/notification
  tests, directly affected durable docs, PR review and CI.
- Out of scope: interactive reviewed-exact behavior, new tool authorization,
  phone scheduling, personal connected apps, new persisted state.

## Constraints

- Reuse the existing App Server ephemeral option, Assistant Ask native-disable
  configuration, notification/outbox path, Web authority predicate, and
  isolated transient session.
- Keep the response-policy distinction only for deciding whether a model runs;
  persistence isolation follows the scheduled reviewed-completion fact for both
  model and exact fallback.

## Risks and mitigations

1. Risk: disabling all tools would regress normal scheduled group composition.
   Mitigation: disable only native provider tools and retain existing Murph
   dynamic tools with the current pre-tool authority hook.
2. Risk: broad exact-text changes could regress interactive reviewed delivery.
   Mitigation: gate persistence suppression on scheduled invocation authority
   plus reviewed-completion expiry and add an explicit legacy regression.
3. Risk: provider isolation is asserted only through a mocked runner.
   Mitigation: add proof at the provider request/thread-start boundary for
   ephemeral, read-only, and native-disable options.

## Tasks

1. Trace existing provider ephemeral/sandbox/config plumbing and exact-text
   persistence ownership.
2. Add failing focused tests for real provider options and scheduled fallback
   non-persistence, including interactive preservation.
3. Implement the smallest owner-local corrections and update durable docs.
4. Run focused verification, coverage-write, full required verification, and a
   final simplification review.
5. Commit/push, run the next exact-head ReviewGPT round concurrently with CI,
   and reach a clean mergeable result.

## Decisions

- Accepted both Round 9 findings. Both are gaps in the Round 8 remediation and
  are fixed by existing controls rather than new architecture.
- Kept confinement in the reviewed-turn profile rather than duplicating it in
  the cron caller. The profile reuses the existing Assistant Ask native-disable
  list and passes the existing App Server ephemeral option through one optional
  per-turn field.
- Applied persistence isolation to the shared scheduled reviewed-completion
  predicate, while the response policy decides only whether a model runs. This
  preserves the existing interactive exact-text path without a second lifecycle.

## Verification

- Focused assistant-engine notification, provider, and cron tests: 229 passed.
- Final focused coverage-write tests: 89 passed.
- Assistant-engine typecheck: passed.
- `pnpm docs:drift`: passed.
- `git diff --check`: passed.
- Authoritative diff-aware verification with the repository's bounded worker
  settings: passed in 1,372 seconds, including all affected typechecks and
  package tests plus Cloudflare node verification (1,842 passed) and its workers
  suite.
- Coverage-write added only direct test proof that the authorized group tool
  survives isolation, scheduled fallback uses only the outbox state owner, and
  non-scheduled reviewed exact text retains canonical-session behavior.
- Remaining external gates after this scoped commit: exact-head ReviewGPT Round
  10 and GitHub PR checks.
Completed: 2026-07-20
