# Device-provider synthetic fixtures

`google-health-sleep-summary.json` is a privacy-safe synthetic structural fixture. It models the documented Junction summary envelope and the documented Google Health sleep fields, but it is not a captured live payload.

The test intentionally assumes that Junction identifies the source through `provider.name: "Google Health"` and places sleep summaries under `summaries.sleep.data`. A sanitized Google Health sandbox capture must confirm those identity and nesting fields before the migration is considered payload-complete. The fixture must never be replaced with member identifiers, raw health values, credentials, or an unredacted provider payload.
