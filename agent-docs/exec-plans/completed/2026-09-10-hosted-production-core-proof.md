# Require composed hosted production proof

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Require existing real hosted runtime journeys before an exact protected-main
Web candidate receives production admission. Keep public pull-request
compatibility fixture-only, with private source and credentials isolated.

## Success criteria

- Production admission requests additive production_core scope without fallback.
- The exact private run proves Linq delivery, scheduled reminders, hosted browser
  rendering, and both foreground process shards.
- Each lane binds the same public/private revisions, scope, and expected Temporal
  target as the final release attestation.
- Missing, skipped, duplicate, failed, malformed, or mismatched evidence rejects.
- Existing foreground and fixture-only scopes retain their existing semantics.
- Focused tests, applicable typecheck, exact-head CI and ReviewGPT pass.

## Scope

Public controller, receipt validation, tests and owner docs. Paired private work
adds the scope using the existing canonical scenario manifest. Other task lanes
own database PR proof, real-model journeys, provider doubles, auth and canaries.

## Constraints

Preserve private-source and credential isolation for public PRs. Reuse the build,
scenarios, release digest and accepted-run validator. Ship private support before
the public scope switch. This PR changes no live deployment or branch settings.

## Risks and mitigations

1. Aggregate success can hide skipped scenarios: require every exact named lane.
2. Mixed versions can reject admission: retain legacy scopes privately and document
   the private-first prerequisite; never silently fall back.
3. Runtime can exceed the bounded controller: select only named scenarios,
   excluding other scenarios grouped in the same full-integration lane.

## Tasks

1. Add production scope and independently verified per-lane receipts.
2. Test success, omissions, skips, failures, malformed evidence and scope skew.
3. Update security, verification and orchestration owners.
4. Inspect both public and paired private changes.
5. Verify, commit, open draft PR, and complete CI and ReviewGPT.

## Decisions

Keep wire version 1 because the digest already binds scope. One initiating-session
completion owner coordinates every related PR. Inspect only job metadata;
download no private logs or artifacts.

## Verification

- node --test scripts/hosted-orchestration-compatibility.test.mjs
- node --check scripts/hosted-orchestration-compatibility.mjs
- Applicable tools typecheck, complexity review, private pnpm verify.
- Required exact-head CI and ReviewGPT for both repositories.

## Candidate evidence

- Controller tests: 47 passed, zero skips, including composed dispatch for both
  legacy and production-core release scopes.
- Node syntax and repo-tools TypeScript checks passed.
- Complexity guard passed: maximum 19, no functions above 20.
- Doc gardening and diff whitespace checks passed.
- Paired private selector and workflow source inspected; independent public and
  private digest computations agree for the same synthetic vector.
- Public ReviewGPT round 1 passed on dbaed8c2d665cd7c2c1579284857ef5f5a237498
  with concrete gpt-6-pro evidence and a substantive full-patch review.
- All four required public CI checks passed on that reviewed head.
- Private exact-head verify CI passed; private review completion remains owned by
  the paired PR. Unchanged optional integration failures are tracked separately.
- The final plan-closure commit changes explanatory documentation only; its
  required exact-head CI remains the final handoff gate.
- Public PR: https://github.com/cobuildwithus/murph/pull/3218
- Private prerequisite: https://github.com/cobuildwithus/murph-cloud/pull/129
- No deployment, protected-environment change or live-provider run was performed.
Completed: 2026-09-10
