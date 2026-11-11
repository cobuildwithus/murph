# Simplify repository tooling ownership

Status: completed
Created: 2026-11-10
Updated: 2026-11-10

## Goal

Remove duplicate tooling authority, repair loops, and process state while preserving exact-head proof, repository integrity, and supported historical worktrees.

## Scope and owners

- Pinned repo-tools package owns executable helpers and structural documentation checks.
- Prepared-runtime entrypoint owns building artifacts; test workers only validate them.
- PR authors own Draft/Ready; required checks own exact-head proof.
- Gardening computes structured findings before rendering once.
- Historical installer compatibility stays until active-checkout evidence permits retirement.

## Protected invariants

Required documentation and valid index targets remain checked. Current commit gates are satisfied with this plan and owner-document updates. CI retains its expensive-work admission, required check names, fork boundaries, and exact-head proof. Artifact failures remain fail-closed; no hidden worker repair or retry of compiler errors. Worktree admission and safety controls remain intact.

## Tasks

1. Pin installed tooling resolution and remove code/file-count documentation gates in the dependency patch.
2. Remove worker-owned artifact builds and repeated prepared-build retries; retain only one targeted missing-output repair if required by incremental builds.
3. Delete asynchronous PR draft reset and its tests; update current readiness guidance.
4. Filter structured gardening findings before rendering.
5. Inventory active installer versions and record evidence-backed retirement disposition.
6. Run focused tests, relevant typechecks, complexity, docs and dependency checks; review diff; scoped commit and draft PR.

## Verification

- Eleven focused script tests pass: installed tool authority, structural docs checks, immutable CI comparison, gardening parity, compiler failure and bounded missing-output repair.
- Eighteen PR CI policy tests pass with required checks, fork boundaries, readiness admission and main proof isolation retained.
- Thirty-nine CLI artifact/helper/entry/runtime tests pass.
- Tools and CLI source typechecks pass.
- Real prepared-runtime build succeeds. Removing a session-built CLI output reproduces the incremental compiler missing-output case: one forced rebuild restores the output and import proof succeeds. This evidence justifies retaining that single repair.
- Dependency policy, shell syntax, docs drift, gardening and diff whitespace checks pass.
- Cyclomatic complexity passes: gardening maximum falls from 10 to 5; no changed source hotspot exceeds 20.
- User explicitly requested ReviewGPT. Parent owns candidate review, Ready, ReviewGPT, exact-head CI, and merge progression.

## Product UX and changelog

Internal tooling only; no member-facing behavior or changelog item.

## Historical installer disposition

Retained. A read-only registered-checkout head inventory found 14 historical
installer revisions and 12 revisions without the current installer among 189
registered checkouts. The remaining 163 have the current installer markers.
No paths, account identifiers, or checkout contents were captured. Historical
callers therefore remain a demonstrated supported boundary, not speculative
compatibility. Remove it only after all potentially active checkouts meet the
current installer floor; this task neither retires nor mutates other checkouts.
Completed: 2026-11-10
