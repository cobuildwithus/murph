# Relax native bold marker parsing

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Render any non-empty text between paired `**` markers as a native bold span so valid iMessage copy such as `**10/10**—` no longer leaks markdown markers.

## Success criteria

- The exact reported sentence produces marker-free text and the correct UTF-16 bold range.
- Paired bold markers no longer depend on punctuation, whitespace, newline, adjacency, or an arbitrary content-length heuristic.
- Italic, underline, and strikethrough parsing retain their existing conservative rules.
- Focused tests, the truthful diff-aware verification lane, required coverage audit, and final review pass.

## Scope

- In scope: the shared native message formatter and focused formatter/Linq request regressions.
- Out of scope: assistant prompt changes, delivery pacing/retries, provider plumbing, or other markdown styles.

## Constraints

- Technical constraints: preserve UTF-16 decoration ranges and unmatched-marker text; keep the implementation in the existing formatter owner.
- Product/process constraints: prefer deletion of bold-specific rejection heuristics; preserve unrelated working-tree and ledger edits.

## Risks and mitigations

1. Risk: the formatter is shared by Linq/iMessage and Telegram, so paired `**` semantics change on both transports.
   Mitigation: keep the change limited to the shared bold token, retain all non-bold safeguards, and verify the provider-neutral formatter plus the Linq wire shape.

## Tasks

1. Pin the reported failure with a focused regression.
2. Simplify paired bold-marker parsing and update the former rejection cases.
3. Verify focused behavior and the package/reverse-dependent diff lane.
4. Run the required coverage audit, parent final review, and scoped finish-task commit.

## Decisions

- Treat the first following `**` as the close for an open bold span; empty or unmatched pairs remain literal.
- Do not broaden the same behavior to `*`, `_`, `++`, or `~~` markers.

## Verification

- Focused formatter and Linq tests passed: 2 files, 40 tests.
- The truthful diff-aware lane passed affected typechecks, package tests, the hosted-local package boundary, and Cloudflare verification.
- Direct formatter proof returned marker-free text and bold range `[16, 21]` for the reported sentence.
- The required coverage-write audit added delimiter-adjacent slash proof, reran the focused suite, and found no unresolved actionable gap.
- `git diff --check` passed.
Completed: 2026-07-15
