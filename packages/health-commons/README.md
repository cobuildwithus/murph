# Murph Health Commons

This package is the public/reference knowledge layer for Murph health pages. It stores wiki-like Markdown pages plus small JSON/JSONL sidecars, then builds deterministic runtime catalog artifacts.

The source of truth is intentionally small and forkable:

- `content/**/*.md` — typed Markdown pages with YAML-frontmatter-like metadata.
- `content/redirects.json` — aliases and moved canonical keys.
- `content/changes/*.jsonl` — semantic change summaries for product history UIs.
- `content/artifacts/**/*.json` — manifests for PDFs, extracted text, screenshots, and other large artifacts stored outside Git.

Large PDFs and copyrighted journal files do **not** belong in Git. Add a manifest entry with source, rights, hash, local path, and Cloudflare R2 object key, then upload only when the rights status allows it.

Useful commands:

```bash
pnpm --filter @murphai/health-commons generate
pnpm --filter @murphai/health-commons generate:check
pnpm --filter @murphai/health-commons artifacts:r2:dry-run
```

To upload legally cleared local artifacts to Cloudflare R2, set `MURPH_COMMONS_R2_BUCKET` or pass `--bucket`, then run the sync script without `--dry-run`. The script refuses non-redistributable or uncleared artifacts unless explicitly overridden.
