# `vault-cli capture add`

Current smoke expectation:

- records dated media captures as canonical note events with capture tags
- returns an event id, lookup id, optional stable label lookup, and raw manifest path
- stages provided media under immutable raw capture storage
- `capture import-json` can batch the same capture shape through a structured payload
