# `vault-cli inbox model bundle|route`

Current smoke expectation:

- `bundle` emits a normalized text-only inbox routing bundle plus a persisted `bundlePath`
- `route` emits an audited plan/result artifact set and reports the chosen provider mode
- `route --apply` delegates writes back through the existing CLI service layer instead of mutating files directly
