# `vault-cli intervention add`

Current smoke expectation:

- accepts one freeform `<text>` argument plus optional `--duration`, `--type`, `--regimen-id`, `--occurred-at`, and `--source` overrides
- stores the freeform note verbatim in `note` on one canonical `intervention_session` event
- infers one canonical `interventionType` when the note clearly names a known intervention and requires `--type` only when the note is ambiguous or too generic
- records optional `durationMinutes` only when inferred or supplied and links `regimenId` back through both the dedicated field and `relatedIds`
- returns `eventId`, `lookupId`, and the ledger shard path for follow-on reads through `show` or `event show`
