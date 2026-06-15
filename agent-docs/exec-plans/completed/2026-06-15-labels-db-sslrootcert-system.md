# Labels DB `sslrootcert=system` Handling

## Goal

Make product-test import scripts work with labels database URLs that include
`sslrootcert=system` on local `psql` builds that require an explicit CA bundle
file, without exposing the database URL in process arguments or logs.

## Constraints

- Keep `MURPH_LABELS_DB_URL` secret-safe: never print it or pass it to `psql`
  argv.
- Preserve the existing env sanitization boundary for inherited libpq vars.
- Keep the fix in the shared labels DB helper so PlasticList, thresholds, and
  open product-source imports share the same behavior.

## Approach

- Translate `sslrootcert=system` to the first readable local CA bundle path when
  preparing the secret-safe libpq environment.
- Continue stripping `sslcert=system` and `sslkey=system`, because those are
  client-certificate fields and should not inherit ambient local state.
- Document the behavior in the product-test import README and cover the helper
  branch in the existing product-test schema/import test.

## Verification

- `CI=1 pnpm --dir apps/web test:prepared -- apps/web/test/product-tests-schema.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm docs:drift`
- `pnpm test:diff`
- `git diff --check`
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
