# Changelog content

Add public changelog items as independent JSON files:

```text
entries/YYYY-MM-DD/<stable-item-id>.json
```

Each entry owns `publishedOn`, `order`, and one `item`. The directory date,
`publishedOn`, item ID, and filename must agree. Higher `order` values render
first; equal values use item ID as a deterministic tie-breaker. Use gaps of 100
when order matters, and do not renumber unrelated entries.

```json
{
  "publishedOn": "2030-01-17",
  "order": 100,
  "item": {
    "id": "stable-item-id",
    "kind": "improvement",
    "priority": 3,
    "title": "A concrete member outcome",
    "summary": "One sentence describing what changed for the member.",
    "details": "The most important boundary, limitation, or recovery behavior.",
    "relevanceTags": ["product-area"],
    "sourcePullRequests": [1234]
  }
}
```

Optional edition-level title and summary live at
`editions/YYYY-MM-DD.json`. They are not required: dates without metadata use a
stable fallback title and item-count summary. Avoid editing shared edition
metadata in ordinary item PRs when several changes are landing on the same
date.

Historical editions in `src/lib/changelog.ts` are frozen through 2026-08-09.
Fragment dates after that boundary remain open to independent item files; a
normal item PR never advances the boundary or edits a hand-maintained edition
or latest-page inventory test. An intentional correction to existing historical
public content remains an exceptional legacy-registry edit and declares the
affected existing date and item IDs. Web development, tests, typechecking, and
builds generate an ignored TypeScript module from the fragments, avoiding both
a committed merge hotspot and runtime filesystem reads. The loader and focused
tests validate fragments and publish them through the existing archive, feed,
permalink, and share-card contracts.
