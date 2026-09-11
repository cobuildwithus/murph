# Prevent device completion starvation after checkpoint

Status: completed
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

- Corrected real device-import fixture: the same synthetic scenario fails against base `b80bd40f84d1` at its fourth idle snapshot with no acknowledgment, and passes with the patch. The base source was restored only for the negative check and the patched source was restored afterward.
- Callback regression: caught-up empty wakes complete without another assistant pass; incomplete and unknown high-water evidence preserve foreground service. All three pass.
- Adjacent focused cases pass: interrupted acknowledgment, durable effects after successful checkpoint, repeated device wakes, incomplete prefix, failed classification, shutdown during projection, and foreground delivery during an owned projection. The original checkpoint-wakes suite also passed.
- Assistant-runtime and Web typechecks pass. Changelog generation and all 10 focused archive tests pass.
- Complexity guard passes with unchanged debt 547 and maximum 252. Existing owner hotspots were reviewed; no new state owner or protocol is needed.
- Parent review confirms synthetic fixtures, no private evidence in artifacts, and preserved checkpoint/acknowledgment order. The two-reply test setup allowance increased to 20 seconds after reproduced shared-host timeouts; its independent two-second delivery bound remains unchanged. The Frog record is included.

Implementation and local verification are complete. PR #3196 owns the remaining exact-head CI and required ReviewGPT gates; these are pending at candidate closure and must pass before the PR task is reported complete. Merge and deployment remain outside scope.
Completed: 2026-09-10
