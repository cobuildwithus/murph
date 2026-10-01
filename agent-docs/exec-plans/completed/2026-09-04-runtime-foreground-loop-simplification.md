# Simplify hosted runtime foreground continuation loop

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

Collapse duplicated initial-pass and rerun orchestration into one foreground loop, preserving observable behavior and existing runtime ownership.

## Success criteria

- One pass body and one continuation decision, with lower aggregate complexity.
- Initial provider metadata stays first-pass-only; reruns retain only their intended import context.
- Image completion staging, foreground priority, shutdown, retry and budget gates retain their ordering.
- Focused runtime tests and package typecheck pass; parent reviews the candidate before Ready and the requested final ReviewGPT.

## Scope

- In scope: runForegroundPass in hosted-runtime.ts and focused existing runtime proof.
- Out of scope: prompts, tools, platform protocols, checkpoint state ownership, other agents' files and existing PR branches.

## Product UX

Internal behavior-preserving refactor; no new product promise. Replay existing synthetic late-input, image-completion, causal-continuation, owner-handoff and shutdown scenarios. No provider input or user-visible prose changes are intended; deterministic runtime effect ordering is the acceptance boundary.

## Risks and mitigations

- Initial and subsequent passes intentionally have different metadata. Keep explicit initial input and explicit next-pass construction.
- Shutdown or owner handoff must stop further passes after staging completed images. Preserve this order and prove existing tests.

## Tasks

1. Inspect owner and overlapping PR hunks; record the bounded collapse.
2. Replace the duplicated loop mechanics and inspect the semantic diff.
3. Run focused checks, measure complexity, and submit exact candidate for parent review.
4. Commit, open draft PR, enter Ready after parent clearance, and run ReviewGPT concurrently with CI.

## Decisions

- The parent approved this narrow collapse. No new module, dependency, persistent state or abstraction is needed.
- Graft is unavailable in this checkout; use equivalent symbol and test navigation under current workflow guidance.

## Verification

- Focused foreground-input, conversation-import and shutdown suites cover 66 scenarios. All pass; the final image-completion metadata assertion also passed its individual rerun.
- Package typecheck and diff whitespace check pass.
- Complexity guard passes: total 2272 to 2269, threshold debt 566 unchanged, maximum 253 unchanged. Production diff removes 20 net lines.
- First-pass provider-start metadata is present and absent on the image-completion rerun through the real assistant-phase delegate. Existing first/rerun request construction, joined-group context preservation and mailbox-import boundary omission remain unchanged.
- No stochastic model journey is routed: instructions, tools, provider input and reply policy are unchanged; the refactor is verified at the deterministic runtime orchestration boundary.
- Frog inventory inspected; no new repository-actionable friction was encountered.
- Implementation complete; parent candidate review, requested ReviewGPT and exact-head CI remain PR gates.
Completed: 2026-09-04
