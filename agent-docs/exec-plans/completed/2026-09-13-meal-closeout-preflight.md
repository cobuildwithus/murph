# Skip empty automatic meal closeout before model entry

Status: completed
Created: 2026-09-13
Updated: 2026-09-13

## Outcome and ownership

Nightly automatic meal closeout must consume no model usage when its canonical
work queue is empty. Cron preconditions own admission; the existing
vault-usecases closeout query owns retained photos and same-occurrence removal
evidence. No new state, queue, dependency, or scheduler.

## Product UX

- Outcome: Empty scheduled closeout stays silent without consuming AI usage.
- Reaches: Managed scheduled occurrences, historical retained photos, retry
  recovery, local date boundaries, and later captures. Explicit manual runs and
  unrelated automations keep their existing behavior.
- Proof: Composed cron suppression and schedule advancement, canonical queue
  fixtures, and focused real-Codex historical cleanup. No member delivery.

## Implementation and failure behavior

Use the immutable managed ID and request one work item using the scheduled
occurrence instant and local date. Query failures remain retryable, never an
empty result. Preserve pending outbox recovery and foreground cancellation.
Existing checkpoints and next-day scheduling own convergence. No persisted
shape changes; older runtimes can still spend usage until the runner is updated.

## Tasks

1. Added canonical queue eligibility to scheduled cron preconditions.
2. Proved empty, retained, cleaned, retry, historical, future-date, manual,
   unrelated automation, cancellation, and read-failure behavior.
3. Extended live historical cleanup proof and corrected its existing fixture:
   help calls no longer fabricate enrichment or removal. Added deterministic
   state-transition proof and the matching public-safe Frog entry.
4. Updated the architecture owner, proof index and changelog; completed focused
   verification, privacy review, and complexity review.

## Verification

- Assistant cron and eligibility suites: 242 passed initially; the final added
  UTC/local-midnight case passed in the eight-case eligibility suite. The final
  inventory is 235 cron tests plus eight eligibility tests.
- Two deterministic live-fixture classification/help tests passed.
- Assistant-engine and Web typechecks passed.
- Changelog rendering: ten tests passed using the repository-root Vitest
  command. The documented app-directory invocation missed discovery; existing
  Frog entries already track this issue.
- Focused live command: `pnpm test:assistant:live -- --test 'keeps historical
  automatic meal closeout silent through empty-queue preflight'`, with
  `--codex-home <LOCAL_CODEX_PROFILE>`, Terra, local subscription.
  Initial profiles failed before provider action. The first usable profile
  exposed the fixture help bug; after its deterministic fix, the same profile
  passed. Canonical empty-queue suppression was true, retained-photo suppression
  was false, then one actual edit and one removal each had readback. Final decision
  was skip, with no card, totals, goals, duplicate meal, or member message.
- Product UX verdict: Ready. Empty nights cost no model usage; historical
  cleanup remains silent; later work and retries retain their ordinary path.
- Complexity guard passed: new helper maximum five, no increased debt in cron;
  existing scheduler hotspots are unchanged. Docs drift and diff checks passed.

## Completion boundary

Local implementation and scoped commit only. No PR, push, deployment, production
mutation, or delivery was requested. Final ReviewGPT and exact-head CI apply
when a PR is opened. The changelog has no source PR number until that PR exists.
Old and new runtimes use the same canonical and operational formats; old runners
can still consume usage on empty occurrences until the updated runner deploys.
Completed: 2026-09-13
