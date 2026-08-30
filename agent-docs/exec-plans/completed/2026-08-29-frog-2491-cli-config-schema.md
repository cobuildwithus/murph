# Prepare CLI config-schema dependency build

Status: completed
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Make the documented CLI config-schema generator work from a freshly installed
  worktree by preparing its declared workspace build dependencies before Incur
  reads the built CLI entrypoint.

## Success criteria

- A focused regression proves generation delegates to the repository-owned
  dependency-aware prepared-runtime build.
- `pnpm --filter @murphai/murph gen:config-schema` succeeds from the fresh lane
  without changing committed generated artifacts.
- CLI package typecheck and package-shape verification remain green.

## Scope

- In scope: the CLI Incur artifact generator's build preparation and focused
  regression coverage.
- Out of scope: pre-commit diagnostics, generator progress/timeout reporting,
  or changes to the prepared-runtime dependency graph.

## Constraints

- Technical constraints: reuse `build:test-runtime:prepared`; preserve the
  package-shape verifier's `rebuildCli: false` drift check.
- Product/process constraints: do not consume or modify related unmerged Frog
  repair branches; keep this change repository-local developer tooling only.

## Risks and mitigations

1. Risk: schema generation could recursively invoke itself or bypass drift proof.
   Mitigation: route only the default rebuild branch through the existing prepared
   build and retain the verifier's no-rebuild path unchanged.

## Tasks

1. Reproduce the fresh-worktree missing-dist failure and identify its owner.
2. Route generator preparation through the existing dependency-aware build.
3. Add focused command/cwd regression proof and run generator/CLI verification.

## Decisions

- `build:test-runtime:prepared` is the existing repository owner for the CLI's
  complete project-reference graph, artifact locking, and public-import smoke.

## Verification

- Commands to run: focused Vitest regression; CLI generator; CLI typecheck and
  package-shape verification; repository tooling audits selected by completion.
- Expected outcomes: all commands pass and regeneration leaves no generated diff.
Completed: 2026-08-29
