# Foreground runtime ownership handoff

## Outcome and architecture

Foreground admission should continue after a completed background owner or a
confirmed retired target without an artificial scheduler delay. Postgres remains
the sole admission owner; native receipts and liveness remain stop evidence.
Unknown liveness, uncertain launch, and unsettled retirement must stay pinned.

Recovery currently splits completion and release into two callbacks, allowing
concurrent completion to turn successful progress into a stale release and retry.
It also returns a retry after retiring an unusable retained target. Reuse the
existing combined completion/release command and re-admit only at these settled
boundaries. Bound same-request admission and preserve exact identity checks.
No schema, protocol, dependency, queue, or persisted coordination state is needed.

## Work and proof

- Reproduce concurrent completion and cold retained-target handoff with synthetic
  fixtures at the production ensure-processing entrypoint.
- Simplify recovery and preserve active background promotion, unknown liveness,
  exact retirement proof, admission denial, and single-launch behavior.
- Run focused runtime tests, Cloudflare typecheck, complexity and diff review.
- Update the runtime owner contract and member-visible changelog; commit scoped work.

## Product UX

Outcome: incoming messages avoid unnecessary delays after background completion.
Reaches: foreground arrivals during live background work, after completion, and
retained-target expiry; ambiguous native ownership still fails closed.
Proof: deterministic admission-to-native-launch and active-wake scenarios. Local
proof does not establish deployed latency; production rollout remains separate.

## Deployment and status

Worker-only correction using existing Web commands and response shapes; no
migration or consumer rollout dependency. Local implementation complete; no
production mutation performed. PR CI and final ReviewGPT belong to a future
pushed PR lane, per the review loop's eligibility prerequisites.

## Verification and review

- Regression first: three new scenarios failed against the unchanged runtime
  processing implementation with `retry_later` instead of accepted processing.
- Focused runtime processing, completion publication and summary: 52 tests passed.
- Native container foreground/completion/retained/liveness selection: 25 passed.
- Cloudflare typecheck passed after generating the worktree's Prisma client.
- Web typecheck and changelog generation passed; changelog archive: 10 passed.
- `pnpm complexity:diff` passed: zero hotspots, maximum complexity unchanged at 19.
- Parent review: canonical admission remains mandatory on each transition;
  no receipt or stale completion response grants execution. Unknown liveness,
  unsettled retirement, unchanged ownership, foreign admission, repeated
  contention and deadline expiry remain closed. No new state or wire shape.
- Product UX: Ready for local scope. Live background promotion remains immediate;
  completed background and retired-target journeys now reach one native start
  in the same request. Deployed latency has not been measured.
- Healthy warm/fresh paths add no awaited operation. Recovery removes one
  release callback; at most three admitted generations can be visited within
  the existing command budget. Read-only preparation stays bounded per attempt.
- No new developer-friction entry: dependency generation used the existing
  worktree preparation command without a workaround.
Status: completed
Updated: 2026-09-23
Completed: 2026-09-23
