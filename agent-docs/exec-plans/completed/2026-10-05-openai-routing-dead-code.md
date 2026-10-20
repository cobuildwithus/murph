# Delete dead OpenAI routing auth fields, catalog generator, and checkout

Status: completed
Created: 2026-10-05
Updated: 2026-10-05

## Goal

- Remove OpenAI routing code that can no longer affect behavior, and make the
  pinned Codex source check cheaper without weakening it.

## Evidence

- `providerEgressTokenPresent` and `runtimeAuthorityHeadersPresent` on
  `HostedProviderEgressAuthorization` are hard-coded `false` at every
  construction site since native authority replaced legacy tokens and headers.
  The deploy-smoke guard therefore only ever checks `userId`, and egress
  diagnostics publish two constant fields. The real header-presence fields in
  other logs are separate and unchanged.
- `verify-codex-upstream-source.ts` checked out the whole tag (about 19 MB of
  blobs, about 14 seconds locally) and separately compared a tree hash that the
  verified commit already pins. An index-only `git apply --cached --check`
  fetches only the patched blobs (about 2 MB, about 7 seconds) and still
  rejects a corrupted patch.
- The hosted-local harness ran the host `codex debug models --bundled`
  command and passed the resulting catalog path to the Worker. The container env
  builders deny that variable, and the image's Dockerfile `ENV` owns the
  catalog, so the generated file had no reader.

## Success criteria

- No constant authorization fields remain. Deploy-smoke authorization behaves
  identically.
- The source verifier still proves tag, commit, patch applicability, and
  reviewed paths, and is faster.
- Hosted-local no longer requires a host `codex` binary or writes a catalog,
  and still strips inherited catalog values.

## Scope

- In scope: the three deletions, related tests, fixture, and gate wording.
- Out of scope: provider egress policy, Codex patch content, and
  `testing-ci-map.md`, which #4022 edits and whose wording remains accurate.

## Risks and mitigations

1. Risk: a non-Docker hosted-local runner consumed the generated catalog.
   Mitigation: every reader is a container process; both container env builders
   deny the variable, and a test pins that.

## Tasks

1. Apply the deletions and the verifier change; update tests and docs.
2. Verify, review, commit, open the PR, and complete the review loop.

## Decisions

- Keep stripping inherited catalog values in hosted-local; only stop adding one.

## Verification

- Egress intercept, Codex conformance, runner env policy, and container image
  contract suites: 257 passed.
- Hosted-local stack: 88 passed. The pull-request CI policy test passed 25.
- Typechecks passed for Cloudflare and hosted-local-harness.
- The source verifier passed in 6.95 seconds. A corrupted patch failed the
  index-only check.
- The complexity diff passed: stack.ts debt 103 to 101, verifier maximum
  9 to 8.
Completed: 2026-10-05
