# `vault-cli meal add`

Current smoke expectation:

- at least one of `--photo`, `--audio`, or `--note` is required
- note-only meals are valid and surface `photoPath: null`
- photo-only meals remain valid and surface `audioPath: null`
- returns `mealId`, `eventId`, and a queryable `lookupId`
