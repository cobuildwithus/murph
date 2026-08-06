# Release secret-boundary hardening

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Remove stale production capabilities from the public GitHub repository without
  changing deployed runtime configuration, then make public package and release
  publication fail closed if a future tarball contains credential material or a
  sensitive credential file.

## Success criteria

- The public production environment retains only the two secrets used by its
  hosted-web contract-migration workflow; private production deploys retain the
  migrated secret set and continue to own Render and Cloudflare deployment.
- The public Preview environment is limited to protected branches until its
  staging values can be migrated privately without exposing plaintext.
- GitHub provider, non-provider, validity, AI, and push-protection scanning are
  enabled, and the verified synthetic webhook alert is resolved as test-only.
- Every final npm tarball is checked after packing and again before npm publish;
  GitHub Release creation checks the downloaded tarballs before upload.
- The artifact guard rejects sensitive filenames, complete private-key blocks,
  credential-bearing connection URLs, provider tokens, and secret-assignment
  shapes while keeping known public package contents green.
- Release handoff artifacts expire after one day, while permanent npm and
  GitHub Release assets remain unchanged.
- Focused tests, exact-head CI, preliminary coverage review, final ReviewGPT,
  and parent final review have no unresolved findings.

## Scope

- In scope: public/private GitHub environment ownership verification, public
  environment cleanup, GitHub scanning settings, the release tarball guard,
  guard coverage, release workflow wiring, artifact retention, and matching
  security/verification documentation.
- Out of scope: rotating live provider credentials without exposure evidence,
  changing deployed Cloudflare/Vercel/Render runtime values, rewriting public
  Git history, and deleting historical Actions artifacts without an exact
  retention owner.

## Constraints

- Do not read, print, download, or persist secret values.
- Do not alter the private Render hook value or trigger a production deploy.
- Keep publication on the existing pack manifest and tarball ownership path;
  add no dependency or parallel packaging system.
- Preserve unrelated changes in the primary checkout and work only in the
  isolated task worktree.

## Risks and mitigations

1. Risk: deleting a GitHub environment secret breaks a future deployment.
   Mitigation: delete only public copies whose private counterparts exist and
   whose private deployment path has succeeded after migration; retain both
   secrets referenced by the current public workflow.
2. Risk: an overly broad artifact scanner blocks legitimate source code.
   Mitigation: detect complete credential shapes rather than parser literals,
   cover accepted and rejected fixtures, and run the guard against real packed
   release artifacts.
3. Risk: a workflow-only check can be bypassed by another publisher.
   Mitigation: enforce the guard inside the pack and publish owners, then add an
   explicit GitHub Release pre-upload check for the action-owned release path.

## Tasks

1. Verify environment sets, workflow references, and successful private deploys;
   apply the public GitHub cleanup and read back the exact post-state.
2. Implement the release artifact scanner at the existing pack/publish boundary
   with focused positive and negative tests.
3. Wire the GitHub Release pre-upload check and one-day handoff retention; align
   security and verification docs.
4. Run focused local proof, pack real tarballs, and inspect the complete diff.
5. Commit, push, open the PR, run preliminary ReviewGPT and final ReviewGPT with
   CI, resolve accepted findings, and complete parent final review.

## Decisions

- Remove the public Render hook copy but do not rotate the live hook: encrypted
  storage in the wrong repository was a scope violation, not plaintext exposure,
  and private post-migration deploy evidence proves the retained owner works.
- Restrict Preview rather than deleting it because the private preview
  environment has not yet received the staging values.
- Use a dependency-free Node guard over final tarballs rather than adding a
  third-party scanner dependency to the release trust path.

## Verification

- Focused guard tests and syntax checks for all touched release scripts.
- A real `pack-publishables` run followed by artifact-guard verification.
- `pnpm test:diff` over the changed scripts, workflow, and durable docs when it
  remains the smallest truthful local lane.
- Exact-head GitHub Actions, preliminary ReviewGPT coverage lens, final
  ReviewGPT security/trust-boundary gate, and parent final review.

## Verification log

- Public production secrets reduced from 40 to the two current hosted-web
  migration secrets; private production remains at 32 secrets.
- Private Render and Cloudflare deployment workflows had successful runs after
  the July migration and before cleanup.
- Public Preview now permits protected branches only.
- Secret scanning, push protection, non-provider patterns, validity checks, and
  AI detection all read back enabled.
- The sole synthetic webhook alert reads back resolved as `used_in_tests`.
- Focused scanner coverage passes with eight accepted/rejected fixture cases,
  including secret-safe error reporting and archive-link rejection.
- The clean workspace build and diff-scoped tooling lane pass; the latter ran
  31 repo-tool files and 469 tests.
- All five real 1.3.0 npm tarballs pass both the pack-owner scan and a separate
  manifest-driven scan of the completed artifact inventory.
