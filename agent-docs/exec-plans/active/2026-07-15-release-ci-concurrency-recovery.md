# Release CI concurrency recovery

Status: active
Created: 2026-07-15
Updated: 2026-07-15

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

## Scope

- Replace the ambiguous shell expression with an explicit single-value resolver.
- Add focused regression coverage for all default-selection branches.
- Make the existing Clinical Records resume test preempt deterministically after its first
  provider page is checkpointed; the official release gate exposed its call-count/timer race.
- Leave the failed immutable `v1.2.1` tag as historical evidence and cut the corrected release as `v1.2.2`.

## Verification and completion

- Run the focused workspace-verifier test and shell syntax check.
- Run the routed coverage-bearing verification, required audits, and parent final review.
- Run the official release gate and exact tarball smoke before pushing the corrected release.
- Monitor the trusted publish workflow, verify all package versions on npm, and reinstall/start both CLIs from the registry.
