# Device-provider synthetic fixtures

`google-health-sleep-summary.json` is a privacy-safe synthetic structural fixture. It models Murph's internal Junction snapshot after the documented top-level `sleep` response array has been collected, including Junction's stable `source.provider` slug and documented sleep timestamps. It is not a captured live payload.

The official Junction API contract is the source of truth for identity and nesting. A sanitized sandbox capture can provide additional compatibility evidence, but it is not required to establish the documented contract. The fixture must never be replaced with member identifiers, raw health values, credentials, or an unredacted provider payload.
