# Restore current encrypted snapshots in hosted-local assertions

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal and invariant

Make three hosted-local assertions inspect the committed v2 encrypted archive.
Preserve the workout mutation/rejection, durable vault text, and personalized
trial canonical-state invariants. Unsupported references must never become an
empty successful baseline.

## Ownership and evidence

The Messages member-action reader requires a retired base bundle and throws for
v2. Vault persistence similarly returns null. Personalized next trials compares
empty protected-state lists for v2 without reading the archive. All three use the
current snapshot reference but the legacy bundle accessors return no v2 bundle.

Reuse the existing runtime crypto context, R2 presign, prepared restore and
streamed encrypted archive restore owners. One test-only callback restores into
a temporary directory, validates actual canonical vault metadata, runs the
caller assertion and removes plaintext in finally. The callback's protected-file
scan may correctly return empty after a verified restore; positive synthetic
files and changed contents prove it can also observe real canonical state.

## Scope and constraints

- Three hosted-local E2E readers, one shared test helper and focused synthetic proof.
- Delete legacy bundle/artifact fetch and restore walkers.
- No production behavior, providers, deployment, admission or uploader changes.
- Require hosted-local MinIO and a loopback Web endpoint; canonical R2 validation
  retains explicit Docker bridge support. No production secrets or live reads.
- Reuse existing Frog entry `20260910204328-hosted-local-e2e`; this is the same
  test snapshot protocol mismatch, now on the assertion side.

## Verification and completion

1. Exercise real tar/zstd/AES-GCM construction, wrapping, parsing and restore with
   synthetic signed envelope/HTTP boundaries; prove content, tamper rejection,
   local/member boundaries, missing metadata and cleanup on callback failure.
2. Run focused Cloudflare Node suites and Cloudflare typecheck with one heavy
   command at a time, then docs drift, complexity diff and whitespace checks.
3. Review scoped diff and privacy, close this plan, commit, push and open a draft
   PR. Parent owns candidate review, Ready, ReviewGPT, CI and merge decisions.

## Results

- `pnpm install --frozen-lockfile` passed without lockfile changes.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/helpers/hosted-local-workspace-snapshot-restore.test.ts --maxWorkers=1` passed all 24 cases with actual encrypted archives.
- `pnpm --dir apps/cloudflare typecheck` passed. An initial missing-environment
  test fixture lacked its required nullable property; the corrected fixture and
  final typecheck both passed.
- `pnpm complexity:diff --base 1898658cc5b47f66d423eed67f72a3828376621f` passed;
  the source ratchet excludes these test-only files.
- `git diff --check` passed. Documentation drift required indexing the updated
  testing owner; the index now names the canonical assertion readers and
  `pnpm docs:drift` passed.
- Scoped independent reader review found no blocking correctness gaps.
- Full hosted-local stacks and live-model journeys were not run; these require
  their separate CI/hosted evidence and are outside this synthetic reader proof.
- Parent retains candidate review and final PR gate ownership.
Completed: 2026-09-10
