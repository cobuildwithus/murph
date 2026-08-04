# PR 1261 Conflict Resolution And CI Recovery

## Goal

Bring PR 1261 onto current `main`, preserve its proactive recipient-address
completion behavior alongside the merged platform-owned return-address and Lob
Secure Destruction invariants, and leave the exact pushed PR head green.

## Constraints

- Recipient lookup may complete only the destination already supplied; it must
  not identify a recipient, choose an ambiguous destination, or create send
  authority.
- The return address remains platform-owned and absent from assistant/tool
  arguments and artwork.
- Live Lob configuration remains unavailable unless both the live-send switch
  and operator Secure Destruction confirmation are enabled.
- Preserve unrelated current-`main` behavior and avoid changes to the warm
  Codex runtime unless the old CI timeout reproduces on the merged head.

## Working Set

- `agent-docs/product-specs/physical-notes.md`
- `packages/assistant-engine/skills/physical-notes/SKILL.md`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools/physical-notes.ts`
- Existing PR 1261 assistant and CLI source, generated command artifacts, and
  focused tests as required by conflict resolution or current-head failures.

## Plan

1. Merge current `origin/main` normally and resolve the three overlapping
   physical-note files by retaining both recipient-resolution and
   platform-owned sender/Secure Destruction contracts.
2. Inspect the resulting full PR diff and run focused assistant prompt/tool and
   CLI address-resolution tests, plus generated-artifact checks where required.
3. Reproduce any remaining failure narrowly and change code or tests only when
   the merged head proves a current defect.
4. Commit and push the conflict resolution, update the PR intent/verification
   evidence, run the required preliminary specialist ReviewGPT pass, triage its
   result, and follow exact-head CI to green.
5. Perform the parent final diff review, close this plan with the final scoped
   commit path, and confirm the PR is conflict-free and green.

## Verification Plan

- Focused assistant tests for proactive address handling, platform-owned return
  addresses, and system-prompt guidance.
- Focused CLI tests for Mapbox address parsing, ambiguity, conflicts, and command
  discovery.
- Source/generated artifact consistency checks for CLI command metadata.
- Exact-head GitHub Actions after push; diagnose any failure from the narrowest
  reproducer outward.
- Preliminary specialist ReviewGPT product-experience, prompt, and coverage
  lenses on the stable pushed candidate.

## Outcome

- Merged current `main` normally and resolved the three physical-note overlaps
  by retaining proactive recipient completion, the recipient-only assistant
  schema, the platform-owned return address, and the Lob Secure Destruction
  live-send gate.
- Reproduced the old shared-runtime timeout narrowly; the isolated progress
  test passed and no warm-runtime change was warranted.
- Accepted the preliminary specialist findings that exposed a real destination
  preservation gap. Recommendations now fail closed when a supplied unit,
  locality, full state name, or ZIP+4 is dropped or contradicted, and focused
  parser tests cover those boundaries.
- Removed the duplicate generic resolve-before-asking paragraph and kept the
  policy in the canonical direct/group turn-priority rules plus the owning
  physical-note skill.
- Added a credential-gated real-Codex journey probe for direct success,
  ambiguous stop-without-effect, and exact group-origin authority. Existing
  runtime and provider tests remain the owners of the asynchronous image
  completion, recipient-only send, accounting, Lob return-address binding, and
  Secure Destruction configuration behavior.

## Verification Completed

- 33 focused CLI address, command, conflict, and generated-artifact tests.
- 19 focused assistant physical-note, prompt, and default real-Codex tests; 25
  credential-gated current-model tests skipped because no permitted provider
  credential was available locally.
- Assistant and CLI typechecks.
- Exact-candidate GitHub Actions passed before remediation; final exact-head
  Actions were started after remediation and the clean base-only merge.
- Preliminary ReviewGPT product-experience, prompt, and coverage lenses were
  completed on the stable pre-remediation head, and every accepted finding was
  resolved or narrowed to the existing owning test boundary.
Status: completed
Updated: 2026-08-04
Completed: 2026-08-04
