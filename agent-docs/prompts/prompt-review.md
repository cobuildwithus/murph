---
description: On-demand review guidance for prompt changes
action: on-demand prompt review
---

Use this for an explicitly requested review or as the parent's own checklist.
A review-only handoff does not authorize edits. Using this checklist during an
implementation does not end that task or create a separate review gate.

Judge whether the assembled prompt gives its actual target model a clear,
proportional contract for the requested outcome.

## Evidence

Inspect the complete changed prompt, assembled layers, tools, and regression
proof. Verify current official guidance for the model the prompt actually targets;
do not substitute the reviewer's model or force a historical model family.
Use the OpenAI Docs tools or official documentation. When source access fails,
report the gap and continue source-independent inspection without claiming
model-specific validation. Fetch migration/API guidance only when that is in scope.

For GPT-6 Astra, the current [prompting guidance](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra.md#prompting-best-practices)
emphasizes instruction conflicts, clear authority, follow-through, and
proportional testing. Apply relevant advice without copying a second generic
agent workflow into the prompt.

## Review

- State the outcome, needed evidence, allowed effects, output, and stopping rule.
- Remove conflicting, duplicate, obsolete, and unnecessarily procedural rules.
  Keep hard privacy, safety, authority, and canonical-write boundaries explicit.
- Keep untrusted content distinct from instructions and preserve user constraints.
- Make sufficient evidence and useful recovery clear; avoid repeated approval
  gates or loops caused only by incomplete generic checklists.
- Keep tools, examples, and personality guidance relevant and proportional.
  Preserve stable prefixes; change caching/runtime features only for a demonstrated need.
- Preserve actual product behavior and supported claims. Check the relevant
  messaging/delivery contract for member-facing prompts.
- Review the actual composed result and focused model evidence; authored text
  alone does not prove tool effects, delivery, or reply quality.

## Result

Report evidence-backed issues with severity, file/line, failed behavior or
invariant, and the smallest correction. State material evidence gaps separately.
Zero findings is valid. Do not add speculative rules or more review passes to
make the result appear thorough.
