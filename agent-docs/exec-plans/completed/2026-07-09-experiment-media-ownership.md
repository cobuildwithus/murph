# Experiment Media Ownership

Status: completed
Updated: 2026-07-10

## Why

Media copied into `bank/experiments/**` bypasses the canonical capture owner,
creates redundant durable bytes, and can outlive the raw inbox copy even though
the experiment itself should be Markdown-only. That weakens retention and makes
snapshot size depend on assistant file-copy behavior.

## Goal

Enforce the exact experiment storage allowlist—direct slug-named Markdown
documents plus direct JSON records in the reserved `outcomes/` directory—route
durable experiment media through the existing canonical capture path, and
provide a safe dry-run-first repair for legacy misplaced files.

## Invariants

- Experiment notes remain user-readable Markdown and may reference canonical
  captures without owning binary media.
- Do not blanket resize or recompress original user media.
- Do not delete raw inbox media ahead of its existing retention policy.
- Repair must be deterministic, collision-safe, dry-run by default, and must not
  lose or overwrite bytes.
- Reuse the current capture owner and audit/mutation boundary; do not create a
  second media catalog or storage hierarchy.

## Work

1. Confirm and reuse the canonical capture-import primitive.
2. Enforce direct `<slug>.md` experiment documents plus reserved
   `outcomes/*.json` records on supported write/validation paths and make query
   and assistant readers ignore non-canonical nested documents.
3. Add an operator repair that previews misplaced experiment media and accepts
   only a boundary-safe, byte-exact full vault-relative source path found in
   exactly one canonical experiment document. Copy and verify through the
   capture owner, rewrite only those exact literals, and atomically quarantine
   and verify the inspected note and source bytes before replacing or deleting
   either path.
4. Add focused coverage for valid Markdown, rejected binary writes, collisions,
   reference repair, dry-run behavior, and retention preservation.
5. Run required security/privacy, coverage, final review, scoped verification,
   PR review, and CI gates.

## Verification

- Core coverage passes 551 tests at 90.32% statements and 81.64% branches,
  including repair-boundary races for both note and source quarantine.
- Contracts coverage passes 160 tests, query coverage passes 489 tests, and
  vault-usecases coverage passes 173 tests. The focused assistant and CLI
  command suites pass 5 and 31 tests respectively; all six edited packages and
  all reverse dependents selected by `test:diff` typecheck successfully.
- Full package build, 201-scenario smoke, CLI schema generation, diff/privacy
  checks, security/privacy review, and coverage-write review pass. The broad
  reverse-dependent test fanout is blocked by pre-existing assistant timing
  limits under parallel/coverage load; each reported timeout passes alone on
  both this branch and `main`.
- A disposable replay of the actual experiment subtree finds five candidates
  totaling 4,246,972 bytes with zero blockers, promotes and removes all five,
  rewrites one note, preserves both outcome JSON files byte-for-byte, and leaves
  a second dry run empty. The live vault and backup remain untouched.
- PR ReviewGPT and CI run after the scoped implementation commit is pushed.

## Deployment

No coordinated app deployment is expected. The repair is operator-invoked and
must remain opt-in; normal runtime writes gain only the stricter owner boundary.
Completed: 2026-07-10
