# Trace device-sync failures through durable recovery

Status: completed
Created: 2026-10-07
Updated: 2026-10-07

## Goal

Make a failed logical device job distinguishable from unrelated successful work across hosted cold handoff, without recording private content or changing ingestion behavior.

## Success criteria

- Bounded metadata correlates failure, subsequent logical work, importer outcomes and existing durable checkpoint evidence; unknown or truncated coverage stays explicit.
- Synthetic owner tests preserve cold-handoff identity, namespace isolation, batched/partial outcomes, cancellation and canonical write ownership.
- Focused tests, affected typechecks, parent inspection, complexity check, exact-head CI and final ReviewGPT complete before delivery is called ready.

## Scope

- In scope: existing device-sync diagnostics, hosted runtime-log projection, narrowly required compatible reader changes, focused tests and the observability owner document.
- Out of scope: billing/access changes, provider actions, retry or timeout tuning, data recovery, canonical mutations, new durable state or scheduling systems.

## Constraints

- Selected external implementation author owns production code and telemetry. Local agent owns evidence, patch inspection, validation, Git and PR management.
- No raw member/connection/job identifiers, provider data, date windows, cursors or health values in logs, artifacts or review packets.
- Preserve foreground priority and existing buffered best-effort telemetry, cardinality/volume bounds and retention.
- Do not merge/deploy any bug-fix PR. A telemetry-only deployment remains conditional on review, CI and the established deployment workflow.

## Risks and mitigations

1. Misleading recovery inference: distinguish job progress from import outcome and accepted checkpoint; validate ownership and state unknown coverage.
2. Privacy or volume growth: derive opaque contextual identity from existing owners and test bounds and redaction without new persisted state.
3. Mixed versions: exercise old-reader/new-producer and new-reader/old-producer contracts as applicable.

## Tasks

1. Inspect existing ownership and diagnostic gap; establish isolated authorized checkout.
2. Obtain an externally authored focused patch with synthetic proof.
3. Inspect, apply accepted patch exactly, run focused validation and return substantive corrections to the author.
4. Close plan, commit and push draft PR, complete candidate review, then final ReviewGPT concurrently with required CI.
5. Record exact outcome and deployment/observation decision.

## Decisions

- Use one telemetry-only PR unless a separate behavioral defect is proven. No retry-policy change is justified solely by recovered upstream failures.
- Supplied checkout was rejected by the repository storage guard. The primary checkout's sanctioned creation helper created this isolated task checkout; no guard bypass or other-session edit.
- Preferred ReviewGPT implementation send failed before submission because its concrete model could not be selected. Claude Code API then verified `claude-opus-5-5`; that selected author is implementing the patch. The final ReviewGPT gate remains required.

## Verification

- Dependency installation completed through normal hooks in the authorized checkout.
- Baseline `pnpm --filter @murphai/device-syncd exec vitest run --config vitest.config.ts test/junction-transport-reproduction.test.ts --no-coverage`: 2 passed; real HTTP stalls before headers and during body retain distinct timeout diagnostics.
- `pnpm --filter @murphai/device-syncd exec vitest run --config vitest.config.ts test/service.test.ts --no-coverage`: 179 passed.
- `pnpm --filter @murphai/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-device-sync-runtime.test.ts test/hosted-runtime-maintenance.test.ts --no-coverage`: 308 passed on the final source candidate.
- Both affected package typechecks passed; `pnpm complexity:diff` passed, with no increased debt in the maintenance owner and one less in runtime hydration/recovery.
- The two exact documented SQL queries passed 12 isolated PostgreSQL fixtures covering batch versus single-row imports, accepted/rejected/missing checkpoints, incomplete coverage, unrelated connections and reused-key disposition. No production access in this diagnostic.
- Parent inspection confirmed existing recovery-key derivations are unchanged, raw identities remain in memory, only bounded prefixes are hashed, existing runtime-log transport/parser/storage are reused, and no retry/access/canonical-write behavior changes.
- Accepted author patch was captured and reapplied exactly; every authored source/test/observability-document file retained its SHA-256 digest. Claude Opus 5.5 authored all such edits and substantive corrections.
- Internal telemetry only: no member-facing changelog or provider-input measurement applies. Existing individual/group prompt surfaces are unchanged.
- Implementation and local candidate review complete. Exact-head CI and final ReviewGPT remain delivery gates tracked on the PR; no merge or deployment has occurred.

## Observation and remaining gates

After reviewed deployment, observe 24–72 hours of natural traffic, allowing at least 24 hours after the failure cohort ends. Run the bounded aggregate coverage/classification queries in the observability owner document. Missing legacy/truncated evidence remains inconclusive. Keep the fields only if they distinguish completed, retained, dead and missing logical work; otherwise remove them. Existing info/warning retention is unchanged. No production traffic generation or recovery action is authorized.

Final ReviewGPT must select and verify the supported concrete model. Its implementation-author selection failure cannot be counted as a completed review; the authenticated Claude Opus 5.5 fallback does not waive this gate.
Completed: 2026-10-07
