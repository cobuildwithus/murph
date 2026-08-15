# Direct wake cold-start recovery

Status: active
Updated: 2026-08-14

## Goal

Keep the post-Temporal direct runtime wake below 30 seconds while allowing a
slow healthy container start to be accepted without another inbound message.
Expose the real Cloudflare outcome to Web and use at most one bounded direct
retry; Temporal remains the only durable retry and reconciliation owner.

## Evidence

- The direct OIDC route currently returns `202` before the UserRunner result and
  detaches that result in Worker `waitUntil()`, so Web cannot observe
  `retry_later`.
- Fresh readiness uses the same 8-second timeout for both the RunnerContainer
  operation and its caller-side race. A caller timeout can therefore begin
  write-fence cleanup while the exact readiness RPC is still settling.
- The direct control client already runs after the webhook response and only
  after Temporal accepts the pointer-only durable signal.
- The existing Durable Object write fence already converges concurrent direct
  and Temporal ensures; another queue or state owner is unnecessary.

## Constraints

- Preserve the Web-owned mailbox and Temporal orchestration owners.
- Preserve per-user health-data-consent serialization and shell-prewarm
  behavior.
- Preserve active runner destroy-timeout work. Open PR #1815 also changes the
  startup-confirm timeout, so the final patch must keep its 20-second lifecycle
  intent while reserving cleanup settlement and report merge-order risk.
- Keep logs metadata-only and do not add payloads, prompts, provider facts, or
  member identifiers.
- Maintain mixed-version safety: new Web must tolerate the legacy early ack,
  while new Cloudflare may return the full outcome to old Web.

## Approach

1. Give RunnerContainer readiness a 15-second inner budget, one absolute
   five-second in-lock cleanup deadline across status read and destroy
   settlement, and a distinct one-second caller guard. Clear a failed fresh fence only after the
   readiness RPC itself settles; preserve the fence when only the caller-side
   guard expires.
2. Return the real UserRunner result from the OIDC ensure route and log only
   bounded outcome/correlation metadata.
3. Let the shared control client send an explicit bounded command budget and
   caller signal for direct ensures.
4. Keep one 29-second Web fast-lane deadline. Retry `retry_later` once only when
   its recommended delay and a valid second command budget fit before that
   deadline.
5. Add focused route, client, Web wake, startup-readiness, timeout-ordering, and
   concurrent write-fence tests. Update the live hosted-runtime contracts and
   deployment ordering.

## Verification

- Focused `packages/cloudflare-hosted-control`, `apps/web`, and
  `apps/cloudflare` Vitest files.
- Relevant package/app typechecks.
- Final diff and privacy inspection.
- Exact pushed-head ReviewGPT and required PR checks before completion.

## Progress

- [x] Bound the lifecycle operation to 15 seconds of readiness plus five
  seconds of in-lock cleanup settlement and a one-second caller guard,
  including lifecycle-lock queue time.
- [x] Start the server command deadline at runtime-control authorization,
  before route parsing, Durable Object dispatch, consent serialization, and
  admission, so the direct request is bounded end to end.
- [x] Preserve the fresh write fence when only the caller guard elapses; retain
  compare-clear behavior for settled readiness failures.
- [x] Return and log the real direct OIDC ensure outcome.
- [x] Persist the final parsed direct result kind and accepted action/runtime
  attempt id without retry reasons or raw errors in the relational trace.
- [x] Correlate Workers retry-reason logs with the orchestration attempt while
  keeping Analytics Engine identifiers absent.
- [x] Add the shared 29-second Web deadline and one viable `retry_later` retry.
- [x] Add focused coverage for 12-second readiness, 7.5-second readiness under
  the default command, all readiness-triggered cleanup paths, unresolved guard
  cleanup, release of a queued readiness call at the shared five-second cleanup
  deadline, 15-second readiness plus cleanup before the controller guard,
  direct/Temporal convergence, real route outcomes, bounded retry, and abort.
- [x] Update the hosted-runtime protocol, Temporal contract, and Cloudflare app
  documentation.
- [x] Pass focused tests, full RunnerContainer/UserRunner suites, relevant
  typechecks, Web lint, and diff whitespace validation.
- [ ] Reconcile the pending Review GPT response, archive this plan, commit, and
  open the pull request.

## Surprises and discoveries

- The direct OIDC route detached the Durable Object call with Worker
  `waitUntil()`, so its successful HTTP response could not distinguish an
  accepted start from `retry_later`.
- An outer-only readiness timeout cannot safely clear the fence: the container
  lifecycle RPC may still hold its lock even though the Durable Object's local
  guard has returned.
- The readiness abort may itself trigger up to five seconds of fail-closed
  container cleanup. The controller must use the actual settled RPC outcome
  when cleanup finishes inside that allowance and preserve only when it does
  not settle.
- A pre-destroy state read and destroy settlement previously each received a
  fresh five-second timeout. One absolute cleanup deadline now covers both;
  an explicit unsettled result preserves the fresh fence if cleanup still runs.
- Initial local review found that both lifecycle-lock queue time and
  consent/admission time were outside their apparent bounds. The final design
  starts each absolute deadline before those waits.
- The fresh worktree required the documented generated Prisma and
  health-commons artifacts before the Web test/typecheck lanes could run.
- The control client originally invoked its timing callback before response
  parsing, so its persisted timestamps could not say whether the final call was
  accepted or returned `retry_later`. The callback now fires only with a parsed
  bounded result.

## Decision log

- Reuse one orchestration attempt id and one AbortSignal across both possible
  direct attempts. This correlates the fast lane and makes the 29-second bound
  aggregate rather than per request.
- Keep the legacy `{ accepted: true }` response parser for mixed-version
  rollout. Deploy Web first, then Cloudflare: newer Web still accepts the old
  early acknowledgement and supplies its larger bounded command before the
  Worker begins returning the full result synchronously.
- Preserve the active fresh fence only for the controller's own command-budget
  timeout after readiness dispatch. A timeout before dispatch, or a container
  RPC that actually settles with an error, still uses the existing
  compare-clear and failure accounting.
- Carry forward open PR #1815's 20-second lifecycle intent as 15 seconds of
  readiness plus five seconds of cleanup settlement. Because both PRs touch
  the controller and RunnerContainer lifecycle, merge order may require a
  conflict resolution that retains this split and the one-second outer guard.
- Give short commands the smaller of 15 seconds and their remaining budget
  minus the one-second guard. Do not pre-subtract cleanup time: an unresolved
  cleanup instead preserves the fence when the outer command guard wins.
