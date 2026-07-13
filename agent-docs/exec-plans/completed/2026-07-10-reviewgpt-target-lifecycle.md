# ReviewGPT Target Lifecycle Repair

## Goal

Prevent the managed Eragon, Phlebas, and Mountain browser lanes from accumulating automation-owned ChatGPT targets after waited ReviewGPT runs. Success means each waited run closes only the exact target it created on success, failure, timeout, and retry, while draft-only and send-without-wait runs retain their user-facing target.

## Constraints

- Do not delete browser profile data, history, sessions, or user-created tabs.
- Do not signal or terminate any process not started by this task.
- Do not launch a ReviewGPT browser round until the user grants the recovery gate explicitly.
- Preserve unrelated dirty work in the main checkout and the sibling ReviewGPT repository.
- Keep the correction narrow: patch the package-owned lifecycle instead of adding a separate cleanup service or broad tab sweep.

## Root-cause evidence

- The affected managed apps use separate Brave profiles and remote-debugging ports, but their on-disk profiles are small relative to the reported memory growth.
- Saved session metadata contains hundreds of ChatGPT target records on the most affected lanes.
- ReviewGPT creates a fresh target with `Target.createTarget` on every run, pins it active for response capture, and never issues `Target.closeTarget`.
- Clearing browser history/data does not repair that runtime ownership leak. The latest published package, 0.5.103, still lacks target cleanup.

## Plan

1. Upgrade to the current ReviewGPT package and apply a narrow pnpm patch at the target owner boundary.
2. Close invisible or failed-connection targets immediately, and close waited targets in the main lifecycle `finally` path.
3. Retain draft-only and send-without-wait targets intentionally and document that contract.
4. Add focused repository coverage that proves the installed patch and exact-target ownership rules remain wired.
5. Run required dependency, focused, diff/typecheck, audit, and final-head verification without launching a browser round.
6. Publish a scoped PR, resolve non-browser review and CI findings, then stop at the explicit recovery ReviewGPT gate.

## Verification

- Installed driver syntax check
- Focused CLI release-script coverage audit
- `pnpm test:diff` for the touched dependency/config/test/doc surface
- Dependency policy and ignored-build checks
- Dependency audit, with unrelated pre-existing advisories reported separately
- Required `security-privacy-review` and `coverage-write` audit passes
- Parent final diff/call-path review and final-head CI verification

## State

Ready to close. Root cause proven; the exact-target lifecycle patch is reconstructed on the current base. Frozen dependency installation, installed-driver syntax, dependency policy checks, the focused 27-test CLI audit, and the full affected `test:diff` lane pass. The required security/privacy audit found no medium-or-higher findings, and the coverage-write audit found the existing installed-driver proof sufficient without edits. Live managed-browser proof remains intentionally deferred behind the explicit recovery gate.
Status: completed
Updated: 2026-07-11
Completed: 2026-07-11
