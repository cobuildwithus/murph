# Reuse same-request fresh slot binding proof

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Goal

Remove the redundant immutable-binding RPC after fresh allocation has already verified the exact claim, member, slot, region and release. Build on PR #2999; prepare the additional improvement as a separately reviewed PR.

## Product UX

Effort: Patch. Outcome: Less setup after a fresh slot is assigned.
Reaches: Successful fresh binds and exact same-request bind recovery. Retained and direct preparation still fetch current binding evidence.
Proof: Actual controller/service call counts and delayed-I/O benchmark; member, claim, release, region, retirement and stale-fence rejection coverage.

## Invariants

The receipt stays in the allocating request and is not persisted, cached or sent to a container. Fenced preparation validates the receipt using the existing identity predicate. Controller fence revalidation and the container's live bound-member authorization remain mandatory. A retired slot can never rebind.

## Tasks

1. Prove the duplicate call and trace live launch authorization.
2. Thread the verified receipt through existing fresh preparation; keep ordinary lookup fallback.
3. Add focused failure and race coverage, benchmark, typecheck and complexity checks.
4. Publish release note and stacked PR; resolve ReviewGPT and required CI; verify mergeability.

## Evidence

The existing container `authorizeBoundUser` reads its durable slot state at the runtime boundary; no caller receipt substitutes for that check.

## Local verification

- Final identity, fleet, standby and runtime-callback suites: 186 tests passed, including exact bind-response recovery.
- Cloudflare build and typecheck passed; complexity is unchanged against PR #2999 (invocation debt 7, maximum 24; controller debt 5, maximum 25).
- Paired actual-controller benchmark: balanced reads 428.22 ms base / 428.73 ms candidate (no meaningful wall-time change); slow binding read 489.09 ms / 386.90 ms (102.19 ms saved). Both eliminate one immutable-binding RPC. The base fails the zero-extra-read assertion; the candidate passes. These are synthetic I/O timings, not production estimates.
- Direct and retained starts keep the lookup fallback. Invalid member, claim, region, release, slot and retired receipts are rejected using the existing binding checks.
- Remaining larger opportunities investigated: restore already streams authenticated decryption and native extraction; ingress crypto caching is security-scoped; startup archive recovery protects representation consistency. No unrelated cache or weaker validation was added to chase unmeasured gains.

## PR preparation

- Draft PR #3006 is stacked on #2999. The base PR changes are reconciled by an ordinary merge.
- All 177 runner-alarm tests pass. The consent-withdrawal budget test now exercises the retained target, which still requires the binding read; timeout, fence clearing and exact retirement assertions are preserved.
- Nine changelog rendering tests and Web typecheck pass; Cloudflare typecheck passes after the fixture update.
- The first docs-drift invocation considered only the uncommitted fixture and attribution; updating this plan supplies the matching explanation for that change. ReviewGPT and final CI remain pending.

## Completion evidence

- ReviewGPT round 1: PASS at `7a8bdd385bfbb3ee1a9aa649689722dda9557652`, no qualifying findings. Full snapshot and all seven changed file identities matched. Exact-turn capture and backend model evidence verify `gpt-6-pro` and response hash `054dc49fce76d9e5f51034d8c38e34355e8e005975c811db909b099e35a49084`. The response arrived more than five minutes after send, exceeding the 270-second minimum. Raw artifacts stay ignored.
- Parent final review confirms the receipt remains request-local, exact validation and live authorization remain mandatory, fallback reads are preserved, and the diff contains no personal identifiers or generated files.
- This final commit only archives this explanatory plan. The reviewed source and tests are unchanged. Required CI will be verified on the resulting PR head; no merge or deployment is included in this task.
Completed: 2026-09-06
