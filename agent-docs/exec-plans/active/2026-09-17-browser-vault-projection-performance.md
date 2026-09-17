# Reduce Browser Vault projection work

Status: active
Created: 2026-09-17
Updated: 2026-09-17

## Goal

- Make larger Browser Vault refreshes complete with less CPU work while preserving identical query results, source consistency, and foreground cancellation.

## Success criteria

- Isolate the bottleneck with a local profile; reproduce its algorithmic cause using synthetic data.
- Demonstrate lower work and equivalent output through the affected production owner, including cancellation where changed.
- Pass focused tests, typecheck, candidate review, and the applicable completion gates.

## Scope

- In scope: source/projection/build profiling, the smallest proven optimization, synthetic regression tests, and aggregate before/after evidence.
- Out of scope: new timeout increases, weakened source hashes, canonical data changes, new state or scheduler owners.

## Constraints

- Technical constraints: use existing query and runtime owners and declared package entrypoints; preserve parsing, ordering, generation, encryption, and foreground priority.
- Product/process constraints: local supplied data stays outside the repository, fixtures, logs, external reviews and remote executors. Only synthetic reproduction data may be committed.

## Risks and mitigations

1. Optimization changes derived results or ordering.
   Mitigation: compare complete output on local input without retaining its contents, plus synthetic edge cases and the existing owner suites.
2. Faster average behavior hides an uninterruptible operation.
   Mitigation: measure cancellation separately if the changed owner performs synchronous loops.

## Tasks

1. Profile the existing source reader and replica builder locally; record only aggregate timings and code locations.
2. Identify a faithful synthetic regression, implement the smallest correction, and rerun the same probe.
3. Run focused correctness/cancellation tests and typechecks; inspect privacy, complexity and Product UX.
4. Prepare the scoped commit and required review/CI evidence; close this plan when complete.

## Decisions

- Outcome: recent canonical records reach dashboards within the existing bounded refresh.
- Reaches: established histories and sparse/empty histories; foreground work remains higher priority.
- Proof: actual query/build path, output equivalence, synthetic algorithmic regression, and cancellation where affected.

## Verification

- Commands to run: selected query/runtime Vitest files, affected package typecheck, complexity and docs guards; refine selection after the profile identifies the owner.
- Expected outcomes: preserved results, reduced repeated work, bounded cancellation, and no private data in tracked files or review context.

## Findings and implementation

- The sleep repair owner associated every metric with every Apple sleep window before checking whether repair was possible. Positive asleep values and unrelated metrics cannot affect its result, but incurred provider and timestamp normalization repeatedly.
- Prefilter repair evidence to zero-valued supported asleep metrics and positive awake duration; return immediately when no zero total exists. Candidate ordering, association, ownership and suppression rules remain unchanged.
- Synthetic regression proof: no-zero-total input performs zero association checks; padding a valid repair case with 500 positive metrics keeps association checks at two instead of increasing to 502. Both assertions fail before the patch.
- Local complete-replica comparison passes with identical serialized output; private input and profiling material remain outside this checkout and external review context.

## Verification progress

- Query: seven focused files, 60 tests PASS, including repair scoping/fallback, wearable candidates, suppression, and Browser Vault projection behavior.
- Query typecheck PASS; final formatting-only test cleanup will receive a final focused rerun.
- Complexity PASS: unchanged debt 11, maximum 30. Existing unrelated collection and sample-conversion hotspots remain unchanged.
- Product UX walkthrough: Ready. Normal/sparse histories retain results; dense unrelated metrics no longer multiply repair work. Runtime deadlines and foreground cancellation owners are unchanged.
