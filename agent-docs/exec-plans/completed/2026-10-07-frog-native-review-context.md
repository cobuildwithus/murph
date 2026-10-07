# Include pinned native Codex source in review context

Status: completed
Created: 2026-10-07
Updated: 2026-10-07

## Goal and invariant

Make the guarded PR snapshot expose complete patched Codex native modules and their direct transport/recovery owners for Frog #4050 (duplicate #4052). Preserve exact-head authority and all existing review gates; never execute fetched code or read local native build output.

## Ownership and evidence

Murph owns the custom `package-audit-context-full.sh` PR packaging hook. It currently expands ReviewGPT dependency patches but includes the native patch only as hunks. Both bot reports have identical committed report, revision, and occurrence fingerprints. The authoritative report was committed in PR #4022.

## Design

Extend that existing hook only when the PR changes the native patch. Read the patch, image source commit, and package version from the reviewed Git head; fetch the fixed official upstream tag, verify its exact commit, and apply the patch to an isolated index. Append bounded complete text postimages and a short explicit owner list through the current context ZIP append path. Record hashes and omitted binary paths. Scratch state stays inside invocation-owned storage and is removed on completion or failure.

## Risks

Network or pin mismatch must fail packaging with a safe diagnostic, never silently omit source. Only regular safe native source paths are exported. No production source, dependencies, credentials, deployment, or generic ReviewGPT code changes.

## Tasks

1. Add and exercise the native context builder and existing packager integration.
2. Prove exact committed input, patched postimages, source identity, safe files, cleanup, and ZIP contents with synthetic Git fixtures plus current pinned source.
3. Run focused tests/typecheck/complexity and parent review; finish the plan and open a scoped PR.
4. Complete final ReviewGPT and required CI before authorized low-risk landing and matched closure.

## Verification

- Nine native-context regressions pass, including the actual shell packaging hook, real native builder, and final ZIP append with synthetic Git/PR/network boundaries. Existing dependency-context tests also pass (11 cases).
- Focused TypeScript, shell syntax, docs drift, diff whitespace, and complexity checks pass (maximum 12, no debt).
- Actual official pinned Codex 0.160.0 source proof exported 44 text files (2,073,445 bytes), verified every SHA-256, and explicitly omitted the generated compressed schema. No upstream code executed.
- Parent candidate review passed and confirmed the current verifier has no reusable exact-head source-tree API; no unrelated verifier refactor is needed.
- Final ReviewGPT round 1 passed on `364a37923c9e10d0b89d00d47c01ac619e0b72d5` with no findings. The reviewer independently traced exact-head inputs and ran synthetic Git/shell probes through packet composition.
- The original uploaded snapshot, exact response identity, and timing evidence were retained for parent review. Required exact-head CI remains a landing gate. No native Codex process or live model journey ran.
Completed: 2026-10-07
