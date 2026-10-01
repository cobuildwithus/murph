# Keep image rollouts off the message path

Status: completed
Created: 2026-09-07
Updated: 2026-09-07

## Goal

Prepare a matching, ready runtime before selecting it for member messages.
Keep the serving image untouched during preparation and preserve in-flight owners.

## Success criteria

- Reproduce the previous Worker/new-image ordering failure with synthetic inputs.
- A slow or failed candidate cannot be selected for member work.
- Exact image admission remains enforced independently for both targets.
- Promotion changes the selected release without rolling either container target.
- A previous target cannot be reused until provider evidence proves it drained.
- Focused tests, typecheck, required review/CI, protected deployment and live
  convergence verification pass.

## Scope and constraints

Reuse the existing UserRunner write fence, opaque slot identities, standby
coordinator, signed deploy smoke, Wrangler and release receipts. Add one
interchangeable container namespace and an explicit deployment release identity.
No new retry policy, scheduler, product state owner or model behavior.
Use synthetic evidence; production credentials remain in the protected workflow.

## Product UX

Effort: Patch. Foreground messages keep the active image throughout candidate
preparation. Candidate readiness and drain waits belong to deployment only.
Existing completion and cleanup calls retain their exact container name.
Status: completed

## Decisions

- Full Wrangler deploys activate Worker code before updating container images.
  Immediate rollout does not make those operations transactional.
- Publish the image once and pin its registry digest before any activation.
- Stage the inactive namespace with the current release still selected.
  Wrangler per-application `rollout_kind: none` freezes the serving application.
- Reuse signed smoke and the existing ready-slot inventory before promotion.
- Promote with rollout disabled for every application; retain the old release
  until its instances drain. The next deployment reads live release metadata.
- Preserve consumer-first Worker/container protocol compatibility: preparation
  runs the new backward-compatible Worker controller against the old active image.
- Remove the earlier short-retry experiment. No failure delay is added or shortened.

## Tasks

1. Trace the production failure and reproduce readiness rejection. Complete.
2. Implement immutable publication and stage/smoke/promote ordering. Complete.
3. Verify cold/warm readiness, exact-owner routing, candidate failure and drain. Complete.
4. Update deployment contracts, run typecheck and required candidate review. Complete.
5. PR #3030 contains the implementation. Final review passed; exact-head CI,
   merge, protected deployment and live verification continue as the release handoff.

## Verification

Focused Node tests cover both images before/after promotion, retained cleanup
authority, stage configuration, delayed/failed readiness and receipt parsing.
Run the existing runner, standby, deployment and artifact regressions, native
Wrangler bundle/config proof, typecheck, complexity guard and exact-head CI.
Production rollout timing remains a hosted verification boundary; local tests
model the provider ordering and exercise the real application owners.

Local verification: 816 Cloudflare tests and nine changelog rendering tests passed.
Cloudflare and Web typechecks, native Wrangler immutable-image dry run and the
complexity guard passed. Zero-target/off inventory still proves the actual
candidate namespace through the existing prepare/retire lifecycle.

## Final review and release handoff

Round one passed at `5f37eb6137c07228d9c0b8c52c9cac08c8c387c5` with no
qualifying findings and no accepted issues remaining. The Phlebas lane selected
`gpt-6-pro`; captured model metadata and the response hash agree. One complete
repository snapshot was attached, and the exact committed turn was captured
after more than seven minutes. The review identified all 35 changed files and
examined staging, promotion, drain, routing, retention and receipt owners. This
is static review evidence; local tests and protected hosted checks own execution.

Only this explanatory plan closure follows the reviewed implementation. PR
#3030 tracks remaining CI and release evidence. No production deployment is
claimed by this implementation record.
Completed: 2026-09-07
