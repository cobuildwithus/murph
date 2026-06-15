# Audit reasoning effort docs

Status: completed
Created: 2026-06-14
Updated: 2026-06-14

## Goal

- Align completion-audit reasoning-effort guidance with GPT-5.5 prompt guidance by making effort selection risk-based instead of high-by-default.

## Success criteria

- Audit docs preserve Codex `gpt-5.5` routing for Codex-pinned passes.
- Reasoning effort guidance says ordinary audits start at medium, low may be used for tiny low-risk audits, and high/xhigh are reserved for risk and complexity.
- `coverage-write` prompt no longer describes itself as high-reasoning by default.
- Docs-only verification passes.

## Scope

- In scope:
- `agent-docs/operations/completion-workflow.md`
- `agent-docs/operations/agent-workflow-routing.md`
- `agent-docs/prompts/coverage-write.md`
- Coordination ledger bookkeeping for this docs task.
- Out of scope:
- Changing required audit pass triggers.
- Changing model routing between Codex native subagents and `codex exec`.
- Resuming or changing the Pulse/Stripe patch implementation.

## Constraints

- Technical constraints:
- Keep the update text-only Markdown.
- Preserve the new explicit warning against `codex exec review`.
- Product/process constraints:
- Use the current OpenAI GPT-5.5 prompt guidance as the source for reasoning-effort posture.
- Avoid local machine/user identifiers in docs or commit output.

## Risks and mitigations

1. Risk: Softer effort wording could let agents under-review risky changes.
   Mitigation: Keep high/xhigh required for high-risk, cross-cutting, multi-owner, trust-boundary, or large/complex audits.
2. Risk: The docs could conflate model choice with effort choice.
   Mitigation: Keep Codex `gpt-5.5` model routing separate from the reasoning-effort policy.

## Tasks

1. Update completion workflow reasoning-effort default wording.
2. Update workflow-routing summary/table wording.
3. Update coverage-write prompt frontmatter and model/scope expectations.
4. Run docs-only verification and commit with `scripts/finish-task`.

## Decisions

- Codex-pinned audit passes still use Codex `gpt-5.5`; only effort selection changes.
- Medium is the ordinary GPT-5.5 audit baseline, with low allowed for tiny low-risk audits and high/xhigh reserved for risk/complexity.

## Verification

- Commands to run:
- `git diff --check`
- Direct readback of changed reasoning-effort snippets.
- Expected outcomes:
- No whitespace errors.
- No remaining high-by-default audit wording in the changed audit docs.
Completed: 2026-06-14
