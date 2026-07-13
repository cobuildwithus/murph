# PR 511 ReviewGPT Round 9 Fixes

## Goal

Resolve both accepted ReviewGPT round-nine findings for PR 511:

1. Scope accepted-conversation replay allowance authority to the exact earliest pending mailbox row so imported work cannot bypass the gate or borrow another row’s billing period.
2. Turn an exhausted, closed historical allowance period into one durable terminal policy outcome instead of an unbounded retry with a past timestamp.

## Constraints

- Keep Postgres mailbox rows and existing runtime terminal evidence as the only durable authorities; do not add queues, reservation ledgers, or another replay state owner.
- Process adjacent rows separately because conversation/reply grouping does not prove that they share an allowance period.
- Keep current/open exhausted periods retryable at their future reset boundary.
- A terminal historical denial must be idempotent, advance only contiguous consumed progress, and leave later eligible work processable.
- Preserve suspension, access, quota, usage accounting, notice, and write-fence invariants.

## Working Set

- hosted reconciliation and usage-allowance owners under `apps/web`
- mailbox fetch/runtime replay selection under `apps/web` and `packages/assistant-runtime`
- Cloudflare replay invocation propagation and provider-egress authorization
- Temporal retry projection when the gate is nonterminal
- focused web/runtime/Temporal tests and matching hosted runtime documentation

## Verification Plan

- Add focused failing proof for imported-but-unconsumed gating and closed historical-period denial.
- Add exact-row selection and later-pending-row proof at the narrowest production-faithful owner boundary available without new test-only architecture.
- Run focused owner tests while iterating.
- Run required security/privacy and coverage audits, truthful diff-aware verification, parent final review, scoped commit/push, CI, and exact-head ReviewGPT rounds until zero accepted findings.

## Decisions

- Bind each replay invocation to the exact earliest conversation mailbox
  sequence selected by web reconciliation. The runtime imports at most one row,
  freezes foreground refresh to that row, and advances only its contiguous
  sequence after terminal evidence exists.
- Reuse the existing accepted-conversation allowance period and terminal
  auto-reply evidence. An open exhausted period retries at its future end; a
  closed exhausted period runs a provider-free terminal replay with the
  canonical usage-limit suppression reason.
- Include already-delivered mailbox rows when the workspace consumed floor
  lags, but do not re-run the usage gate or expose them as reply candidates.
- Reject terminal replay at both provider-token and native-provider credential
  boundaries, and independently at the interceptor normalization boundary.

## Verification Results

- Focused web replay/allowance tests: 152 passed; web typecheck passed.
- Focused Cloudflare runner/state/interceptor tests: 313 passed; typecheck
  passed.
- Assistant-runtime final-state coverage: 506 passed; the full package passed
  1,547 tests with 2 skipped; typecheck passed.
- Assistant-engine full package: 2,046 passed with 4 skipped after updating the
  existing evidence-module mock for the new exported canonical reason.
- Hosted-execution contracts: 35 focused and 291 full-package tests passed.
- Temporal: 23 focused and 80 full-package tests passed; typecheck passed.
- Security/privacy and coverage-write audits report no unresolved findings.
- The diff-aware verifier passed dependency policy, workspace boundaries,
  architecture/privacy guards, all affected typechecks, and the affected
  package suites except the existing CLI import-surface contract. That contract
  reports eager `assistant-codex`/CLI imports in files unchanged by this round;
  the exact affected production paths and all reverse-dependency packages
  changed here passed.
- Identifier/privacy scan and `git diff --check` passed.

Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
