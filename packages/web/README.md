# `@healthybob/web`

Local-only Next.js read surface for the Healthy Bob vault.

## Purpose

- read the vault on the server through `@healthybob/query`
- render a small operator-facing observability UI
- stay read-only and avoid inventing a second storage system
- keep search scoped to safe record fields instead of path-derived metadata

## Local usage

Run the app from this package with an explicit vault root:

```bash
HEALTHYBOB_VAULT=../../fixtures/minimal-vault pnpm dev
```

The package launch wrappers bind Next to `127.0.0.1` and block framework `.env*` reads. If `HEALTHYBOB_VAULT` is unset, the app shows a setup screen instead of guessing paths.
