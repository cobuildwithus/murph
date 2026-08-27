# Preserve scheduled connection-loss retry provenance

Status: completed
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Make a retryable scheduled assistant failure run at its configured bounded
  retry time instead of waiting behind the hosted-runtime checkpoint floor.
- Preserve the existing exclusion for unrelated aggregate reminder wakes.
- Persist the existing structured Codex connection subtype and optional HTTP
  status through the established privacy-safe failure telemetry path.

## Production Evidence

- A current production scheduled assistant turn failed with the typed
  `ASSISTANT_CODEX_CONNECTION_LOST` fingerprint and no provider actions.
- Canonical runtime state scheduled the first retry about 30 seconds later.
- The hosted invocation recorded the aggregate wake but not invocation-local
  retry provenance, entered checkpointing, and did not run the retry until more
  than six minutes after the failure. The eventual retry produced one outbound
  intent and the provider accepted it.
- The Codex adapter already attached a low-cardinality structured connection
  subtype, but `failure-observability.ts` did not admit that subtype or its
  optional numeric HTTP status into persisted failure context.

## Scope

- In scope: exact retry-wake provenance from scheduled job execution through
  the existing hosted assistant wake projection; privacy-safe structured Codex
  failure fields; focused regression tests, required runtime documentation, and
  one text-only public reliability changelog fragment.
- Out of scope: retry policy changes, Cloudflare alarm behavior, device sync,
  provider delivery-state correlation, new persistence, new schedulers, and
  provider or production mutations.

## Product UX

- Effort: Patch.
- Outcome: A scheduled reminder that loses its Codex connection retries near
  its already-configured deadline instead of waiting behind checkpointing.
- Reaches: Members whose existing scheduled reminder hits a transient
  connection loss; ordinary reminder occurrences and device-sync wakes are
  unchanged.
- Proof: The focused failure/retry path returns and services only the exact
  retry wake, the aggregate-reminder exclusion remains covered, and the
  production-built real-Codex scheduled-reminder journey still makes one normal
  send decision with no tool side effects.

Walkthrough result: Ready. The patch restores the existing timing promise,
preserves the same scheduled output decision, and adds no new message, action,
permission, or provider interaction.

## Constraints

- ReviewGPT exclusively authors production-code and telemetry changes.
- A scheduled retry may enter the hot invocation-local path only when its exact
  retry wake is proven; unrelated aggregate reminder wakes remain excluded.
- Logging is typed, low-cardinality, bounded, and contains no prompts, message
  contents, provider payloads, identifiers, credentials, or raw rows.
- The ordinary functional bug-fix PR remains ready for human merge and is not
  autonomously deployed.

## Tasks

1. Add focused failing diagnostics for scheduled retry provenance and safe
   structured connection subtype retention.
2. Give ReviewGPT the production evidence, code path, constraints, and failing
   tests; inspect its implementation for scope, safety, and ownership. ReviewGPT
   supplied the production patch and then corrected its one invalid relative
   import after the first focused load failed.
3. Run focused engine/runtime tests, affected typechecks, privacy checks, and
   repository completion audits.
4. Commit and push the candidate, open a draft PR, add the ReviewGPT-authored
   changelog fragment with its source PR number, then run ReviewGPT's final
   exact-head review concurrently with required GitHub checks.

## Verification

- Focused cron/runtime and hosted wake regression suites passed: 607 tests.
- Assistant Engine and Assistant Runtime typechecks passed.
- The focused real-Codex scheduled-reminder journey passed with one normal send
  decision and no tool side effects.
- Focused changelog archive coverage passed: 9 tests. Web typecheck passed.
- `git diff --check`, the raw-log privacy guard, provider-boundary guard,
  package-cycle guard, privacy-sensitive diff inspection, and exact-file PR
  overlap check passed.
- Exact-head CI plus the required preliminary and final ReviewGPT gates remain
  the post-commit PR admission checks.

## Post-merge Production Check

- Query bounded hosted runtime logs for the structured Codex subtype and the
  scheduled retry wake provenance.
- For a naturally occurring retryable scheduled failure, compare the persisted
  retry time with the next pass start and prove the retry is no longer delayed
  by the checkpoint floor.
Completed: 2026-08-27
