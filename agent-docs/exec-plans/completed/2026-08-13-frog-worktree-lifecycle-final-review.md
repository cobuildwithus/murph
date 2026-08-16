# Close final worktree lifecycle and docs-drift review findings

Status: completed
Created: 2026-08-13
Updated: 2026-08-14

## Goal

- Close the accepted final-review findings without expanding Murph's worktree
  guard into a general lifecycle service.

## Success criteria

- Murph consumes public-registry `@cobuild/repo-tools` 0.1.17 with no patch,
  sibling, file, or link source and proves the installed long-list docs-drift
  behavior.
- Current hook authority survives interruption of the exact predecessor after
  its include removal, is final after reinstall, preserves unrelated includes,
  and bounds real legacy Git-config contention.
- A target/branch/head-bound shared creation intent exists before worktree add,
  survives partial registration before per-worktree marking, blocks every Frog
  destructive recovery path, and clears only after clean-status proof.
- Combined focused tests, dependency checks, tools typecheck, shell syntax,
  docs checks, diff review, and privacy scan pass.

## Scope

- In scope: the current installer/config authority, narrow creation-intent
  state and Frog gate, exact predecessor and fault-boundary tests, dependency
  metadata, and directly affected durable docs.
- Out of scope: daemons, generalized lifecycle state, destructive cleanup,
  predecessor fixture weakening, arbitrary Git-config rewrites, commits,
  pushes, or pull requests.

## Constraints

- Technical constraints: use native Git lock-file interoperability and atomic
  replacement; preserve all unrelated Git configuration.
- Product/process constraints: retain the existing isolated uncommitted batch
  and do not inspect or retry the shared Murph commit guard.

## Risks and mitigations

1. Risk: a legacy installer can remove or race a current include.
   Mitigation: give current Murph a distinct authority path and publish its
   final include through one bounded Git-compatible config transaction.
2. Risk: partial worktree registration is visible before its admin marker.
   Mitigation: publish strict shared intent before add and make Frog resolve it
   before any reset or clean.
3. Risk: a package-only regression accidentally exercises local source.
   Mitigation: invoke the installed public package binary against a generated
   long-list docs fixture and assert the obsolete patch is absent.

## Tasks

1. Adopt and verify public repo-tools 0.1.17.
2. Implement predecessor-immune, final-precedence hook authority.
3. Implement pre-add bound creation intent and Frog refusal.
4. Add exact interruption, contention, partial-registration, and installed
   package regressions.
5. Update affected docs and run the combined verification matrix.

## Decisions

- Keep both remediation states narrow: one current config authority and one
  create-owned intent directory, with no background owner or cleanup process.

## Verification

- Commands to run: combined storage/committer and Frog focused suites;
  installed docs-drift production proof; frozen dependency/source checks;
  tools TypeScript; shell syntax; docs drift/gardening; diff/privacy review.
- Expected outcomes: all focused behavior checks pass, with any unrelated
  broad dependency-audit limitation reported exactly.
Completed: 2026-08-14
