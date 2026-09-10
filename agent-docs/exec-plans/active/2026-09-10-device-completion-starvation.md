# Prevent device completion starvation after checkpoint

Status: active
Created: 2026-09-10
Updated: 2026-09-10

## Outcome and invariant

Complete accepted device work after its successful checkpoint without repeated background wakes postponing the completion record. Preserve real foreground input priority, exact mailbox ownership, checkpoint fencing, projection requirements, and retry durability.

## Owner and evidence

The runtime owns pending and ready checkpoint callbacks. System-mailbox records own unfinished device work; Web owns committed handling progress. The reproduced gap is an empty notification preempting the post-checkpoint projection offer. Its foreground pass selects a fresh system wake and dirties the runtime before ready completion callbacks drain. Both a callback regression and the real concurrent device-import integration fail at a bounded checkpoint-count assertion on the base. Reuse the existing complete-lane high-water proof to consume empty notifications while preserving local work and foreground preemption.

## Scope and approach

Reproduce through the existing runtime entrypoint and synthetic device ports. Prefer correcting wake derivation or ordering existing work over another queue, timer, flag, or persisted owner. Keep production data and identifiers out of fixtures and review artifacts. No production recovery, merge, or deployment is included in this PR task.

## Product UX

Outcome: Completed wearable imports finish their acknowledgement promptly.
Reaches: Background-only imports, imports alongside conversations, and checkpoint/retry recovery.
Proof: Synthetic completion and canonical mailbox readback, foreground delivery ordering, failed checkpoint suppression, and focused runtime tests. Model instructions and reply meaning are unchanged; deterministic scheduling proof owns this patch.

## Tasks

1. Reproduce the callback starvation and isolate its causal branch.
2. Apply the smallest correction and prove completion, foreground priority, and failure recovery.
3. Run relevant tests, typecheck, complexity and documentation checks; review the complete diff.
4. Add the member-facing changelog, commit, open a draft PR, and mark the proven candidate Ready.
5. Run required ReviewGPT concurrently with exact-head CI; resolve supported findings and failures, close this plan, and leave a green PR.

## Verification

Local reproduction established in two tests before the fix. The callback regression passes after the fix; isolated device and adjacent priority verification are in progress. CI and ReviewGPT remain required. The public/private runtime protocol and durable data format must remain compatible without migration.
