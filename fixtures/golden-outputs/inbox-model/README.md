# `vault-cli inbox model bundle`

Current smoke expectation:

- `bundle` emits a normalized text-only inbox routing bundle plus a persisted `bundlePath`
- the removed `route` command stays unavailable instead of exposing OpenAI-compatible backend options
- bundle artifacts remain rebuildable audit material under `derived/inbox/**`, not canonical vault truth
