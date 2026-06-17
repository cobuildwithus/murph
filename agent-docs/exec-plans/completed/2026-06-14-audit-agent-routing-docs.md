# Audit agent routing docs

Status: completed
Created: 2026-06-14
Updated: 2026-06-14

## Goal

- Clarify completion-audit routing so Codex agents use native Codex subagents for required audit passes, while non-Codex agents use `codex exec` only when they need to create a Codex audit worker.

## Success criteria

- Workflow docs state the parent-agent routing split for required audit workers.
- Codex-pinned passes still require Codex `gpt-5.5` by default, but Codex parents no longer shell out to the CLI just to create another Codex worker.
- Docs explicitly avoid `codex exec review` for prompt-based completion audit passes.
- Docs-only verification passes.

## Scope

- In scope:
- Completion audit routing language in `completion-workflow`, workflow routing, and the coverage-write prompt.
- Coordination ledger bookkeeping for this docs task.
- Out of scope:
- Changing which audit passes are required.
- Changing verification lanes, PR review loops, or commit workflow.
- Running completion audit passes for this docs-only clarification.

## Constraints

- Technical constraints:
- Preserve existing audit-pass triggers and model requirements.
- Keep wording concise enough for agents to follow under time pressure.
- Product/process constraints:
- Avoid exposing local user identifiers or machine-specific paths in docs or commit output.

## Risks and mitigations

1. Risk: The docs could imply Codex-pinned passes may silently downgrade to a non-Codex model.
   Mitigation: Keep the Codex `gpt-5.5` requirement and require reporting any unsupported model/effort override.
2. Risk: Non-Codex parent agents may lose the instruction to use the local CLI for Codex audit workers.
   Mitigation: State that CLI routing remains the fallback for non-Codex parents or environments without native Codex subagents.

## Tasks

1. Update completion workflow audit worker rules.
2. Update workflow routing summary and quick path wording.
3. Update coverage-write prompt model/scope expectation.
4. Run docs-only verification and commit with `scripts/finish-task`.

## Decisions

- Native Codex subagents are the preferred route for Codex parent agents; `codex exec` is for non-Codex parents or missing native subagent support.
- Prompt-based completion audit passes must use normal `codex exec` with the prompt/handoff packet when CLI routing is needed, not `codex exec review`.

## Verification

- Commands to run:
  - `git diff --check`
  - Direct readback of changed audit-routing snippets.
- Expected outcomes:
  - No whitespace errors.
  - Changed docs clearly distinguish Codex-parent native subagents from non-Codex-parent CLI workers.
Completed: 2026-06-14
