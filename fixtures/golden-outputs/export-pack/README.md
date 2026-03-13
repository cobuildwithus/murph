# `vault-cli export pack`

Current smoke expectation:

- returns a derived `packId` plus the materialized file list
- file set contains `manifest.json`, `question-pack.json`, `records.json`, `daily-samples.json`, and `assistant-context.md`
- health-aware export packs keep the same five-file shape and embed health context in `manifest.json`, `question-pack.json`, and `assistant-context.md` while preserving `records.json` as the legacy records array
- export packs are derived outputs, not canonical vault records
