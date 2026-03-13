# Inbox operator flow tightening

Status: completed
Created: 2026-03-13
Updated: 2026-03-13

## Goal

- Tighten the inbox operator flow so `vault-cli inbox bootstrap` is the canonical local setup path, foreground `run` auto-drains parser work, historical `backfill` stays queue-first by default, parser startup behavior matches the docs, and parser availability claims stay truthful.

## Success criteria

- `vault-cli inbox bootstrap` ensures inbox runtime exists, writes parser toolchain config, runs doctor, and can fail the bootstrap when parser readiness is not green in strict mode.
- `pnpm setup:inbox` delegates to `vault-cli inbox bootstrap`.
- `vault-cli inbox run` auto-drains parser jobs on new captures without forcing historical backfill parsing by default.
- `vault-cli inbox backfill` remains queue-first unless the operator opts into parsing.
- `runInboxDaemonWithParsers(...)` drains existing parser jobs once on startup before entering watch mode.
- PaddleOCR only claims image/PDF support.
- Whisper doctor status verifies the configured model path exists instead of checking only for a non-empty string.
- Tests and docs reflect the behavior above.

## Scope

- In scope:
- inbox bootstrap/run/backfill command and service behavior
- parser toolchain doctor/discovery truthfulness
- parser daemon startup drain
- focused README/package README updates and focused inbox/parser tests
- Out of scope:
- new parser providers for office documents
- inbox runtime schema/storage rewrites outside the current operator-flow seam

## Constraints

- Preserve adjacent dirty-worktree edits owned by active inbox/bootstrap/parser rows.
- Keep backfill default behavior queue-first for historical imports.
- Keep privacy redaction intact in doctor output and tests.

## Risks and mitigations

1. Risk: overlapping inbox rows are editing the same service/test/docs files.
   Mitigation: restrict edits to bootstrap/run/backfill/doctor parsing symbols and re-read current file state before each patch.
2. Risk: operator-flow changes regress built CLI/test expectations.
   Mitigation: add focused CLI/parser tests first-class with the behavior change, then run the required repo checks.
3. Risk: strict bootstrap failure semantics could become noisy for non-parser connector issues.
   Mitigation: scope strict failure to doctor failures plus unavailable explicitly configured parser tools, while ignoring the expected no-connectors warning during bootstrap.

## Tasks

1. Patch inbox bootstrap/run/backfill service and CLI options.
2. Patch parser startup drain, PaddleOCR support gating, and whisper model-path verification.
3. Update focused docs and tests.
4. Run completion-workflow audits, required verification, remove the ledger row, and commit the touched files.
