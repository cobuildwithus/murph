# PR 522 Routed Group Directness

## Goal

Make the durable Linq thread-container route the audience authority so every
routed group wake remains non-direct even if later provider metadata is missing
or temporarily reports a direct chat.

## Constraints

- Linq `HostedThreadRoute` is a group-container route; do not let mutable
  provider metadata relabel its shared audience.
- Keep tri-state provider directness for member/private paths without a durable
  thread-container route.
- Use the existing route primitive as proof; add no state or abstraction.
- Preserve the existing mailbox and assistant-planning boundaries.

## Working Set

- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/test/hosted-onboarding-linq-thread-route.test.ts`
- existing mailbox-import and assistant-planning regression coverage
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Verification Plan

- Prove existing routed turns emit `threadIsDirect: false` when provider
  directness is group, unknown, or direct.
- Re-run mailbox-import and assistant-planning regressions that preserve false
  and suppress onboarding.
- Run web typecheck, targeted lint, and the serialized diff lane.
- Run independent completion review and privacy checks.
- Commit, push, require green exact-head CI, and rerun ReviewGPT.

## Verification Results

- Independent code-path validation confirmed that provider `true` or `null`
  could overwrite stored routed-group directness and re-enable onboarding.
- Routed-thread tests passed: 30 tests, covering group, omitted, and
  contradictory direct provider metadata as non-direct.
- Mailbox-import preservation passed: 58 tests.
- Conversation-policy and onboarding-planning seams passed: 51 tests.
- Web typecheck and targeted lint passed.
- The serialized diff lane passed, including 4,048 web tests, production build,
  typecheck, lint with zero errors, and development smoke.
- Diff/privacy scans passed, and completion audit found no evidence-backed
  medium-or-higher issue.

Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
