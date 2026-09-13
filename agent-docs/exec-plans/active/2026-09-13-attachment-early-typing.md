# Earlier activity while attachment evidence is prepared

Status: active
Created: 2026-09-13
Updated: 2026-09-13

## Goal

Start authorized attachment typing before media preparation finishes, while preserving evidence-gated assistant execution.

## Product UX

- Outcome: Start authorized attachment typing before media preparation finishes, while preserving evidence-gated assistant execution.
- Reaches: Reply-eligible attachment messages; preserve quiet/ineligible paths, exact routing, existing activity cooldowns and cancellation.
- Proof: Focused synthetic tests through the production owners, including failure and replay boundaries. Member outcome is Ready only after those assertions pass.

## Scope and constraints

Integrate the independently requested ReviewGPT patch against current main. Prefer deletion, reordering and existing public owner seams; reject speculative machinery. Keep the other attachment PR independent. No production mutation or private payloads. Preserve unrelated work.

## Tasks

1. Watch the existing Pro request and inspect its returned attachment and assumptions.
2. Apply only justified changes; reconcile current source and minimize complexity.
3. Run focused regression tests, relevant typechecks and complexity review; add the appropriate member changelog.
4. Review the candidate, create a draft PR, then mark Ready once local proof is complete.
5. Run required final ReviewGPT concurrently with exact-head CI, resolve findings under the repository workflow, and verify mergeability.

## Decisions

- Keep the current session as completion owner for the two independent PRs.
- Accepted the inspected Linq-only patch. Existing per-chat claims own one preparation/turn session; transfer requires a validated route and the same provider-fetch capability. No new registry, timer, queue or durable state.
- Preserve the provider acceptance timestamp across handoff; importer cancellation stops only unclaimed preparation. Evidence admission remains unchanged.
- Reused the common imported result, factored typing context setup, and removed duplicate request telemetry. Importer complexity decreases from 49 to 48; no further decomposition is needed for this scope.
- Corrected a test attachment discriminant and pinned its clock to prevent unrelated retention. Strengthened the blocked-audio scenario with the real Linq adapter and synthetic HTTP acceptance.
- Final ReviewGPT is required for cross-package ownership and earlier provider effects. No real-model journey is required: instructions, tools, interpretation, evidence content and model admission are unchanged; deterministic composed evidence proves the timing boundary.

## Verification

- Baseline: channel activity 24/24 and mailbox importer 72/72; runtime typecheck passed.
- Candidate: attachment typing, channel activity and mailbox importer 115/115; engine delivery 27/27. Both package typechecks passed.
- Composed proof: before HTTP acceptance there is no acceptance milestone; after HTTP acceptance and before audio evidence completes, pending selection and active-turn admission remain empty. The eventual turn reuses the same handle and timestamp.
- Lifecycle proof: failed/pending starts, failed staging, parser retry, unsettled evidence, abort before/after handoff, self-authored messages, consumed replay, duplicate starts, route mismatch, authority mismatch, group eligibility, delivery cleanup and cooldown.
- Complexity guard passed: importer debt 48 to 47, maximum 49 to 48; unchanged staging/source-metadata hotspots 33/26 reviewed. Channel activity maximum 12 to 14 with zero debt.
- Changelog rendering 10/10 and Web typecheck passed. Exact-head CI and final ReviewGPT remain delivery gates.
- Deployment: process-local state and optional in-memory handle field only; old/new runtimes remain wire-compatible. Ordinary container release, no coordinated migration or new rollback floor. Production rollout and live-provider latency measurement are separate.
