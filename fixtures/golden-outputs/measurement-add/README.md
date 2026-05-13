# `vault-cli measurement add`

Current smoke expectation:

- records one or more scalar measurements as one canonical measurement event
- accepts typed repeated `--metric`, `--value`, and `--unit` groups
- supports structured `measurement import-json` for nested metadata and import manifests
- returns an event id, lookup id, measurement entries, optional media, and manifest path
