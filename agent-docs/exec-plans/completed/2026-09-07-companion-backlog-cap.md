# Raise companion backlog admission to 500 payloads

Status: completed
Created: 2026-09-07

## Outcome and scope

Raise the companion pending-payload admission cap from 16 to 500 while retaining
the queue-drain fix in PR #3020. Web owns the buffer; runtime keeps its existing
100-job pass and bounded hydration. No schema or new state owner.

## Evidence and invariants

Boundary regressions at 17 and 500 fail under the prior cap. Preserve insertion
rollback at 501 and exact replay at 500. Request body, consent, source admission,
encryption and coalesced wake rules remain unchanged. The existing 500-payload
hydration page already supports the larger buffer, subject to its byte budget.

## Product UX

Outcome: Companion uploads have room while background work catches up.
Reaches: Connected-health members with a pending upload queue.
Proof: Admission boundary tests plus the existing runtime fanout and cold-restart
drain proof; combined Web/runtime checks and external review.

## Completion

Run focused Web wake tests and typecheck, complexity and docs validation. Update
PR evidence and release note, commit, and re-establish exact-head CI and review.
Deploy the drainage fix before or alongside the larger buffer; the larger cap
alone does not correct an old runtime's failed retention.

## Results

Both new acceptance cases reproduced the old 429. With the cap raised, all
201 Web wake tests pass, including rejection at 501 and exact replay at 500.
Web typecheck, complexity and docs drift pass. The existing runtime drain fix
and its 328 passing tests remain unchanged. External review and exact-head CI
will cover the combined pushed candidate.
Updated: 2026-09-07
Completed: 2026-09-07
