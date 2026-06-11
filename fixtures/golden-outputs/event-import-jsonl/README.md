# `vault-cli event import-jsonl`

Current smoke expectation:

- imports many canonical events from JSON Lines input in one transactional batch
- payloads must not carry explicit event ids; externalRef is the re-import identity, reconciled vault-wide
- dry-run by default; `--apply` writes and emits one audit record
- returns `applied`, `receivedCount`, `createdCount`, `skippedExistingCount`, `supersededCount`, targeted `eventShardPaths`, and `auditPath`
- one invalid line (parse, contract, or kind conflict on an existing externalRef) rejects the whole batch
