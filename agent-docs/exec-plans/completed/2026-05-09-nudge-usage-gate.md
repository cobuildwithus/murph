# Gate hosted nudge invocations on AI usage

Status: completed
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Close the hosted AI usage quota bypass for Cloudflare nudge-triggered
  runner invocations by enforcing the web-owned usage gate immediately before
  paid runtime work can start.

## Success criteria

- `reason: "nudge"` invocations call the hosted AI usage gate.
- A denied pending nudge is scheduled/reported without invoking the runner
  container.
- Idle-shutdown checkpoint invocations remain exempt because they are
  checkpoint/cleanup work.
- Focused Cloudflare runner tests cover the denied-nudge behavior.

## Scope

- In scope: `apps/cloudflare/src/user-runner.ts` and focused
  `apps/cloudflare/test/user-runner-alarm.test.ts` coverage.
- Out of scope: adding or changing web-side producer pre-gates, pricing policy,
  billing plan behavior, or mailbox handoff protocols.

## Constraints

- Technical constraints: preserve existing pending-nudge retry and user-notice
  behavior through `readHostedAiUsageGateBeforeInvocation`.
- Product/process constraints: treat Cloudflare as final enforcement before
  paid assistant/model work; do not depend on every web nudge producer
  pre-gating correctly.

## Risks and mitigations

1. Risk: blocking non-model maintenance work unnecessarily.
   Mitigation: keep the existing `idle_shutdown_checkpoint` exemption and only
   change foreground nudge work that can reach assistant/provider execution.
2. Risk: overlapping active Cloudflare runner edits in this checkout.
   Mitigation: keep the diff surgical and avoid touching unrelated idle
   checkpoint/browser-vault refresh changes.

## Tasks

1. Replace the `reason: "nudge"` gate exemption with a call to the web usage
   gate.
2. Update the focused user-runner alarm test that currently encodes the bypass.
3. Run focused Cloudflare verification and required completion audits.

## Decisions

- Web/Vercel pre-gates remain useful UX optimization, but Cloudflare must be
  the final enforcement point before nudge-triggered paid runtime work.
- The final commit must stage only the usage-gate hunks because
  `apps/cloudflare/src/user-runner.ts` and
  `apps/cloudflare/test/user-runner-alarm.test.ts` also contain unrelated
  browser-vault refresh/idle-checkpoint edits from other active rows.

## Verification

- Commands to run: focused `apps/cloudflare` user-runner test, then the
  required scoped Cloudflare/typecheck or diff-aware lane per verification
  results.
- Expected outcomes: denied nudge does not invoke the container; nudge gate
  request carries the pending-nudge notice context when relevant.
- Completed:
  - `pnpm exec vitest run apps/cloudflare/test/user-runner-alarm.test.ts --config apps/cloudflare/vitest.node.workspace.ts --project cloudflare-node-platform --no-coverage` passed.
  - `pnpm --dir apps/cloudflare typecheck` passed.
  - `pnpm test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts` passed pre-guards and app typecheck, then exited 143 during `apps/cloudflare verify` while concurrent workspace verification/build jobs were active.
- Audits:
  - `security-privacy-review`: no findings.
  - `coverage-write`: no test edits needed.
  - `task-finish-review`: no findings.
Completed: 2026-05-09
