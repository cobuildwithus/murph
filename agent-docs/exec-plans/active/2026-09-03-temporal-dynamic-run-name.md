# Accept Dynamic Private Temporal Run Names

Status: active
Created: 2026-09-03
Updated: 2026-09-03

## Goal

- Restore public Temporal compatibility admission after the private integration
  workflow adopted a dynamic GitHub Actions run name, without weakening the
  existing exact run id, workflow id/path, repository, branch, SHA, event, and
  first-attempt identity checks.

## Success criteria

- `inspectPrivateRun` accepts the legacy workflow name and the dynamic
  `Public Murph Integration / ...` run-name family.
- An unrelated or merely similar workflow name remains rejected.
- Focused controller tests and the scoped repository verification lane pass.
- The exact pushed PR head receives required CI and final ReviewGPT review.

## Scope

- In scope: the public compatibility controller, its focused regression test,
  and PR evidence for the independently observed Vercel deployment-check gap.
- Out of scope: modifying the private workflow, changing Vercel project
  configuration, manually promoting or rolling back a deployment, or changing
  Temporal reader admission semantics.

## Risks and mitigations

1. Risk: accepting arbitrary runs after relaxing the display-name check.
   Mitigation: retain the exact dispatch-returned run id, workflow id and path,
   private repository, main SHA, event, branch, and first-attempt checks; accept
   only the canonical legacy name or its slash-delimited dynamic prefix.
2. Risk: a focused unit test misses cancellation-path behavior.
   Mitigation: keep both polling and cancellation on the same
   `inspectPrivateRun` owner and run the complete focused controller test file.
3. Risk: presenting the public script fix as repairing Vercel promotion.
   Mitigation: report the observed non-blocking production promotion as a
   separate configuration gap and do not claim it is fixed by this PR.

## Tasks

1. Add the narrow dynamic-name compatibility condition and regression cases.
2. Run focused controller proof, scoped verification, complexity, and final
   privacy/diff review.
3. Commit and push the candidate, open a draft PR with complete deployment
   evidence, mark it ready, and start ReviewGPT concurrently with CI.
4. Resolve required review/CI gates and prove current-base mergeability.

## Decisions

- Treat GitHub's run `name` as a presentation field beneath the stronger exact
  workflow/run/path/repository/SHA identity checks.
- Preserve legacy exact-name acceptance for runs created before the private
  workflow's dynamic `run-name` change.
- Keep the production-domain promotion gap outside this code diff because it is
  owned by Vercel project configuration and requires separate live correction
  and proof.

## Verification

- Passed: `node --check scripts/hosted-orchestration-compatibility.mjs` and
  `node --test scripts/hosted-orchestration-compatibility.test.mjs` (40 tests).
- Passed: live read-only `inspectPrivateRun` validation against an actual
  post-change private workflow run with the dynamic title.
- Passed: `pnpm test:diff scripts/hosted-orchestration-compatibility.mjs scripts/hosted-orchestration-compatibility.test.mjs`
  (53 files and 726 repo-tool tests plus the scoped guards).
- Passed: `pnpm complexity:diff` with no current hotspot above 20 and no
  complexity-debt increase.
- Pending: exact-head CI, final ReviewGPT, and current-base merge-tree proof.
