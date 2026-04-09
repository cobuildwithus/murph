# Health Extension Fixtures

This directory stages the health cutover assets without mutating the baseline fixture corpus.

## Contents

- `sample-imports/intake/initial-intake.json`: deterministic assessment-import source payload
- `payloads/*.json`: payload-first command inputs for the new health noun commands
- `vault-overlay/`: health-specific memory, wiki, preferences, Markdown, and JSONL records that document the intended post-cutover vault shape

## Notes

- These assets are intentionally separate from `fixtures/minimal-vault` because the parent lane still owns the shared fixture-index and golden-output seams.
- Scenario manifests under `e2e/smoke/scenarios/health-extensions-*.json` reference these files directly for integrity checks.
