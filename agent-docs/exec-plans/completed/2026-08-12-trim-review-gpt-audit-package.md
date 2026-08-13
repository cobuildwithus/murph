# Trim ReviewGPT audit packages

Status: completed
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Reduce ReviewGPT audit attachment size without weakening the full-review test,
  documentation, CI, or changed-file context needed for useful reviews.

## Success criteria

- Full audit packages exclude Web audio binaries.
- Full audit packages exclude the Health Commons source corpus unless the PR
  changes Health Commons.
- Full audit packages continue to include tests and the rest of Health Commons.
- Focused CLI coverage, shell syntax checks, direct ZIP-content proof, exact-head
  CI, and the required preliminary ReviewGPT specialist pass are green.

## Scope

- In scope: Murph's ReviewGPT audit-package configuration, PR-aware packaging
  behavior, focused regression coverage, and package-size evidence.
- Out of scope: the separately owned `@cobuild/review-gpt` Repomix dependency
  graph and any member-facing product behavior.

## Constraints

- Technical constraints: preserve changed Health Commons review context, full
  test coverage, sensitive-path exclusions, and later-round delta packaging.
- Product/process constraints: use the isolated worktree/PR lane, preserve
  private-data boundaries, and record the internal-only changelog decision in
  the PR body.

## Risks and mitigations

1. Risk: excluding the source corpus could hide relevant evidence from a Health
   Commons review.
   Mitigation: derive relevance from a no-renames PR diff so both sides of a
   rename remain visible, and keep the corpus whenever either side touches
   Health Commons.
2. Risk: broad binary exclusions could hide reviewable source assets.
   Mitigation: exclude only the known Web audio subtree and verify ordinary
   Health Commons source and test files remain packaged.

## Tasks

1. Add the narrow audio exclusion and PR-aware Health Commons source exclusion.
2. Extend the existing package-audit test owner with direct regression proof.
3. Run focused tests, syntax checks, and before/after package measurements.
4. Commit and push the candidate, open the PR, run specialist review and CI,
   resolve findings, and close this plan through `scripts/finish-task`.

## Decisions

- Keep tests in every full audit; they are review evidence, not package excess.
- Do not patch or override Repomix in Murph. Its dependency ownership belongs in
  the separate ReviewGPT package repository.
- Treat the changelog as not applicable because this changes internal review
  tooling only and cannot affect members.

## Verification

- Commands to run: focused `release-script-coverage-audit` Vitest, `bash -n` for
  changed shell scripts, `git diff --check`, and direct ZIP inventory/size
  measurements, followed by exact-head required GitHub checks.
- Expected outcomes: the configured audio and unrelated Health Commons corpus
  paths are absent, Health Commons PRs retain the corpus, tests remain present,
  and all required checks pass.
- Local results:
  - Focused CLI packaging suite: 43 passed, 1 skipped.
  - CLI typecheck: passed.
  - Repo-tool helper suite: 527 passed.
  - Same-head package proof: 60,270,658 bytes and 18,930 entries before;
    36,222,640 bytes and 11,337 entries after, a 39.9% byte reduction.
  - ZIP inventory confirmed Web audio and the unrelated Health Commons source
    corpus are absent while Health Commons runtime code and tests remain.
  - Preliminary ReviewGPT requested one correction: rename-out changes could be
    represented by only their destination in the changed-file manifest. The
    predicate now uses a no-renames diff, falls back to retaining the corpus when
    local history is incomplete, and has real-ZIP proof that an unchanged corpus
    sibling remains present after a Health Commons file is renamed elsewhere.
Completed: 2026-08-12
