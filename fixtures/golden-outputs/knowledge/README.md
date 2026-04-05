# `vault-cli knowledge`

Current smoke expectation:

- `upsert` writes one assistant-authored wiki page under `derived/knowledge/` and refreshes the shared knowledge index
- `list`, `search`, and `show` provide read-only inspection over assistant-authored wiki pages without mutating canonical vault records
- `lint` validates the derived knowledge graph and page metadata for operator-visible issues
- `log tail` exposes the append-only knowledge change log for quick operator inspection
- `index rebuild` refreshes the derived knowledge index from the stored wiki pages
