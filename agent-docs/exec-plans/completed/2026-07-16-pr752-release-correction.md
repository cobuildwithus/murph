# PR 752 release correction and scope reduction

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Make PR 752 release-ready after its immutable first-head review by removing
  the unrelated Clinical Records coverage slice, fixing the two proven CI
  bundle-boundary failures, and preserving WHOOP reconciliation when the new
  sleep-session identity field enriches legacy records.

## Success criteria

- Clinical Records coverage source, tests, and docs match `origin/main`, while
  all sleep-loop behavior remains intact.
- The experiment browse projection preserves runnable-status semantics without
  importing the filesystem-backed Health Commons runtime.
- A same-version WHOOP sleep record may add only the previously absent
  `sleepType`; main sleep, naps, mixed-resource batches, and exact replays are
  preserved, while every other semantic conflict remains atomic.
- The hosted runner bundle and cold web production build pass their real gates.
- ReviewGPT returns `ROUND_OUTCOME: PASS`, PR CI is green, and the PR remains
  open for review.

## Scope

- In scope: the Clinical Records coverage-only files and shared references;
  the web experiment-browse import boundary and focused regression test; the
  narrow WHOOP legacy sleep-type reconciliation exception and regression tests;
  the PR retrospective, verification, review loop, and release handoff.
- Out of scope: new sleep capabilities, new Clinical Records behavior, new
  package entrypoints, migrations, queues, broad compatibility frameworks, or
  state owners.

## Risks and mitigations

1. Risk: scope reduction accidentally removes shared sleep-context behavior.
   Mitigation: restore coverage-only files exactly and audit shared-file hunks.
2. Risk: the local public-protocol predicate drifts from the canonical rule.
   Mitigation: preserve the exact draft/deprecated rule and keep a route-bundle
   boundary regression.
3. Risk: a static dependency still enters the hosted boot closure.
   Mitigation: run the exact hosted runner bundle and byte-budget gate.
4. Risk: the legacy WHOOP exception weakens source-revision conflict detection.
   Mitigation: require the same WHOOP sleep identity and version, an absent
   stored `sleepType`, a valid incoming value, and byte-equivalent remaining
   content; retain the existing atomic-conflict regression for every other
   same-version change.

## Tasks

1. Persist the large-change retrospective against the immutable first head.
2. Remove the Clinical Records coverage slice and its shared references.
3. Remove the web layout's filesystem-runtime dependency with the smallest
   equivalent local predicate and a focused boundary test.
4. Add the narrow WHOOP legacy sleep-type enrichment path and prove mixed-batch
   commit, replay idempotency, and unchanged conflict behavior.
5. Run changed-surface verification, exact release gates, privacy/diff checks,
   ReviewGPT correction rounds, and PR CI.
6. Archive this plan and create the scoped correction commit.

## Verification

- `pnpm test:diff -- <correction paths>`
- exact hosted-local runner bundle assembly and byte-budget check
- cold hosted-web production build, web tests, and Cloudflare tests
- docs drift, scenario integrity, Health Commons generation check, diff/privacy
  scans, ReviewGPT, CI, and clean-base proof
Completed: 2026-07-16
