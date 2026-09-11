# Preview database separation proof

This is a temporary, separately reviewed diagnostic for a Preview environment
whose Sensitive database settings have no authoritative resource metadata.
Preparing or merging this script does not run it or establish isolation.
The operator must have current-task authorization for its hosted execution.

## What the result establishes

`apps/web/scripts/preview-database-proof.ts` reads PostgreSQL cluster identity
and database name through a fresh salted SHA-256 digest. Neither source value
leaves the connection. Both Preview runtime and direct migration endpoints must
be writable-primary endpoints, return the same digest, and differ from the
approved primary production reference before the result is `different database`.
Queries themselves are read-only, with verified TLS and short deadlines.
Only complete connection URLs with supported non-routing query options are
accepted. Target overrides and ambient credential fallback remain unqualified;
the probe must not silently change the destination it claims to check.

All other outcomes are `unable to verify`. In particular, a matching digest
cannot establish `same database`: physical clones may preserve PostgreSQL's
system identifier. Missing configuration, replicas, expired references,
permission errors and inconsistent Preview endpoints remain unqualified.

This proves database separation at the time of observation, not sanitization of
copied data, isolation of provider credentials, schema readiness, or complete
login readiness. Recheck after target changes. Never create test accounts based
on separate environment-variable records alone.

## Review and prepare

Review the exact script, tests, bundle and launch request before executing it.
Use the existing approved opaque primary read-only helper for the reference;
never read a production URL, duplicate database credentials, or download a
Vercel environment file. If that helper's production binding is unconfirmed,
stop with `unable to verify`.

Build a self-contained Node bundle using the existing locked build tool:

```sh
pnpm --dir apps/cloudflare exec esbuild ../web/scripts/preview-database-proof.ts \
  --tsconfig=../../tsconfig.base.json --bundle --platform=node --format=esm \
  --external:pg-native \
  '--banner:js=import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' \
  --outfile=../../.tmp/preview-database-proof/proof.mjs
```

Inspect the bundle for accidental local paths and identifiers. Include no source
maps, environment files, application assets or credentials. The deploy upload
contains exactly three in-memory files under the existing `apps/web` project root:

| File | Content |
| --- | --- |
| `apps/web/proof.mjs` | The reviewed bundle above |
| `apps/web/reference.json` | A fresh reference envelope described below |
| `apps/web/vercel.json` | The diagnostic-only configuration below |

```json
{"version":2,"framework":null,"installCommand":"true","buildCommand":"node proof.mjs --vercel-build"}
```

No installer, Next build, schema migration or application server executes.
The script refuses a production build and refuses existing output. Its only
deployable payload is `.vercel/output/static/result.txt` plus the Build Output
API version declaration. The input envelope and database settings are not
included in that output.

## Fresh reference and execution

1. Generate a cryptographically random 32-byte salt, represented as 64 lowercase
   hexadecimal characters. Through `murph-prod-psql-ro`, execute the exact
   exported `databaseProofSql` with `$1` replaced by that validated salt as an SQL
   string literal. Use `-X -qAt`, a bounded subprocess timeout, and no debug or
   inherited-output mode. The helper already enforces read-only transactions;
   impose a three-second SQL statement timeout for this request as well.
2. Capture only the digest and the two booleans. Require one row, a 64-character
   lowercase hexadecimal digest, `is_primary=true` and `read_only=true`. Do not
   inspect or print raw connection errors. Construct an in-memory JSON envelope
   with `salt`, `fingerprint`, and `expiresAt` (current epoch milliseconds plus
   15 minutes). Do not commit or publish the envelope.
3. Use Vercel's authenticated `POST /v13/deployments` with the existing project
   and team, the three explicit `files` above, and no `target` (Preview). Do not
   pass `deploymentId`, `gitSource`, aliases, project-setting changes or any
   environment credential override. `forceNew=1` ensures a fresh build;
   `skipAutoDetectionConfirmation=1` permits the explicit no-framework config.
   Before submitting, verify that the intended Preview branch has no database
   overrides that differ from the environment being probed. This unbranched
   diagnostic qualifies only the default Preview environment.
4. Filter the response to deployment id, URL, target and readiness. Require a
   Preview target. Keep protection enabled and read `/result.txt` from that exact
   deployment using `vercel curl`; accept only the two closed results above.
   A failed, delayed, mismatched or expired build is `unable to verify`, never
   successful isolation proof. Repeated execution requires a fresh reference.
5. Remove only the diagnostic deployment created by this execution after the
   result has been observed, using the task's applicable cleanup authorization.
   Remove the local rebuildable bundle when it is no longer needed. Preserve
   existing application deployments and production aliases.

The [Vercel deployment API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment)
owns the upload contract; the [Build Output API](https://vercel.com/docs/build-output-api)
owns the static output. The diagnostic remains dormant in normal builds and can
be removed once environment provisioning provides authoritative isolation proof.
