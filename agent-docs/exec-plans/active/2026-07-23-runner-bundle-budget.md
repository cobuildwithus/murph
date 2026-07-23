# Update runner bundle total byte budget

Status: active
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- Restore fresh local and deploy runner-bundle assembly by advancing the total
  byte ceiling to the current clean packaged measurement plus the existing
  32 KiB reviewed-addition allowance.

## Success criteria

- Fresh runner-bundle assembly accepts the measured 9,451,152-byte output.
- The total ceiling remains a fixed, test-locked value with exactly 32 KiB of
  headroom.
- Entry-chunk and static-closure guards remain unchanged.
- Focused bundle tests, diff-routed verification, and acceptance verification
  pass.

## Scope

- In scope: the runner entrypoint total byte budget, its policy comment, and
  the matching unit-test expectation.
- Out of scope: changing bundle contents, loosening entry/static guards,
  dependencies, runtime behavior, deployment, or generated bundle artifacts.

## Constraints

- Technical constraints: preserve the exact measured-plus-32-KiB policy and
  keep the existing source of truth.
- Product/process constraints: use an isolated worktree and PR lane; preserve
  the non-exclusive runner-bundle dependency-prune lane.

## Risks and mitigations

1. Risk: an arbitrary ceiling increase could hide future boot-graph creep.
   Mitigation: derive the new value from a fresh exact measurement and retain
   only the documented 32 KiB allowance.
2. Risk: platform variance could invalidate the local measurement.
   Mitigation: leave the separate entry/static platform-jitter tolerances
   unchanged and require CI plus the final ReviewGPT gate.

## Tasks

1. Record and verify the clean packaged bundle measurement.
2. Advance only the total budget and its locked test expectation.
3. Run focused, diff-routed, and acceptance verification.
4. Complete the required preliminary specialist and final ReviewGPT PR gates.

## Decisions

- Use 9,483,920 bytes: 9,451,152 measured bytes plus 32,768 bytes.
- A second clean assembly measured 9,437,124 bytes; retain the higher reset
  measurement as the ratchet basis so the command that exposed the regression
  remains covered across observed local emit variance.
- Cloudflare's current image-management documentation confirms Wrangler builds
  and pushes the configured container image; the byte ceiling remains a
  repository-owned cold-start guard rather than a platform upload limit.

## Verification

- Commands to run:
  - focused runner entrypoint bundle test
  - fresh runner bundle assembly
  - `pnpm test:diff`
  - `pnpm verify:acceptance`
- Expected outcomes: the exact fresh bundle remains under all three guards and
  all routed checks pass.
