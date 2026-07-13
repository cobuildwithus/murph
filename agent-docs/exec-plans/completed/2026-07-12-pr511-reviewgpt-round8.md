# PR 511 ReviewGPT Round 8 Fixes

## Goal

Resolve the two accepted ReviewGPT round-eight findings for PR 511:

1. Let an already committed conversation pass processing-time allowance checks after ordinary billing/access revocation without bypassing quota or security suspension.
2. Keep the existing runtime write fence authoritative until a locally aborted workspace invocation has drained and the warm shell has stopped fail-closed.

## Constraints

- Treat the durable conversation row as the accepted-work proof; do not add replay state, tokens, queues, or another authority source.
- Bypass only current billing/access re-admission for accepted conversation work. Preserve suspension, allowance limits, spend accounting, system-lane access, and outbound authority.
- Reuse the existing runner lifecycle lock and fail-closed stop. Abort signal acceptance alone is not child settlement.
- Keep active-access behavior and non-conversation runtime behavior unchanged.

## Working Set

- hosted AI usage allowance and runtime usage-gate owners
- reconciliation and mailbox fetch/payload boundaries
- runner-container abort settlement and runtime processing controller coverage
- focused web and Cloudflare tests
- matching architecture/runtime protocol documentation if behavior needs clarification

## Review Findings

- ReviewGPT round eight confirmed that accepted conversation replay still hit
  the inactive-access gate and that local abort acceptance could clear the
  runtime fence before child drain and shell stop settled.
- Completion audit found that processing-time allowance resolution could grant
  a later calendar allowance, and that Worker-owned provider usage lacked the
  replay authority needed for historical accounting.

## Decisions

- Anchor replay allowance to the earliest pending durable conversation row's
  Postgres `createdAt`; carry it transiently through reconciliation, Temporal,
  the active runner fence, and signed usage callbacks.
- Reuse and lock an existing allowance period containing that anchor; otherwise
  require retained trial/current billing metadata to contain it and deny
  calendar or unproved container fallback.
- Preserve an existing historical usage-period row exactly during replay rather
  than reconciling it to the current plan limit.
- Return replay mode and allowance anchor from provider-token or native-provider
  credential validation so Worker-owned spend uses the same accounting path.
- Treat abort as settled only after the lifecycle lock, child drain, and
  fail-closed shell stop complete.

## Verification Plan

- Focused real-resolver tests for active, revoked, exhausted, and suspended accepted-conversation decisions.
- Focused reconciliation and mailbox route tests proving revoked accepted rows remain visible.
- Runner-container and UserRunner tests proving the old fence survives drain/stop failure and replacement begins only after settlement.
- Diff-aware verification, required completion audits, push, CI, and another exact-head ReviewGPT pass.

## Verification Results

- Focused web replay/usage/reconciliation/internal-route tests: 210 passed.
- Cloudflare focused runner/provider/state tests: 589 passed; the corrected
  write-fence persistence case also passed 7/7 in isolation.
- Hosted execution contracts: 291 passed; Temporal orchestration: 79 passed.
- Web, Cloudflare, hosted-execution, and Temporal typechecks passed after the
  final source changes.
- Coverage-write re-audit: zero unresolved findings.
- Security/privacy re-audit: zero unresolved Critical, High, or Medium findings.
- The first diff-aware run hit one unrelated Codex app-server shutdown flake;
  that exact assistant-engine test passed 1/1 on immediate isolated rerun. The
  final `pnpm test:diff` rerun passed all affected package, web, Cloudflare,
  boundary, build, lint, and smoke lanes.
Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
