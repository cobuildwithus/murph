# PR 610 Clinical Records review remediation

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Keep Clinical Records sync bounded and privacy-safe when canonical import
  planning is cancelled or deterministically rejected.

## Success criteria

- Known immutable-replay and event-reconciliation conflicts become the existing
  safe terminal snapshot-rejected result without exposing FHIR identifiers.
- Foreground cancellation interrupts canonical import planning before commit,
  while a completed canonical commit retains its original counts and outcome.
- Focused tests, affected typechecks, repository guards, privacy scans, CI, and
  exact-head ReviewGPT are green.

## Scope

- In scope: the core event-import planning signal, Clinical Records vault
  composition error translation, runtime post-commit outcome handling, and
  focused regressions.
- Out of scope: SMART OAuth producers, UI, new routes, queues, schedulers,
  persisted runtime state, or changes to unrelated import flows.

## Constraints

- Technical constraints: preserve raw-first evidence, one atomic canonical
  commit, public package boundaries, transient retry behavior, and existing
  replay semantics.
- Product/process constraints: smallest maintainable correction; no browser,
  helper, or product-scope expansion.

## Risks and mitigations

1. Risk: cancellation after the canonical commit could hide a successful write.
   Mitigation: make planning interruptible but keep the final commit unit
   non-interruptible and remove the post-commit cancellation check.
2. Risk: broad error translation could terminalize transient failures.
   Mitigation: translate only four proven deterministic `VaultError` codes and
   preserve every other error unchanged.

## Tasks

1. Merge current main and resolve only genuine Clinical Records overlaps.
2. Thread the existing signal through event-import planning and interruptible
   vault traversal/read phases.
3. Translate deterministic Clinical Records persistence conflicts to the
   existing safe terminal error.
4. Add focused cancellation, post-commit outcome, and privacy regressions.
5. Verify, commit, push, rerun exact-head ReviewGPT, and reconcile CI.

## Decisions

- Reuse existing core interruptible traversal/read primitives; do not add a
  Clinical Records-specific state machine or minibatch owner.
- Once the atomic canonical mutation begins, preserve its result even if
  foreground cancellation arrives concurrently.

## Verification

- Focused core, vault-usecases, assistant-runtime, and Cloudflare tests.
- Affected package typechecks plus dependency, boundary, cycle, diff, privacy,
  secret-shape, unsafe-logging, and prohibited-cast guards.
- Expected outcome: all pass, with no identifier leakage and a clean worktree
  on the exact pushed PR head.

## Results

- Core event import: 32 tests passed, including cancellation during historical
  planning, no partial canonical write, lock release, and successful replay.
- Vault Clinical Records: 14 tests passed, including immutable raw replay and
  canonical conflict terminalization with preserved raw evidence.
- Assistant-runtime Clinical Records: five files and 278 tests passed; the
  directly changed file passed again after the final privacy assertion.
- Cloudflare: Clinical Records port 9 tests passed; merged runner-outbound route
  coverage 186 tests passed.
- Typechecks passed for core, vault-usecases, assistant-runtime, hosted-execution,
  Cloudflare, and all 18 packages mapped by the diff-aware reverse-dependent lane.
- Dependency, workspace-boundary, package-cycle, hosted-crypto, hosted-Temporal,
  raw-health logging, diff, private-identifier, secret-shape, prohibited-cast,
  and unsafe-logging checks passed.
- The broad diff-aware package-test fanout reported six failures in four
  untouched assistant-runtime files under concurrent load: three 60-second
  timeouts, one dependent mock-count mismatch, and two fixed temporary-vault
  filesystem races. All four files then passed serially: 82 tests total.
Completed: 2026-07-14
