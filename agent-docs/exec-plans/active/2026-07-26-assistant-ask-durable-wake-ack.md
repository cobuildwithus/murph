# Assistant Ask durable wake acknowledgment

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Return Assistant Ask request/completion success only after Temporal accepts
  the durable mailbox signal.
- Keep the existing payloadless Cloudflare direct wake as a best-effort latency
  hint that starts only after Temporal acceptance.

## Proven cause

- The mailbox append is committed transactionally, but the former
  post-response scheduler deferred the Temporal signal with Next.js `after()`.
- A rejected deferred signal is swallowed, so both Assistant Ask HTTP routes
  can return `200` even though no durable wake owner accepted the work.
- Exact Assistant Ask mailbox identities already make caller retry safe; no
  second queue, receipt, scheduler, or persisted state is needed.

## Constraints

- Preserve the encrypted mailbox as the only durable Assistant Ask work owner.
- Preserve Temporal as the sole durable wake and reconciliation authority.
- Preserve request/completion idempotency and the direct wake's best-effort
  behavior.
- Do not overlap the active hosted-ingress wake-repair lane.

## Approach

1. Replace the post-response scheduler with one awaited mailbox handoff that
   signals Temporal first and starts the existing direct wake second.
2. Await that handoff at both Assistant Ask HTTP boundaries.
3. Add focused helper and route regressions for Temporal rejection and wake
   ordering.
4. Run canonical diff verification and acceptance, preliminary
   completion-specialists ReviewGPT, parent review, and final PR ReviewGPT with
   exact-head CI.

## Verification

- Focused hosted mailbox-wake, group-tool route, and Assistant Ask runtime-route
  Vitest files.
- `pnpm test:diff ...` for every changed path.
- `pnpm verify:acceptance`.
- Preliminary `completion-specialists`, parent final review, then final
  `pr-review` rounds concurrent with CI.

## Review evidence

- The pre-fix focused regression failed in the helper, group-tool handler, and
  completion route because the handoff returned `void` and rejection was
  swallowed after the response.
- The first canonical `pnpm test:diff ...` passed, including 530 Web test files,
  6,746 tests, typecheck, lint with no errors, dev smoke, production build, and
  architecture/policy guards.
- The preliminary `completion-specialists` pass returned one coverage finding:
  the distinct grant-bound `ask_member` rejection branch lacked handler and
  route proof. Its tests-only patch was downloaded from the owned review
  thread, inspected in full, passed `git apply --check
  --whitespace=error-all`, and was applied deliberately without production
  changes.
- The focused specialist remediation passed 92 tests across the group-tool
  handler and route files.
- The post-remediation canonical `pnpm test:diff ...` passed, including 530 Web
  test files, 6,748 tests, typecheck, lint with no errors, dev smoke,
  production build, and repository policy/architecture guards.
- Parent final review found no remaining correctness, architecture, or coverage
  gap in the request/completion call paths or the applied specialist tests.
- All GitHub checks passed on the pushed remediation head.
- The first root `pnpm verify:acceptance` attempt reached broad package/app
  coverage but could not pass on the older branch base: the root ReviewGPT
  dependency was `^0.5.117` while its CLI audit still expected `^0.5.114`, a
  drift already corrected on current `main`; an unrelated interactive
  setup-wizard test also failed during that doomed run. Rebase and a fresh
  acceptance run on current `main` remain required.

## Deployment

- Web-only control-flow correction. No Cloudflare/runtime API or schema change.
