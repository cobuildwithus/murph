# Adopt repo-tools 0.1.16 and close committer integration gaps

Status: completed
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Adopt the green public `@cobuild/repo-tools` 0.1.16 release and close Murph
  issues #1666 and #1753 inside the existing coherent worktree-tooling batch.

## Success criteria

- The manifest and lockfile resolve public-registry 0.1.16 without a sibling,
  file, link, alias, or patch source.
- Every live Murph `scripts/committer` invocation uses the canonical positional
  message followed by exact paths; no `-m` compatibility is added.
- A real wrapper/package integration test proves an active non-fast-forward
  merge is rejected without changing HEAD, the index, resolved content, or
  `MERGE_HEAD`.
- Existing worktree create/install proofs, dependency guards, focused repo-tool
  verification, relevant typecheck/docs checks, diff review, and privacy scan
  pass or have a concrete unrelated blocker.

## Scope

- In scope: root dependency metadata, the obsolete 0.1.15 patch, actual Murph
  committer integration calls, and focused installed-wrapper regression proof.
- Out of scope: a Murph-owned committer implementation, `-m` compatibility,
  edits to historical Frog evidence, sibling package sources, commits, pushes,
  or pull requests.

## Constraints

- Technical constraints: consume only public-registry 0.1.16 and exercise the
  installed binary through Murph's wrapper.
- Product/process constraints: preserve all unrelated checkout state and the
  existing uncommitted #1660/#1741 remediation.

## Risks and mitigations

1. Risk: a wrapper-level mock could falsely prove upstream behavior.
   Mitigation: point the copied Murph configuration at the exact installed
   package binary and assert Git state before and after invocation.
2. Risk: the dependency refresh could hide a local patch or sibling source.
   Mitigation: remove the version-specific patch and run the dependency guard
   plus manifest/lockfile source assertions.
3. Risk: the newly published release is younger than the repository's default
   maturity window.
   Mitigation: use one exact-version `minimumReleaseAgeExclude` entry backed by
   the explicitly authorized green upstream release; retain every other supply
   chain control.

## Tasks

1. [x] Update the public dependency and regenerate the frozen lockfile.
2. [x] Correct the three live `-m` test invocations.
3. [x] Add the active non-fast-forward merge integration regression.
4. [x] Re-run the combined worktree, repo-tools, dependency, type/docs, diff,
   and privacy proof.

## Decisions

- Reuse the existing worktree-storage integration harness; add no production
  wrapper or compatibility layer in Murph.

## Verification

- `pnpm install --frozen-lockfile --ignore-scripts && pnpm deps:guard` passed.
- `pnpm deps:ignored-builds` passed; repo-tools is not in the ignored list.
- `pnpm deps:audit` reported the existing broad workspace backlog of 77
  vulnerabilities. Published repo-tools 0.1.16 has no runtime dependencies and
  introduces no audit path.
- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage
  scripts/worktree-storage-guard.test.ts` passed 41/41, including the real
  installed-wrapper merge regression.
- The focused Frog recovery selection passed 2/2.
- Tools TypeScript, shell syntax, docs drift, docs gardening, dependency source
  assertions, `git diff --check`, and the task privacy scan passed.
Completed: 2026-08-13
