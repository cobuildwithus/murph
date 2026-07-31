# Bound live-steer acceptance to provider coverage

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Ensure every late conversation input remains reply-eligible until provider-visible
  evidence covers it or the runtime records an explicit terminal non-reply.

## Success criteria

- A regression test reproduces a successful `turn/steer` acknowledgement that
  settles after the first response closes admission while the provider result
  still covers only the original input.
- Provider-success and hosted-tool preflight drains accept only live-steered
  inputs covered by their authoritative delivery-context ordinal.
- A late uncovered input is not journaled, checkpointed, included in terminal
  reply evidence, or consumed; it remains pending for the next ordinary scan.
- Focused assistant-engine tests and typecheck pass.
- Required exact-head ReviewGPT and CI gates pass before completion.

## Scope

- In scope:
  - Active-turn live-steer acceptance in `packages/assistant-engine`.
  - Hosted dynamic-tool preflight coverage propagation.
  - Focused regression tests for successful steer acknowledgement at an
    uncovered provider frontier.
  - Narrow durability documentation updates only if the implementation changes
    the documented owner contract.
- Out of scope:
  - Alert-monitor behavior or thresholds.
  - New queues, retry owners, persisted schemas, or compatibility shims.
  - Production data repair; the observed input has already reached a terminal
    checkpoint state.

## Constraints

- Technical constraints:
  - Preserve one active-turn owner and the existing delivery-context ordinal as
    the authoritative provider-coverage frontier.
  - Do not delay provider start or add network, database, or provider calls to
    the foreground reply path.
  - Preserve explicit no-reply and provider-failure recovery behavior.
- Product/process constraints:
  - Preserve the product-critical current-inbound reply flow.
  - Use an isolated worktree and PR lane.
  - Treat the ReviewGPT patch as untrusted intent: inspect it, apply it
    deliberately, and verify the full changed call path.

## Risks and mitigations

1. Risk: An ordinal bound is applied only after provider completion while a
   hosted tool preflight can still over-promote an uncovered steer.
   Mitigation: Propagate and test the provider-visible ordinal at both effect
   preflight and final-result ownership boundaries.
2. Risk: A covered late input fails to checkpoint before an irreversible tool
   effect or delivery.
   Mitigation: Retain the existing bounded drain-before-effect ordering and add
   covered-ordinal proof alongside the uncovered case.
3. Risk: Narrow tests exercise controller and provider behavior separately but
   miss their combined ordering.
   Mitigation: Add a service-level deferred-promise regression reproducing the
   exact settlement order.

## Tasks

1. Ask ReviewGPT Pro to implement the smallest patch and return a reviewable
   `.patch` or `.diff` attachment.
2. Inspect the artifact paths, behavior, and test coverage; reject unrelated or
   over-broad changes.
3. Apply the accepted patch and refine only where direct code-path inspection or
   focused proof finds a gap.
4. Run focused regression tests, assistant-engine typecheck, and a direct
   scenario proving uncovered input remains pending.
5. Commit and push the candidate, open a PR, and run the required preliminary
   specialist and final ReviewGPT exact-head gates concurrently with CI.
6. Resolve findings, perform parent final review, close this plan, and push the
   final scoped commit.

## Decisions

- Use the existing delivery-context ordinal as the single coverage frontier
  instead of introducing acknowledgement state or another persisted owner.
- Product-experience and coverage lenses apply because the fix changes
  asynchronous continuation and recovery behavior. Prompt and frontend lenses
  do not apply.

## Verification

- Commands to run:
  - Focused Vitest commands selected from the changed tests.
  - `pnpm --dir packages/assistant-engine typecheck`
  - Required exact-head GitHub Actions and ReviewGPT gates.
- Expected outcomes:
  - The pre-fix race fails the new regression and passes after the patch.
  - Covered late inputs still checkpoint before effects; uncovered inputs remain
    pending with no terminal reply evidence.
  - Typecheck, CI, preliminary specialist review, and final ReviewGPT review all
    pass.
