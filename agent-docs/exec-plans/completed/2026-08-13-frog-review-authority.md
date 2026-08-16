# Harden Frog review authority and evidence

Status: completed
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Make both Frog model stages consume immutable protected-main task and skill
  evidence, reject candidate instruction-authority changes before the edit-only
  worker starts, and accept only exact kind-specific completion responses.

## Success criteria

- Implementation and canonical review ZIPs contain exact task/skill blobs and
  path/digest manifests, with a missing artifact rejected.
- Candidate task, Frog skill, and root or nested `AGENTS.md` changes, including
  ignored instructions, fail before launch and after the worker returns.
- Protected patch paths are derived from Git's parsed targets, and an
  interrupted suffixed review archive does not poison the next package attempt.
- Implementation, specialist, and final responses fail closed when their exact
  terminal structure is missing, duplicated, reordered, or followed by prose.

## Scope

- In scope: Frog parent/worker prompts, parent orchestration guards, review
  response validation, audit-package composition, focused executable proof,
  and matching live documentation.
- Out of scope: a generalized response parser, another authority service,
  changes to merge/issue closure, or changes to the protected-main owner.

## Tasks

1. Bind task, skill, and worker instruction authority to protected-main blobs.
2. Enforce the existing preset-specific response grammar at orchestration.
3. Prove all three production ZIP compositions and the omission boundary.
4. Run Frog, packager, type, docs, shell, diff, and privacy verification.

## Decisions

- Keep `origin/main` as the only authority and pass verified paths/digests in
  the existing worker prompt instead of adding persisted state.
- Use one narrow callback seam around the existing canonical checkout/package
  composition so tests exercise the same production path without invoking the
  browser review client.

## Verification

- Commands: focused Frog Vitest suite, packager regression suite, direct tools
  TypeScript check, workspace typecheck when the shared guard permits it,
  `pnpm no-js`, docs drift/gardening, shell syntax, diff check, and privacy scan.
- Expected outcomes: exact valid structures and all three ZIPs pass; malformed
  structures, candidate authority mutations, and evidence omission fail closed.
Completed: 2026-08-13
