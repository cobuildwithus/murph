# PR 1010 response-body retry retrospective

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Close the exact-replay gap when an Assistant Ask Web-control response fails
  after headers but before its body is fully consumed.
- Keep one total request deadline and one exact replay for only `ask` and
  `ask_member`.

## Proven cause

- Final ReviewGPT round 2 traced ordinary Web-control responses through
  `Response.text()`, outside the existing bounded response-body transport
  owner.
- A post-header stream failure could therefore escape as an unclassified raw
  error, so the group-tool retry policy did not replay a request whose first
  response may already represent a committed Ask.

## Anomaly retrospective

- Original requirement: acknowledge a committed Assistant Ask only after its
  durable wake handoff is accepted, while preserving caller idempotency.
- First-reviewed shape: the Web routes awaited the durable Temporal handoff and
  started the direct Cloudflare wake only after that acceptance.
- Review-driven growth: round 1 bounded the awaited handoff and added one
  feature-local exact replay at the Cloudflare group-tool port. Round 2 found
  that this replay relied on a transport classifier that covered request setup
  and headers but not ordinary response-body consumption.
- Repeated mechanism: both accepted findings concern the boundary of one
  end-to-end request attempt. Adding another group-tool error branch would
  repeat the ownership mistake.
- Decision: redesign and shrink. Route every Web-control body through the
  existing bounded response-body reader, normalize post-header stream failures
  there, and move the one-replay loop plus total deadline into the Web-control
  transport. The group-tool port will retain only the policy decision that Ask
  actions are replay-safe. Add no durable state, queue, scheduler, lifecycle,
  or compatibility mechanism.

## Approach

1. Add production-path regressions for a lost body after 200 and 5xx headers,
   identical replay, second-failure return, stalled-body cancellation, and no
   replay for authority or unrelated actions.
2. Prove the regressions fail on the current pushed head.
3. Consolidate body consumption and exact replay in the existing transport
   owner, deleting feature-local deadline and error classification.
4. Run focused Cloudflare verification, canonical diff verification,
   acceptance, parent review, final ReviewGPT correction verification, and CI.

## Verification

- Focused Cloudflare group-tool and Web-control transport tests.
- `pnpm test:diff ...` for every changed path.
- `pnpm verify:acceptance`.
- Exact-head final ReviewGPT round 3 concurrent with CI.

## Review evidence

- The production-path 200-body-loss regression failed on the reviewed head:
  the first `TypeError` escaped directly and the committed Ask was not replayed.
- The correction routes ordinary and sensitive response bodies through the
  existing bounded reader, makes that reader the normalization boundary, and
  moves the exact-replay loop plus deadline out of the group port.
- Ten focused group-tool policy and real Web-control transport tests pass,
  including 200/5xx body loss, identical replay, second-failure return,
  complete 5xx handling, stalled-body cancellation, authority rejection, and
  unrelated actions.
- The Cloudflare package typecheck passes.
- The first full Cloudflare Node run proved that the shared reader must preserve
  caller abort and timeout reasons. The normalization now wraps only body
  failures that occur before either bound signal aborts; all 160 directly
  affected tests pass.
- Canonical local diff verification passes for every changed source and test:
  the Cloudflare Node lane reports 110 files / 1,996 tests and the Workers lane
  reports 2 files / 2 tests.
- Full local acceptance passes on rerun, including package coverage plus both
  Cloudflare and Web app verification/builds. The first acceptance attempt hit
  the unchanged setup-wizard Venice completion timing test; its exact focused
  rerun passed before the complete green acceptance rerun.
Completed: 2026-07-27
