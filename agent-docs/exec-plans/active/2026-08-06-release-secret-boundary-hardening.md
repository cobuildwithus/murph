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
4. Risk: release callers that use an external output directory regress.
   Mitigation: retain repository-relative manifest entries for `.tgz` files in
   one exact inventory, accept the established external destination, and prove
   it through the prepared real-release CLI test.

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
- Keep generic assignment detection syntax-scoped and value-authoritative.
  Allow only exact public metadata/placeholders and explicit source
  interpolation or environment-reference syntax. Preserve the required patched
  `incur` bundle and its runtime/source entrypoints, but omit the three proven
  non-runtime upstream test sources instead of weakening scanner policy for
  their paths or contents. When later inventory found additional upstream test
  sources, generalize that payload rule to omit every `incur` test source while
  keeping its runtime and source entrypoints.

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
- Focused scanner coverage passes with 17 accepted/rejected fixture cases,
  including Basic auth, unquoted assignments, external outputs, secret-safe
  path/tarball reporting, archive-link rejection, shell terminators/comments,
  JWT-shaped values, and declaration-only `.d.ts` syntax.
- The clean workspace build and diff-scoped tooling lane pass; the latter ran
  31 repo-tool files and 469 tests.
- All five real 1.3.0 npm tarballs pass both the pack-owner scan and a separate
  manifest-driven scan of the completed artifact inventory.
- The existing prepared-runtime CLI release test passes with its generated
  manifest and all five tarballs outside the checkout; the release workflow
  owner test passes with guard ordering and one-day retention assertions.
- The remediation diff-scoped lane passes: 31 repo-tool files with 469 tests,
  CLI typecheck, and 118 CLI files with 1,112 passing tests and one skip.
- Preliminary ReviewGPT accepted three findings: unquoted assignment coverage,
  credential-bearing archive-path redaction, and explicit publication-owner
  ordering coverage. Final ReviewGPT round 1 accepted three findings: preserve
  external output support, replace broad shape/placeholder exemptions with
  syntax-scoped authoritative checks, and redact tarball/path diagnostics.
  Each accepted finding was implemented for final round 2 on the pushed
  remediation head.
- Final ReviewGPT round 2 required a retrospective after production-shaped
  reproductions proved shell terminators/comments, JWT-shaped values, and a
  credential-bearing archive segment still reached repeated mechanisms. The
  recorded decision redesigns the same shared guard: opaque values are
  authoritative, public exceptions are exact, all artifact names are hidden by
  default, and path segments are scanned individually. The first attempt to
  remove bundled `incur` failed the existing package-shape invariant proving its
  patched runtime requirement. The round-2 correction temporarily preserved
  the three source-test files behind exact full-file digests; round 3 proved
  those tests are not runtime payload and the final design omits them while
  retaining `incur` runtime and source entrypoints. The correction also deletes
  conditional redaction and broad dotted-reference concepts.
- The corrected design passes fresh five-package packing/scanning, standalone
  five-tarball scanning, CLI package-shape verification, the external-output
  installed-contract test, the publication-owner test, and the complete
  diff-scoped lane again (31 repo-tool files / 469 tests, CLI typecheck, and 118
  CLI files / 1,112 passing tests with one skip).
- Final ReviewGPT round 3 accepted the remaining assignment-mechanism gap for
  command-prefixed shell syntax and declaration-file equals assignments, the
  original gap for common authorization/parameter/camel-case serializations,
  and the simplification of the `incur` fixture exception. Production-shaped
  reproductions confirmed all three. The correction uses one shared
  credential-key classifier, scans quoted code literals plus shell/config
  tokens according to their syntax, omits only the three non-runtime upstream
  tests, and removes tarball names from pack/publish command logs. Focused guard
  tests, a fresh five-tarball scan, CLI package-shape verification, and the
  prepared installed-CLI proof pass; the packed `incur` runtime/source
  entrypoints remain present while the three test sources are absent.
- After current `main` added assistant image-continuation behavior, the branch
  merged that base and aligned the affected CLI assertions with the new
  explicit nullable session contract. The focused assistant-engine and CLI
  continuation suites and the exact-head GitHub checks pass.
- Final ReviewGPT round 4 accepted a remaining release-boundary gap for
  repo-native credential holders, short Basic credentials, and quoted
  setter/tuple parameters. It also identified the generic npm failure message
  as a local tarball-path disclosure. The correction extends the shared exact
  credential-key classifier, treats literal Bearer/Basic values independently,
  covers setter/append/tuple parameters, removes every non-runtime `incur` test
  source from the payload, and makes generic publication errors path-free while
  preserving normal npm output. The focused guard suite passes 17/17, the
  release workflow guard passes 5/5, CLI typecheck passes, and both a clean
  five-package pack and a separate exact-manifest scan pass all five tarballs.
- Final ReviewGPT round 5 accepted two incomplete parts of the round-4
  correction: lowercase or mixed-case schemes in an explicit Authorization
  context were no longer covered, and separator/camel-case names ending in
  `credential` were not treated like names ending in `secret` or `token`. The
  correction keeps standalone matching case-sensitive for prose safety, adds a
  case-insensitive matcher scoped to an explicit Authorization key, and extends
  the shared key classifier with `credential`/`credentials` terminals. Valid
  TypeScript type-alias declarations are excluded from executable-assignment
  handling while invalid declaration-file assignments remain covered. Direct
  reproductions now fail closed, environment references and harmless prose
  remain accepted, the focused suite passes 17/17, and all five completed
  release tarballs pass the exact final scanner.
- Final ReviewGPT round 6 accepted repository-owned opaque authority holders
  that still fell outside the shared classifier: auth JSON, HMAC/encryption/
  fingerprint/root/routing/privacy keys, private JWK/key material, and plural
  execution-control tokens. The correction extends the existing component
  policy for those proven semantics without decoding values or adding another
  scanner. Plural token metrics remain public data; only control-token
  containers are classified. Exact public root labels remain enumerated. The
  direct and complete-tarball cases fail closed for every reproduced authority,
  reference/placeholder cases remain accepted, the focused suite passes 17/17,
  and the fresh five-package inventory passes the exact updated scanner.
- Final ReviewGPT round 7 accepted two remaining publication bypasses: the
  repository's supported Temporal client private-key holders end in the
  representation suffix `BASE64`, and quoted or curl-style `X-API-Key` headers
  were outside the structured assignment grammar. The correction strips only
  terminal `base64`/`pem` representation components for classification and
  routes one quoted serialized-header matcher through the same key/literal
  policy. Temporal certificate holders, explicit environment references,
  exact placeholders, and harmless header-name prose remain public. The first
  real five-package scan exposed the documented `Bearer <token>` placeholder;
  that exact placeholder was enumerated and the complete inventory then passed.
  On the latest merged `main`, the focused suite passes 21/21, the two release
  owner files pass 46 tests with one intentional skip, CLI typecheck and package
  shape pass, the clean workspace build passes, and both the fresh pack-owner
  scan and standalone manifest scan pass all five tarballs.
- Round 7 is the configured substantive-round cap. Its findings are resolved in
  the candidate, but a further final-gate round requires an explicit continuation
  decision; keep this plan active until that decision and a final PASS.
