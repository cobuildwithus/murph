# Reduce redundant device history work while preserving completeness

Status: completed
Created: 2026-09-22
Updated: 2026-09-22

## Outcome and invariants

Reduce network and control-plane work for bounded Junction historical imports without
changing resource coverage, canonical records, webhook latency, retry ownership, or
foreground priority. Preserve complete calendar-day requests, live source admission
before writes, durable suffix progress, and failure replay.

## Owners and evidence

The provider owns inventory and the bounded daily loop in device-syncd. Existing
full-history continuations reread inventory inside each daily unit; empty-source
fence batching currently applies only to unscoped reconciliation. Prove these costs
with synthetic call-count scenarios before changing them. Assistant-runtime owns
checkpointed continuation returns; investigate the existing system-mailbox return
path before changing due-work handoff. Do not infer a scheduler fix from timing alone.

## Design

Reuse inventory only inside one bounded job, with no persistent cache or new owner.
Use the existing source-lifecycle fence to validate empty batches once before saving
progress. Keep current authority reads before every actual canonical import.
Investigate continuation latency with the existing mailbox/checkpoint protocol;
change it only with direct regression proof. Do not widen provider query windows,
skip empty historical periods, remove safety budgets, or introduce concurrency.

## Product UX (Patch)

- Outcome: same complete device history and prompt new-data delivery with less work.
- Reaches: sparse and populated history, disconnect/reconnect, provider failure,
  restored continuations, and foreground interruption.
- Proof: provider-shaped day coverage, canonical import/replay, source-fence races,
  call counts, and hosted continuation tests when the runtime boundary changes.

## Work and verification

1. Add focused regressions and measure the baseline request counts.
2. Remove redundant reads at the bounded provider owner; preserve failure semantics.
3. Trace and prove any runtime handoff correction before implementing it.
4. Run relevant provider/runtime tests and typechecks, inspect complexity and privacy,
   update owner docs, and perform required review at the authorized delivery boundary.

## Failure and deployment

No persisted shape, resource policy, credential, or canonical schema changes are
planned. Each job discards local inventory on return or failure. Old and new runners
can consume the same job suffixes. Production deployment and live validation remain
separate from local implementation.

## Verification results

- Provider proof: 160 tests pass across empty-history reads, full-backfill progress,
  timeseries source reuse, provider history, workout streams, and historical fanout.
  Synthetic 16-day empty scoped batches use one inventory read and one live source
  read instead of sixteen each, with all sixteen data requests retained. Two
  serialized batches cover all 32 days; populated days retain individual live
  admission checks, and reconnects or unavailable authority reject progress.
- Runtime proof: 131 tests pass across device-continuation, system-mailbox entrypoint,
  and system preemption. The actual provider executes 1,600 unique synthetic daily
  requests, saves a one-day remainder, and requests a model-free recheck. Future
  work, failed fetches, old progress generations, and checkpoint failure do not
  create a successful immediate continuation. The maintenance-loader test also passes.
- Typechecks pass for device-syncd, assistant-runtime, and Web. Changelog archive
  proof passes all 10 tests from the repository root. The package-local command in
  the changelog README finds no tests; existing Frog entries already cover it.
- Complexity guard passes: runtime debt and maximum remain unchanged; provider
  debt decreases by one. Reviewed the changed continuation and return-path
  hotspots; broad extraction of their unrelated policy would expand this patch.
- Docs drift and whitespace checks pass. No production rows or identifiers are
  included. Parent review checked live authority, bounded cache lifetime,
  foreground handoff, durable failure, and unchanged persisted suffix formats.
- Product UX: Ready for the local candidate. The measured improvement is request
  count, not a production wall-clock speed claim. Foreground and fresh-data
  priorities, daily fetch coverage, safety budgets, and retry ownership are unchanged.

## Implementation and delivery

The independent workspace completion callback previously dropped system-progress
metadata. It now carries that existing evidence into the checkpoint, without
re-crediting canonical progress already published during preparation. The return
path distinguishes foreground rechecks from device-only continuations; due device
work requests the existing owner-release signal only after the saved progress
generation advances and the returned wake matches the durable wake.

The candidate remains on its task branch for review. No production changes,
restart, deployment, remote push, or PR publication were performed. Final external
PR review and CI belong to a subsequent PR delivery; add that PR's provenance to
the prepared changelog before publication. Deployment requires only the normal
runner release: existing Web/Worker consumers already understand the recheck flag,
and old runners can read the unchanged suffix and checkpoint shapes. After release,
compare inventory/source-read counts and inter-pass delay while checking canonical
imports, retries, backlog age, and foreground latency.
Completed: 2026-09-22
