# `vault-cli workout add`

Current smoke expectation:

- accepts one freeform `<text>` argument plus optional `--duration`, `--type`, `--distance-km`, `--occurred-at`, and `--source` overrides
- stores the freeform note verbatim in `note` on one canonical `activity_session` event
- infers optional `strengthExercises` data only when the note clearly describes structured lifting work
- returns `eventId`, `lookupId`, and the ledger shard path for follow-on reads through `show` or `event show`
