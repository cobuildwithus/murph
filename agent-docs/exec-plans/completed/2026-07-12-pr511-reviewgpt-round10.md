# PR 511 ReviewGPT Round 10 Fixes

## Goal

Resolve both accepted ReviewGPT round-ten findings for PR 511:

1. Carry exact accepted-row replay authority through mailbox fetch so restored
   local work cannot be displaced by a later remote row and cold replay can
   bootstrap only the required activation prerequisite.
2. Preserve the accepted row's historical AI allowance period atomically with
   conversation acceptance so later billing, sponsorship, or access changes do
   not strand committed work.

## Constraints

- Reuse the existing mailbox row, workspace metadata, usage-period table, and
  typed replay protocol; add no queue, replay ledger, token table, or second
  billing owner.
- Exact replay must never import, project, execute, or gate a different
  conversation row.
- Cold replay may import only the same-user activation prerequisite required to
  open the vault; it must not execute welcome or other system work.
- Acceptance-time period preservation establishes authority only. It must not
  spend allowance, send a notice, or reject an accepted message because a
  period is exhausted.
- Preserve current suspension, quota, provider-egress, write-fence, and
  contiguous consumed-floor invariants.

## Working Set

- hosted mailbox fetch/payload contracts and storage under `apps/web`
- conversation acceptance and usage-allowance ownership under `apps/web`
- assistant-runtime bootstrap/prefetch/import paths
- focused web/runtime integration tests and hosted-runtime protocol docs

## Verification Plan

- Add failing production-boundary proof for cold replay and restored local
  exact-row replay with a later denied remote row.
- Add transactional acceptance proof with no preseeded usage period followed by
  billing, family, and thread-container authority changes.
- Run focused tests and typechecks while iterating.
- Run the required completion audits, diff-aware verification, scoped commit,
  CI, and exact-head ReviewGPT rounds until no actionable findings remain.

## Decisions

- Carry the existing invocation's accepted sequence, canonical acceptance time,
  and replay mode as one transient typed authority through mailbox metadata and
  payload requests. Web proves it against the same-user durable row and current
  non-suspension before returning only that row.
- Cold replay may additionally fetch a routed `member.activated` item as the
  sole vault-bootstrap prerequisite. It cannot fetch or run any other system
  work.
- Wrap every production `conversation.message` append with one canonical
  acceptance helper. On a new insert, that helper materializes or reuses the
  existing allowance-period owner in the same transaction; duplicates do not
  repeat the work.
- Closed-period usage-limit replay remains provider-free and skips the repeated
  allowance decision, but current suspension still fails closed.
- Add no replay queue, token, table, billing snapshot, or second owner.

## Verification Results

- Hosted web, Cloudflare, hosted execution, and assistant runtime typechecks
  passed.
- Focused hosted web tests passed: 327 tests across mailbox routes/store,
  acceptance/allowance, and Linq/Telegram/WhatsApp/email ingress paths; the
  final allowance file rerun passed 97 tests.
- Hosted execution runtime-control tests passed: 28 tests.
- Assistant runtime replay/workspace tests passed: 215 tests.
- Focused Cloudflare write-fence, proxy, platform, and state-store tests passed:
  317 tests.
- The coverage-write audit added cold/warm exact-replay, sidecar, fail-closed,
  four-provider acceptance, historical-period, and rollback proof and returned
  with no unresolved findings.
- The security/privacy audit found one medium active-fence authority-confusion
  issue. The accepted fix binds replay sequence, timestamp, mode, and bootstrap
  allowance to the active Cloudflare write fence; its re-audit returned zero
  unresolved critical, high, or medium findings.
- Diff-aware verification passed dependency, boundary, architecture/privacy,
  affected typecheck, 10 reverse-dependent package, hosted-web, and Cloudflare
  lanes. Hosted web passed 4,333 tests (11 skipped), Cloudflare passed 1,747,
  and both production builds completed.
- Latest-main merge proof, CI, and exact-head ReviewGPT remain pending.

Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
