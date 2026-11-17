# Earn Health and Friends medals from Progress

Status: active
Created: 2026-11-17
Updated: 2026-11-17

## Outcome and scope

Outcome: Prizes discovers eligible Health and Friends medals without first opening their pages.
Reaches: complete main Progress reads; authorized health with a saved replica; current co-players with complete classified exercise history.
Proof: route contracts execute the post-response callback, read medals back on the next request, and cover denial, missing input, incomplete cohorts and failures.

Server only. Preserve the wire, award rules, baseline coverage and earned dates.
No app change, merge or ReviewGPT; the integrator owns external review.

## Cause and design

Health writes currently live only inside its page reader. Friends writes live
only inside its page reader for the selected exercise. Prizes links those pages
through medals, so first awards are unreachable.

Share Health's baseline/journey/award write function and Friends' exercise
selection and guarded award commit. The authenticated GET boundary schedules
one after-response batch after a complete main read. Run Health and Friends
sequentially with independent failure handling and one constant error code.
Keep session/health checks and pair locks plus commit-time audience checks.

A sealed completion receipt on the existing restingHeartRate measure records
the replica publication timestamp, evaluation instant and both time zones.
Only a successful entire health batch writes it. An unchanged publication and
unchanged member/vault date and settled-step date skip Cloudflare input loading.
Baseline mutation timestamps cannot prove a completed batch; no table or column
is needed. Concurrent reads may duplicate work; existing CAS/unique guards stay
in charge. Failures leave the input eligible on the next ordinary read.

## Plan deviations

The requested background settlement extends the locked plan's page-only timing
and logged background failure handling. The sealed receipt extends existing
measure JSON to bound cost for Prizes (row 1). No new endpoint, table, registry,
flag, column or preference. Scheduling belongs at the authenticated GET boundary
so the internal game-only reader and measure mutation responses retain their
existing contract.

## Verification

- Focused route, health, friends, state and award tests, including next-read proof.
- Affected Web typecheck and diff-scoped selector, with exit codes.
- Complexity, privacy/diff review, owner docs and changelog.
- Commit, draft PR, exact-head required CI, Ready; no merge or ReviewGPT.
