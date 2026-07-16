# Release CI concurrency recovery

Status: completed
Created: 2026-07-15
Updated: 2026-07-16

## Goal

- Restore the trusted npm release gate after the failed `v1.2.1` workflow and publish a verified follow-up patch.

## Success criteria

- CI package-coverage concurrency resolves to exactly one positive integer.
- Focused shell and test proof covers CI, shared-host, and local defaults.
- The official release gate passes locally and in the trusted GitHub workflow.
- Exact candidate tarballs pass pre-publish install/startup checks, then the public npm packages pass a fresh registry install/startup check.

## Proven root cause

- In CI, the `&&`/`||` chain used to derive `package_coverage_concurrency_default` emitted both `1` and `2` because Bash evaluates those operators with equal precedence from left to right.
- The resulting `1\n2` value failed numeric comparisons inside the package-coverage refill loop, which then spun without launching work and produced an unbounded log.
- The failed workflow was canceled before package packing, GitHub release creation, or npm publication; all public packages remained at `1.2.0`.
- The follow-up `v1.2.2` trusted gate reached assistant-engine coverage but its
  sole Vitest worker exhausted Node's default 4 GB heap. The regular
  host-support coverage workflow already bounded that known suite at 6 GB, but
  the release workflow omitted the same allowance. Packing and both publish
  jobs remained blocked.

## Scope

- Replace the ambiguous shell expression with an explicit single-value resolver.
- Add focused regression coverage for all default-selection branches.
- Make the existing Clinical Records resume test preempt deterministically after its first
  provider page is checkpointed; the official release gate exposed its call-count/timer race.
- Give the serialized release-check step the same bounded 6 GB Node heap already
  required by assistant-engine coverage in the regular trusted workflow, and
  guard that release configuration with a focused test.
- Leave the failed immutable `v1.2.1` and `v1.2.2` tags as historical evidence
  and cut the corrected release as `v1.2.3`.

## Verification and completion

- Run the focused workspace-verifier test and shell syntax check.
- Run the routed coverage-bearing verification, required audits, and parent final review.
- Run the official release gate and exact tarball smoke before pushing the corrected release.
- Monitor the trusted publish workflow, verify all package versions on npm, and reinstall/start both CLIs from the registry.

## Outcome and evidence

- Replaced the ambiguous CI concurrency expression with a single-value resolver and
  added focused coverage for the CI, shared-host, and local branches.
- Made the Clinical Records preemption-resume test deterministic with fake timers and
  a semantic checkpoint predicate.
- Bounded the release-check Node heap at 6 GB and added a workflow guard proving the
  setting remains scoped to the release-check step.
- The exact CI-style local release gate passed, including all package-owner coverage,
  434 web test files with 5,269 passing tests, 106 Cloudflare test files with 1,836
  passing tests, the web production build, lint, and the local dev startup smoke.
- Required coverage-write and deep-review passes completed with no remaining
  actionable findings.
- Exact `v1.2.3` candidate tarballs installed together in a blank consumer; all five
  public package roots imported and both packaged CLIs started before the tag was
  pushed.
- The trusted [v1.2.3 release workflow](https://github.com/cobuildwithus/murph/actions/runs/29471258198)
  completed successfully. Its release-check step ran for about 38 minutes, passing
  well beyond the `v1.2.2` heap-failure boundary, then packed and published all five
  packages.
- All five packages report `1.2.3` as npm `latest`. A second blank-consumer install
  from npm passed the same manifest, public-root import, and two-CLI startup smoke.
- The [v1.2.3 GitHub release](https://github.com/cobuildwithus/murph/releases/tag/v1.2.3)
  is final (not a draft or prerelease) and contains all five tarballs.
- The immutable `v1.2.1` and `v1.2.2` failures remain as evidence; both stopped before
  npm publication, so no partial public version was created.
Completed: 2026-07-16
