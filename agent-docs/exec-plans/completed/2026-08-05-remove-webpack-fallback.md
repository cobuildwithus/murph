# Remove Webpack fallback from hosted web builds

## Goal

Make Turbopack the only repository-supported Next.js bundler for hosted web development and production builds, and remove obsolete Webpack-only configuration and dependency overrides.

## Scope

- Remove inactive Webpack-only Next.js build flags.
- Reject explicit Webpack selection in the hosted local development wrapper.
- Remove the stale `terser-webpack-plugin` override from workspace dependency policy and the lockfile.
- Keep a regression guard that production builds do not select Webpack.
- Measure the Turbopack build stage against the previous production Webpack build without attributing unrelated Prisma and migration improvements to the bundler.

## Verification

- Focused hosted-web tests for dev arguments, Next configuration, and the production build command.
- Lockfile synchronization and dependency policy checks.
- A production-mode hosted-web build using the default Turbopack path.
- Final diff review and repository search for remaining repo-owned Webpack selection paths.

## Status

- [x] Remove repository-owned Webpack selection and configuration.
- [x] Synchronize dependency policy and lockfile.
- [x] Run focused tests, dependency checks, and production build proof.
- [x] Record measured comparison and close the plan.

## Outcome

Hosted web production and local development now select Turbopack exclusively;
an explicit local `--webpack` request fails fast. Webpack-only Next flags and
the stale `terser-webpack-plugin` override are gone. Focused tests passed, the
dependency policy guard passed, and a complete local Next 16.3 Turbopack build
passed. The registry audit still reports pre-existing high and critical
findings in unrelated transitive dependencies; this change altered no resolved
package version.

On the same Vercel Standard machine class, the prior forced-cold Webpack build
compiled in 3.2 minutes and completed the Vercel build stage in eight minutes.
The forced-cold Turbopack preview compiled in 91 seconds and completed that
stage in four minutes. The compile-only comparison is approximately 53% faster
or 2.1 times the previous speed. The total build-stage reduction also includes
the separately implemented Prisma and database-lifecycle corrections.
Status: completed
Updated: 2026-08-05
Completed: 2026-08-05
Completed: 2026-08-05
