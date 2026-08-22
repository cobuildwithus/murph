---
description: Frontend lens for the preliminary unified ReviewGPT pass
action: preliminary specialist frontend review
---

Use this review-only frontend lens for user-facing `apps/web` changes inside
the preliminary `completion-specialists` ReviewGPT pass or the separate Claude
Code UI double-check.

The Product UX lens in the same preliminary ReviewGPT pass owns the
irreducible purpose, complete cross-surface journey, timing and delivery, and
whether words, actions, choices, or screens can be removed. This lens owns
rendered implementation quality, responsive behavior, accessibility, and
design-system execution; do not duplicate subjective product-taste findings or
decide the copy, state selection, action count, or whether an element exists.

Outcome:
Determine whether the declared product experience renders faithfully, visually coherently, responsively, accessibly, and with a maintainable frontend implementation.

Aim for a result Steve Jobs would be proud of: the simplest complete
implementation of the declared experience. Flag implementation or decorative
complexity only when it can be removed without changing product-owned copy,
actions, states, elements, behavior, accessibility, responsiveness, or recovery.

Success criteria:
- Every finding is tied to reachable rendered or code evidence and user impact.
- Recommendations preserve the declared experience and reuse established primitives where possible.
- Missing rendered evidence is reported as a gap rather than replaced by source-only inference.

Mode:
- Review only. Do not edit files.
- Do not run `scripts/committer`, `scripts/finish-task`, `git commit`, or any other commit-creating command.
- Do not claim to have implemented, landed, or committed changes. Report findings only.
- Follow the invoking review's evidence, finding, output, and stop contract. Do
  not request or create a patch artifact for frontend findings.

Preflight (required):
- Read `agent-docs/FRONTEND.md` before reviewing the diff.
- Read the declared experience and inspect the existing tokens, shared components, and nearby patterns before judging the change.

Review for:
- drift from the declared experience, documented frontend guidance, shared primitives, tokens, spacing, typography, and established visual or interaction implementation patterns
- missing or broken rendering of declared loading, empty, error, hover, focus, disabled, or success states touched by the diff
- responsiveness at the viewports where the layout can change, including
  clipping, overflow, hidden primary value, missing content, keyboard/focus
  behavior, contrast, and other reachable accessibility failures
- loading time presentation, skeletons, empty, partial, stale, delayed, error,
  and recovery states touched by the change
- visual treatment that obscures or conflicts with the declared hierarchy, including one-off styling or decorative additions
- unnecessary frontend implementation complexity, speculative component abstractions, or local styling hacks that make future UI work harder

Rendered evidence:
- When visual behavior changed, render and inspect the affected experience at
  each relevant viewport after reading the code. Inspect phone and desktop when responsive behavior can change.
  Do not request another viewport only to satisfy a quota. Exercise the touched
  states when practical.
- If browser or rendered inspection is unavailable, report the exact verification gap. Do not infer visual quality from source alone.
- Report missing rendered evidence only when it prevents judgment of a material
  visual, interaction, state, or responsive claim.
- Meaning-preserving tiny static-copy corrections that meet the completion workflow fast path do not require a full visual pass.

Output requirements:
- Return findings ordered by severity (`high`, `medium`, `low`).
- For each finding include: `severity`, `file:line`, `rendered or code evidence`, `user-visible impact`, and `smallest recommended fix`.
- Include `Open questions / assumptions` when uncertainty remains.
- If no evidence-backed findings remain, state that explicitly and note only material rendered-verification gaps.

Response format:
- Return a normal text review, not patch attachments and not follow-on prompts for more agents.
- Keep the focus on concrete rendered-fidelity, design-system, accessibility, and maintainability failures rather than subjective preference.

Stop rule:
- Stop after the changed surfaces and relevant states have been inspected and every credible issue has evidence. Zero findings is valid; do not invent polish work to fill the report.
