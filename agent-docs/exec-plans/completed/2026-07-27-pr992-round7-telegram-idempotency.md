# PR 992 ReviewGPT round 7 Telegram idempotency remediation

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Preserve the dirty-runtime latency improvement for replay-safe Linq external
  completions without giving non-idempotent Telegram delivery the same
  pre-checkpoint provider-drain exception.

## Success criteria

- A foreground-causal completion pass immediately drains only effects whose
  resolved transport declares provider idempotency.
- A selected non-idempotent effect remains in the existing assistant outbox,
  records the system-mailbox receipt, and arms the existing assistant outbox
  wake for ordinary checkpoint-gated delivery.
- Focused tests prove both exact external-completion families retain their Linq
  fast path and defer Telegram without a provider call in the causal pass.

## Scope

- In scope: the system-mailbox foreground-causal delivery boundary, focused
  assistant-runtime tests, exact-head verification, and PR round-7 disposition.
- Out of scope: a new queue or state owner, changing Telegram's provider
  contract, or redesigning ordinary checkpoint-gated outbox delivery.

## Constraints

- Preserve the existing mailbox, outbox, checkpoint, and wake owners.
- Keep generic notifications and unrelated pending outbox work out of the
  foreground-causal completion pass.
- Preserve the immutable ReviewGPT baseline and round lineage.

## Tasks

1. Filter the foreground-causal post-checkpoint drain to transport-idempotent
   effects and carry the existing outbox wake for any deferred effect.
2. Add focused Linq/Telegram coverage for both admitted completion families.
3. Run scoped verification, close this plan, commit, push, and update PR #992.

## Verification

- Focused assistant-phase and real runner coverage passed: 504 tests across
  `hosted-runtime-workspace-assistant-phase.test.ts` and
  `hosted-runtime-workspace-entrypoint.test.ts`.
- The fixture-corrected assistant-phase suite passed independently: 258 tests.
- Assistant Runtime typecheck passed.
- Canonical `pnpm test:diff` passed, including 1,915 Assistant Runtime tests,
  2,012 Cloudflare Node tests, and 2 Cloudflare Workers tests.
- `pnpm verify:acceptance` passed the directly affected Assistant Runtime
  coverage lane with 1,915 tests, plus workspace typechecks, Web's 6,901-test
  suite, and the other completed package/app lanes. The aggregate command
  remained red only because the untouched Setup CLI Venice wizard test selected
  the OSS option; the exact isolated coverage rerun reproduced that mismatch,
  and this branch has no diff under `packages/setup-cli`.

## Decisions

- Round 7's sole finding is accepted. The exact-family admission itself is safe,
  but the resulting delivery transport must independently prove idempotency
  before it can enter the pre-checkpoint provider-drain exception.
- Deferred non-idempotent effects retain the existing outbox's immediate
  assistant wake. The real runner proof observes Telegram pending in the causal
  pass, an idle checkpoint, and provider entry only from the later ordinary
  pass; replay-safe Linq still enters the causal provider pass.
Completed: 2026-07-27
