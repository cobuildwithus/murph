# Garmin Junction Canary

Status: completed
Created: 2026-08-22

## Goal

Replace the blocked WHOOP login used by the protected Junction wearable canary with Garmin credentials while preserving the existing Kernel-backed browser path and keeping the harness provider-generic.

## Success criteria

- The live harness accepts Garmin as a Junction wearable source and keeps credentials isolated to the device-connect child process.
- The protected scheduled workflow uses Garmin-specific member and secret names.
- Focused tests and typechecking pass.
- Required ReviewGPT rounds and GitHub checks pass on the exact PR head.
- A protected live Garmin canary completes successfully after merge.

## Scope and constraints

- No production device-sync or member-facing behavior changes.
- No new dependency or browser abstraction.
- Preserve existing Oura and WHOOP harness support.
- Never expose provider credentials or environment-file contents.

## Tasks

- [x] Provision Garmin credentials in the protected GitHub Environment.
- [x] Extend the live browser harness and secret isolation for Garmin.
- [x] Point the scheduled Junction canary workflow at Garmin.
- [x] Add focused coverage and align durable operational documentation.
- [x] Run focused verification and inspect the candidate diff.
- [ ] Open the PR and complete ReviewGPT plus required CI.
- [ ] Merge, run the protected live canary, and retire the worktree.

## Verification

- Focused Vitest coverage for the browser runner, Cloudflare live test, harness isolation, and workflow contract.
- Relevant workspace typechecks.
- Required GitHub checks on the exact pushed PR head.
- Protected `workflow_dispatch` execution after merge.
Updated: 2026-08-22
Completed: 2026-08-22
