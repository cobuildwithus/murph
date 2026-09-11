# Extract workspace snapshot process diagnostics

Status: completed
Created: 2026-09-10

## Goal

Remove the archive implementation dependency from general runtime error diagnostics
by giving bounded workspace snapshot process diagnostics one concrete leaf owner.

## Success criteria

- Move the existing eleven diagnostic functions, five constants, and diagnostic
  types without changing function bodies or constant initializers.
- Preserve the private marker identity, stderr counters and bounds, marker
  classification, non-enumerable annotation, error identity, and callback timing.
- General runtime diagnostic consumers import the diagnostic leaf directly.
- Archive process creation, pipe handling, teardown, abort precedence, cryptography,
  and durable-root replacement remain with the archive owner.
- Focused tests, Cloudflare typecheck, complexity ratchet, and static equivalence
  evidence pass before a scoped commit and draft PR.

## Scope

- `apps/cloudflare/src/workspace-snapshot-process-diagnostics.ts`
- Diagnostic declarations/imports in `workspace-snapshot-local.ts` and
  `runtime-platform/diagnostics.ts`.
- Direct diagnostic tests and the existing diagnostic-reader test import.
- This plan and a task-owned Frog entry only if reproducible friction warrants it.

## Constraints

- Base: `b80bd40f84d1b367c1810e2fe046e3089cc28aa4`.
- Preserve behavior; no archive, retry, stream, crypto, persistence, or protocol
  changes. No public package entrypoint or compatibility forwarding layer.
- Keep one private marker symbol in the new owner; both annotation and reading
  use it. Stderr capture exposes only the existing bounded diagnostic projection.
- Use the isolated task checkout and ordinary frozen dependency installation.
  Run focused tests with at most two workers and one heavy local check at a time.
- The parent owns candidate review, Ready, final ReviewGPT, CI, and completion.

## Risks and mitigations

- Splitting annotation and reading could break symbol identity: move their complete
  closure together and exercise nested-cause readback through both consumers.
- Moving capture could alter privacy or stream behavior: preserve literal bodies
  and test split chunks, retained markers, bounds, and raw-text exclusion.
- Refactoring process error preference could change cancellation semantics: leave
  all lifecycle functions intact and retain real archive and cancellation proof.

## Tasks

- [x] Inspect callers, exports, shared state, tests, and relevant owner docs.
- [x] Move diagnostic closure and update direct imports.
- [x] Add bounded diagnostic contract tests and run focused proof.
- [x] Check AST/body equivalence, full diff, complexity, and privacy.
- [x] Prepare final scoped commit and complete draft PR evidence for handoff.

## Decisions

- Existing `runtime-platform/diagnostics.ts` continues to own runtime log-field
  projection. It should not import cryptography, filesystem, and subprocess
  implementation merely to decode a diagnostic marker.
- The leaf owns only capture/annotation/decoding. Existing process wait, EPIPE
  preference, teardown, restore, and checkpoint ordering stay together.
- Product UX and changelog are not applicable: internal ownership extraction
  leaves member-visible behavior and provider input unchanged.
- No storage/wire shape or independently deployed contract changes; no migration,
  deployment-order requirement, or rollback floor is introduced.

## Verification

- `pnpm install --frozen-lockfile`: passed with the committed lockfile. Fresh
  checkout CLI-bin warnings require no workaround for the focused proof.
- `scripts/frog list`: passed after normal installation; no new friction entry.
- Babel AST/source comparison: eleven moved function bodies, five constant
  initializers, and four types match the base exactly. Thirty-four retained
  archive function bodies, four initializers, and five types also match exactly.
  All non-import statements in runtime diagnostic formatting and existing archive
  tests are unchanged.
- `pnpm complexity:diff --base b80bd40f84d1b367c1810e2fe046e3089cc28aa4`:
  passed; thirteen exact moved functions including callbacks, zero debt delta,
  and no changed-file functions above twenty. New diagnostic owner maximum is
  seven; retained archive maximum is sixteen.
- Full tracked diff and six-file privacy inspection passed.
- Focused Vitest command using `apps/cloudflare/vitest.node.workspace.ts` with
  `--maxWorkers 2 --no-coverage`: five files and 296 tests passed. Files were
  `workspace-snapshot-process-diagnostics.test.ts`,
  `workspace-snapshot-local.test.ts`, `workspace-snapshot-interruption.test.ts`,
  `runner-platform.test.ts`, and `control-plane-fetch-diagnostics.test.ts`.
- Parent candidate review passed. Independent Babel comparison confirmed all
  eleven moved and thirty-four retained function bodies are identical; review
  covered diagnostic privacy, cyclic causes, frozen errors, and import rewiring.
- `MURPH_VERIFY_SHARED_HOST=1 MURPH_TSC_PACKAGE_MODE=single-threaded pnpm --dir
  apps/cloudflare typecheck`: passed. No production or live-provider calls were
  needed for this extraction. Ready, final ReviewGPT, and exact-head CI remain
  owned by the parent completion session.
Updated: 2026-09-10
Completed: 2026-09-10
