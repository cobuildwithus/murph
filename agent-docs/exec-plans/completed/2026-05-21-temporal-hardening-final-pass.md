# Temporal hardening final pass

Status: active
Created: 2026-05-21
Updated: 2026-05-21

## Goal

- Apply the final low-risk Temporal hardening items from the latest architecture review without changing the one-workflow-per-user design.

## Success criteria

- Malformed raw Temporal Signals are tolerated in workflow state instead of failing Workflow Tasks.
- Best-effort account-deletion workflow termination closes late-resolving Temporal connections after the app-level timeout wins.
- Production Temporal worker startup sets explicit concurrency/poller limits with narrow env overrides and documents them.
- Non-retryable execution Activity failures use a longer Workflow-level retry wait than retryable transport failures.
- Focused workflow, worker, termination, package coverage, and typecheck lanes pass or any blocker is proven unrelated.

## Scope

- In scope:
- `packages/hosted-orchestrator-temporal` workflow and worker hardening.
- `apps/web` Temporal workflow termination cleanup helper.
- Minimal contract/docs/test updates required by those code changes.
- Out of scope:
- Shared Temporal env parser precedence changes, because an active row already owns that file set.
- Temporal Workflow command-order changes that would require replay proof.
- Account-deletion service ordering changes.

## Constraints

- Technical constraints:
- Do not add, remove, or reorder awaited Temporal command-producing APIs in `hosted-user-runtime.ts`.
- Keep Temporal workflow state pointer-only and free of payloads, local paths, prompts, transcripts, provider responses, and direct identifiers.
- Preserve unrelated dirty files and active ledger rows.
- Product/process constraints:
- Follow high-risk repo workflow: plan, ledger, focused verification, required audits, scoped commit if safe.

## Risks and mitigations

1. Risk: Workflow signal parsing changes could accidentally throw and poison old histories.
   Mitigation: Parse defensively, count invalid signals as compact diagnostics, and keep invalid signals as no-op.
2. Risk: Worker concurrency defaults could over-constrain throughput.
   Mitigation: Use conservative production defaults with env overrides and tests proving option parsing.

## Tasks

1. Add malformed-signal tolerance and focused workflow coverage.
2. Add late-close handling for timed-out termination connections and focused web coverage.
3. Add explicit worker concurrency/poller options, docs, and focused worker coverage.
4. Run required verification and completion audits.

## Decisions

- Leave shared Temporal TLS/env precedence unchanged in this pass because `temporal-env-parser-dedup` is the active owner.
- Do not change workflow await ordering; all workflow changes must stay inside existing signal handling and existing retry waits.

## Verification

- Commands to run:
  - `pnpm --dir packages/hosted-orchestrator-temporal test:coverage`
  - focused hosted-web workflow termination test
  - `pnpm typecheck`
- Expected outcomes: all pass, or any failure is documented as unrelated with a focused passing lane for this scope.
