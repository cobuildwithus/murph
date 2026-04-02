# 2026-04-02 Codex Privileged Adapter

## Goal

Finalize the assistant runtime around a shared Murph orchestration model while explicitly allowing Codex to operate as a privileged local adapter without sandbox restrictions.

## Why

- The shared runtime/orchestration cutover is already in place.
- The remaining question is policy, not structure: Codex should be allowed to operate normally instead of being forced toward a stricter host-runtime-only boundary.
- The current docs and some runtime defaults still imply a tighter security posture than the user wants.

## Scope

- Codex adapter defaults and local assistant provider defaults
- Assistant sandbox / approval-policy normalization where it still enforces an unnecessary stricter posture
- Canonical write guard posture and user-facing semantics
- Matching assistant docs and focused regression coverage

## Non-goals

- Reworking hosted assistant runtime or hosted explicit-config work already active elsewhere
- Reintroducing the old provider-runtime split
- Broad product copy changes outside assistant architecture/safety docs

## Verification

- Focused assistant typecheck
- Focused assistant Vitest suites covering provider defaults, runtime/service behavior, and guard behavior
- Attempt repo-wide checks, but treat unrelated active hosted/app failures separately
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
