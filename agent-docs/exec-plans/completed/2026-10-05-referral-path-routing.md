# Reject malformed referral paths before generated page loading

Status: completed
Created: 2026-10-05
Updated: 2026-10-05

## Goal

Unsupported encoded referral paths return an honest not-found result before
generated page loading, while supported referral and unrelated routes retain
their existing behavior.

## Success criteria

- Prove the malformed-path failure and the exact pre-handler boundary.
- Use ReviewGPT to author the smallest justified routing correction.
- Verify the real Next matcher, proxy response, supported-route controls, and
  production-mode routing; pass focused checks, final review, and required CI.
- Leave the functional PR ready for human merge; do not claim deployed recovery.

## Scope

- In scope: the existing early Web proxy and its focused routing proof.
- Out of scope: provider internals, global URL normalization, delivery callbacks,
  retry/deadline changes, dependency upgrades, production writes, and device sync.

## Constraints

- Reuse the existing proxy, narrow matching to the proven invalid path family,
  and preserve homepage content negotiation and workflow-token validation.
- No new state, network calls, logging, broad middleware, or successful fallback.
- Welcome receipt correction has an active independent owner. Checkpoint
  generation correction is already present in main through PR #3998.

## Risks and mitigations

1. A malformed-path guard could affect valid URLs or fail to run before routing.
   Mitigation: test the actual framework matcher, encoded query controls, and a
   production-built fixture containing the unchanged production proxy source.
2. Local Next already rejects these paths, so a local 404 alone cannot prove
   hosted recovery. Preserve the pre-handler production reproduction and require
   read-only outcome verification after a separately authorized deployment.

## Tasks

1. Trace and reproduce the routing boundary; inspect current owners.
2. Review the external author's patch and prove behavior before/after.
3. Run focused checks, make the release-note decision, and open a scoped PR.
4. Complete final ReviewGPT and exact-head CI; leave merge to the user.

## Decisions

- Product UX effort: Patch. Outcome: invalid referral links fail predictably.
  Reaches: malformed encoded referral suffixes only. Proof: actual matcher and
  HTTP response with supported referral, query, homepage, and webhook controls.
- Production evidence is retained only in the private automation handoff.

## Verification

- Current bounded read-only probes: valid referral 200; ordinary missing route,
  unrelated encoded path, and double encoding 404; encoded slash/backslash 500.
- Generated launcher requires a nonexistent page module before application code.
- ReviewGPT authored the exact four-file patch; its checksum was verified after
  recovering the identical patch as text through the known artifact-capture gap.
- New focused tests against the original proxy: 10 failures and 42 controls pass.
  Corrected proxy: all 52 pass. Changelog rendering: all 10 pass.
- Isolated production build: 23 HTTP checks pass; original source fails the
  fixed-body assertion because ordinary page routing handles the request.
- Web typecheck, focused ESLint, whitespace, docs drift/gardening, and complexity
  pass. Proxy complexity 7 to 8; no source hotspot above 20.
- Parent candidate review: Product UX Ready; no new I/O, state, URL rewriting,
  logging, dependencies, or API invocation on supported paths.
- Final ReviewGPT round 1 passes on `2a96e8810ad77f7c7082042b15a31fcbdc730185`
  with no findings. Required exact-head CI remains pending; functional merge and
  deployment remain with the user.
- One broad CI run failed the package-verifier interlock test. Its isolated
  rerun passes; an independently reproduced status/liveness race is being fixed
  in a separate tooling task. The CI trace does not prove that exact interleaving.
  Final plan closure changes no runtime code; final-head CI remains required.
Completed: 2026-10-05
