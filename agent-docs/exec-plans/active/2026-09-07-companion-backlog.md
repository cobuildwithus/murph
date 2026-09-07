# Preserve device-sync progress when follow-up jobs fill retention capacity

Status: active
Created: 2026-09-07

## Outcome and invariant

Restore bounded background health ingestion. Completed payloads acknowledge only
after checkpoint; unfinished work keeps its existing Web payload or exact runtime
continuation owner. Preserve foreground priority, retries, consent and the current
100-job mailbox limit.

## Evidence and scope

The recovery owner throws when worker-created children expand a full admitted
page beyond the retained-hint limit. Reproduce with synthetic provider fanout and
cold reconstruction. Open PR path review found no existing implementation of this
correction; the related callback-wake change affects a different boundary.

## Approach

Use Web-owned, never-started dirty payloads as the existing recovery source when
continuation capacity fills. Preserve every worker-created or attempted job in
the retained wake. Bound inspection by the hint limit plus the admitted payload
page; fail closed if non-reconstructible work alone exceeds capacity. No schema,
new queue, provider API assumption, or production mutation.

## Product UX

Outcome: Pending companion uploads recover as accepted health work drains.
Reaches: Busy connected-health members, including cold runtime restarts.
Proof: Real local queue fanout, checkpoint acknowledgement selection and cold
reconstruction; existing retry and payload-ownership regressions.

## Verification and completion

- Reproduce overflow before the fix, then prove complete cold-restart drainage.
- Prove attempted/running jobs remain retained and unsupported overflow fails.
- Run focused runtime tests, package typecheck, complexity and docs checks.
- Parent review, scoped commit, and report deployment separately from local proof.

## Results

The fanout regression failed on the previous implementation at wake recovery,
then passed with all 100 payloads and 25 child jobs completed across cold restores.
The three focused runtime suites pass (328 tests); package typecheck passes.
Overflow boundary tests preserve running, attempted, future and unowned jobs.
Complexity passes with changed-file debt reduced by one.
