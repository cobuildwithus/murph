# Restore Disabled Codex Native-Memory Infrastructure

## Outcome

Keep hosted Codex native memory disabled in production through the existing
Codex configuration gates while retaining the complete native-memory egress,
transport, accounting, diagnostics, and test infrastructure for a future
intentional re-enable.

## Protected invariants

- Hosted production config keeps the Codex memory feature, reads, and
  generation disabled together.
- Previously eligible rollouts do not start extraction or consolidation while
  the feature gate is disabled.
- Ordinary OpenAI and Venice inference behavior is unchanged.
- If the gates are intentionally enabled later, native-memory HTTP and
  WebSocket traffic still follows the established authenticated provider,
  usage-accounting, diagnostic, and retry boundaries.
- Murph's canonical vault-backed memory and conversation continuity remain
  unchanged.

## Evidence and root cause

PR #1322 combined two distinct changes: it disabled native memory in the
single hosted Codex config owner, then deleted the dormant provider transport
and accounting path. The requested behavior requires only the first change.
The first PR commit is the proven restoration point because it contains the
disabled config with the full infrastructure still present.

## Current owners and data flow

- `packages/assistant-runtime` owns the generated hosted Codex config and its
  three native-memory gates.
- `apps/cloudflare` owns authenticated OpenAI/Venice provider egress, native
  memory request/response transport, and secret-safe diagnostics.
- `packages/hosted-execution` owns the shared native-memory usage record shape.
- Existing focused tests own disabled-config proof and enabled-path regression
  proof.

## Smallest correction

Reverse only the infrastructure-deletion commit from PR #1322 against current
`main`. Retain its earlier config-disable commit and later disabled-state
regressions. Resolve any overlap by preserving later provider changes while
reinstating the dormant memory path. Add no new feature flag, abstraction,
state owner, dependency, migration, or compatibility layer.

## Failure, rollback, and deploy skew

The restored code is dormant while all three config gates remain false, so a
Worker/container skew window does not activate native memory. Rollback to the
current deployed revision also leaves native memory disabled but removes the
dormant path again. Deploy the Cloudflare runner immediately after merge so
the production bundle matches the corrected retained-infrastructure posture.

## Proof

- Assert the generated production Codex config keeps all three gates false.
- Restore and run focused native-memory HTTP, WebSocket, Venice, diagnostics,
  accounting, and ordinary-turn egress tests.
- Retain real pinned App Server regressions proving disabled individual/group
  turns do not inject memory or start eligible-rollout memory work.
- Run affected package typechecks and exact-head CI.
- Complete preliminary coverage review plus the final cross-cutting ReviewGPT
  gate, then verify the deployed commit and managed-container smoke.
