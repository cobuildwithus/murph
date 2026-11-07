# Return existing Linq dispatch claims without route failures

Status: completed
Created: 2026-10-02
Updated: 2026-10-02

## Outcome and invariant

Return an already-owned dispatch as the existing typed claim result, without
mislabeling it as an unexpected onboarding failure. Preserve send-time authority,
the durable dispatch fence, idempotent text replay, and confirmation-pending
handling for non-idempotent voice and reactions.

## Evidence and owner

The engagement route throws a 409 when the delivery store returns claimed=false.
The runtime already supports providerDispatchClaimed=false, and translates the
legacy 409 into exactly that result. The shared HTTP wrapper logs the exception
as a route failure. The Web engagement route owns the correction; no database,
provider, auth, or runtime production-code change is needed.

## Implementation and proof

- Remove the redundant throw and retain the typed claim result.
- Prove active claims preserve delivery state and emit no failure logs.
- Exercise both legacy conflicts and normal false-claim responses through the
  runtime text, voice, and reaction delivery tests.
- Run focused Web and runtime tests, both relevant typechecks, focused lint,
  complexity diff, privacy inspection, and parent review.

## Rollout and scope

Web-only production change; the deployed runtime supports the result already.
Retain legacy conflict support for rollback. No new external calls, state,
queries, dependencies, or user-visible messaging changes. Changelog is not
applicable: this corrects internal protocol reporting without changing delivery
policy. Deployment and external final review remain separate from local proof.

## Verification

- Before the route change, the focused regression failed with HTTP 409 and
  reproduced the unexpected route-failure warning.
- Web engagement and delivery-store suites: 234 tests passed.
  Command: `pnpm --dir apps/web test test/hosted-onboarding-linq-egress-engagement.test.ts test/hosted-onboarding-linq-observability-store.test.ts`.
- Runtime callback replay matrix: six tests passed, covering text, voice, and
  reactions with both claim-result and legacy-conflict responses.
  Command: `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts --no-coverage packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts -t "existing provider claim|already-started non-idempotent"`.
- Web and assistant-runtime typechecks passed; Web prepared typecheck passed
  again after the final Web test edit.
- Focused Web ESLint, `pnpm docs:drift`, and `git diff --check` passed.
- `pnpm complexity:diff` passed: engagement transaction complexity fell from
  28 to 27. Remaining authority branches are unchanged and out of scope.
- Parent review confirmed unchanged dispatch-store ownership, lock order,
  current authority checks, and retry policy; no new calls or dependencies.
- Local proof uses synthetic provider boundaries, not real provider sends.
  No production deployment or mutation performed. A future PR still needs
  its required CI and final ReviewGPT before release.
Completed: 2026-10-02
