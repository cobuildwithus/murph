# Fixture Corpus

This directory holds deterministic QA scaffolding for the first Murph implementation wave.

## Contents

- `minimal-vault/`: human-readable vault skeleton without unresolved `vault.json` or JSONL record payloads
- `demo-web-vault/`: small but populated vault fixture for richer manual review and QA scenarios than `minimal-vault`
- `sample-imports/`: placeholder source files for document, meal, and sample-import scenarios
- `golden-outputs/`: per-command directories documenting the current stable smoke expectations for each command surface
- `fixture-corpus.json`: machine-readable inventory consumed by the smoke verifier

## Rules

- Do not invent payload fields that are not already defined by the frozen contracts or current CLI/query behavior.
- Keep fixture inputs small, deterministic, and reviewable in plain text.
- Use golden-output directories to document stable lookup, validation, and export-pack expectations even when the CLI binary is not executed in repo checks.
