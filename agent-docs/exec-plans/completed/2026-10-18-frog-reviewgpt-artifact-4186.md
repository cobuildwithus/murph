# Adopt ReviewGPT artifact identity repair

Status: completed
Created: 2026-10-18
Updated: 2026-10-18

## Goal

Install the reviewed ReviewGPT repair so an exact assistant artifact download
cannot report an unrelated concurrent browser download as success.

## Success criteria

- Upstream source review and merge are verified, then the published package
  matches the audited release source and registry integrity.
- Murph pins the released version, preserves its existing dependency patch,
  and retains narrow supply-chain exceptions and the locked dependency graph.
- Synthetic installed-package tests reject unrelated native and estuary
  downloads while preserving valid artifact downloads and capture validation.
- Exact-head ReviewGPT, required CI, and final review pass before adoption lands.

## Scope

- Adopt the upstream artifact selection fix for Frog #4186 and the previously
  reviewed service-block reporting fix already merged upstream.
- Preserve current Murph-specific ReviewGPT patch behavior.
- No product runtime, credentials, production deployment, review gate bypass,
  or unrelated dependency changes.

## Constraints

Use the supported release and registry installation paths. Keep existing capture,
model, privacy, authentication, and supply-chain boundaries. Preserve primary
checkout work and use the assigned isolated checkout.

## Risks and mitigations

- Concurrent native and estuary downloads can claim the first completion event.
  Upstream regressions exercise wrong-file races with exact capture metadata.
- Dependency patch rebasing can change unrelated behavior. Compare patch bytes,
  inspect the installed output, and retain upstream and consumer regression proof.
- A source merge alone does not repair the installed tool. Verify publication,
  package contents, installation, and consumer merge before issue closure.

## Tasks

1. Complete upstream source review and verify the merge.
2. Audit and publish the supported patch release with upstream sync disabled.
3. Update the exact consumer pin, patch mapping, narrow exceptions, and lockfile.
4. Run installed regressions and supply-chain checks; audit the candidate.
5. Complete the consumer PR review and required CI, merge, verify, and close #4186.

## Decisions

- The authoritative fix is upstream in `cobuildwithus/review-gpt` PR #20;
  source head `9321208ddf7c2884233752ada8e1b780923bbfd6` passed its third review
  and merged as `f0dad42205e66fcde25bf74cd06a4b18d1d58929`.
- The first review identified a supported semantic-control filename regression.
  After explicit user resumption, the correction derives only the semantic
  filename and preserves exact capture and activation identity.
- The second review exposed descriptive controls without file identity. The user
  explicitly chose early, clear rejection before activation or writes. Named,
  semantic, explicit download-attribute and exact blob/data URL paths remain
  supported. The final correction implements that compatibility decision.
- The existing committed Frog report remains the issue-to-defect record:
  `.agents/friction-log/20261018123830-reviewgpt-exact-artifact/friction.md`.
- Member-facing changelog is not applicable: this changes internal review tooling.
- Complexity metrics are not applicable to a dependency/lockfile and plan update;
  upstream implementation complexity is reviewed with the source PR.

## Verification

- Upstream: 410 tests and typecheck pass; native and estuary regressions fail
  against the original implementation. Independent candidate and remediation audits passed.
- Consumer baseline: frozen install of 0.5.153, then the same isolated synthetic
  exact-capture scenarios against the installed dependency.
- Release 0.5.154: trusted publication succeeded at release commit
  `e6d5aad9a126c40412b1d0a2d86efae37faa367a`. Registry integrity and all 41
  package members match the independently audited source and pinned build.
  The registry omits gitHead; the workflow and exact file bytes establish source.
- Consumer: frozen install passes; 28 installed-package artifact regressions
  pass, and all 41 installed files equal the registry package plus the unchanged
  existing patch. No unrelated dependency graph changes remain.
- `pnpm deps:guard` passes. `pnpm deps:audit` reports 201 existing advisories
  (16 low, 91 moderate, 83 high, 11 critical); the baseline and candidate have
  identical advisory content, affected paths, and dependency counts.
- `pnpm deps:ignored-builds` could not report an inventory. All installation
  commands explicitly disabled lifecycle scripts; no build approval was added.
- Canonical dependency-source packaging, exact-head consumer review, and required
  CI remain PR completion gates.
Completed: 2026-10-18
