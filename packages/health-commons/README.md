# Murph Health Commons

This package is the public/reference knowledge layer for Murph health pages. It stores wiki-like Markdown pages plus small JSON/JSONL sidecars, then builds deterministic runtime catalog artifacts.

The source of truth is intentionally small and forkable:

- `content/**/*.md` — typed Markdown pages with YAML-frontmatter-like metadata.
- `content/redirects.json` — aliases and moved canonical keys.
- `content/changes/*.jsonl` — semantic change summaries for product history UIs.
- `content/artifacts/**/*.json` — manifests for PDFs, extracted text, screenshots, and other large artifacts stored outside Git.

Generated catalog artifacts under `generated/**` are build outputs, not source. They are ignored by Git and can be recreated from `content/**` plus the generator/schema code:

```bash
pnpm --filter @murphai/health-commons generate
```

For content changes, commit only the authored source files (`content/**/*.md`, `content/**/*.json`, `content/**/*.jsonl`) plus any code or tests that intentionally change the generator contract. Do not commit regenerated `generated/**` files.

Large PDFs and copyrighted journal files do **not** belong in Git. Add a manifest entry with source, rights, hash, local path, and Cloudflare R2 object key, then upload only when the rights status allows it.

## Useful commands

```bash
pnpm --filter @murphai/health-commons generate
pnpm --filter @murphai/health-commons generate:check
pnpm --filter @murphai/health-commons artifacts:r2:dry-run
```

`generate:check` validates that the generator can rebuild the catalog deterministically and that the current `generated/**` tree exactly matches the intended output, with no missing, changed, or stale files.

## Adding article PDFs to Cloudflare R2

### 1. Stage the file locally, outside Git

Place the PDF in the repo-local staging directory:

```bash
research-artifacts/sauna/<slug>.pdf
```

That directory is gitignored on purpose. Source-page HTML/text snapshots can use the sibling `source-artifacts/**` staging directory, which is also gitignored.

### 2. Generate the hash + manifest stub

```bash
pnpm --filter @murphai/health-commons artifacts:hash -- --file research-artifacts/sauna/pmid-29849692.pdf --source-key source_artifact:pmid-29849692
```

The helper prints a manifest-ready JSON object including:

- `artifactId` using the same stable-id character set as the Health Commons schema
- `sha256`
- `byteSize`
- `localPath`
- a default `objectKey`
- a safe default `rightsStatus`
- `redistributable: false`

Copy those fields into `content/artifacts/sauna/research-artifacts.json`, or place small source-page snapshot pointers directly in a `source_artifact` page's `artifacts` block. Both locations are included in the generated artifact manifest.

### 3. Review rights before upload

By default, journal article artifacts should stay:

- `rightsStatus: permission_required`
- `redistributable: false`

Only change those fields after legal / license review.

### 4. Dry-run the upload command

```bash
pnpm --filter @murphai/health-commons artifacts:r2:dry-run -- --bucket <your-r2-bucket>
```

The dry run prints the exact Wrangler upload command or tells you why an artifact is blocked.

### 5. Upload after rights are cleared

```bash
pnpm --filter @murphai/health-commons artifacts:r2 -- --bucket <your-r2-bucket>
```

You can also point the sync script at a different local artifact root:

```bash
pnpm --filter @murphai/health-commons artifacts:r2 -- --bucket <your-r2-bucket> --artifact-root /absolute/path/to/repo
```

## Safety defaults

The R2 sync script refuses upload when any of these are true unless you explicitly override it:

- `rightsStatus` is `unknown`, `permission_required`, or `not_redistributable`
- `redistributable` is `false`
- `objectKey` is missing
- the local file hash or size does not match the manifest when those fields are present
