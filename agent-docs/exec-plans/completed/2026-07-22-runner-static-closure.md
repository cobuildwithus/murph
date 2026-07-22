Goal (incl. success criteria):
- Reduce the Cloudflare runner entrypoint bundle by removing proven dead or unnecessarily eager runtime imports.
- Success means the packed runner no longer includes unused contract examples or query modules in its static boot closure, bundle budgets are re-tightened to measured values instead of raised, and canonical verification plus the PR ReviewGPT loop finish with no accepted findings.

Constraints/Assumptions:
- Preserve all hosted runtime behavior and product-critical flows; this is an import/ownership correction, not a feature deletion.
- Preserve the existing public package entrypoints; avoid compatibility churn or new runtime boundaries when correct package purity metadata gives the bundler enough information.
- Do not overlap the active runner dependency-prune lane's install/lockfile ownership unless evidence makes that necessary.
- The PR lane uses ReviewGPT as its sole cross-cutting review gate; coverage proof still runs locally.

Key decisions:
- Prove each proposed boundary with an esbuild metafile measurement before retaining it.
- Keep the contracts public API stable. A package-wide module-evaluation audit found no externally observable import-time effects in contracts or query, so declare both packages side-effect-free and let existing consumers tree-shake unused exports.
- Do not add a dynamic query/browser boundary: the runner needs that work during foreground execution, so deferring it would shift cost into the first request without reducing the deployed graph.

State:
- Local implementation and verification complete; ready to commit and open the PR.

Done:
- Confirmed latest production total is within 16,246 bytes of the current ceiling.
- Confirmed broad package roots retain unrelated modules and contract examples in the static closure.
- Created an isolated worktree and branch from the latest `origin/main`.
- Audited all contracts and query modules for side-effect-only imports and externally observable top-level effects; neither package relies on import-time registration or mutation.
- Declared both packages side-effect-free without changing their public entrypoints or runtime call paths.
- Rebuilt the packaged runner: total fell from 9,457,558B to 9,374,751B, static boot closure fell from 7,817,555B to 7,633,674B, and the entry chunk remained 1,588,744B.
- Removed the 250KB operational allowance from the boot caps, ratcheted the baselines, retained 32KB of total-growth room, and added an explicit guard against contract examples re-entering the static closure.
- Passed package typechecks/tests, the focused runner budget test, and the production bundle assembly/parity probes.
- Coverage-write found one narrow proof gap and added exact-boundary acceptance plus one-byte-over rejection for the total bundle cap; the focused runner suite passes 32/32 tests.
- Final canonical `pnpm test:diff` passed across all affected packages, reverse dependents, hosted web verification, and Cloudflare verification.
- Scenario-manifest integrity passed for 204 scenarios, 11 sample inputs, and 28 golden-output directories.

Now:
- Close this plan through the scoped commit helper, push the branch, and open the PR.

Next:
- Commit, push, open the PR, start ReviewGPT alongside CI, and resolve both to completion.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/contracts/package.json`
- `packages/query/package.json`
- `apps/cloudflare/scripts/runner-bundle/bundle-entrypoint.ts`
- `apps/cloudflare/test/runner-bundle-entrypoint-bundle.test.ts`
- `pnpm --dir apps/cloudflare runner:bundle:assemble-only`
- `pnpm test:diff <touched paths>`
Status: completed
Updated: 2026-07-22
Completed: 2026-07-22
