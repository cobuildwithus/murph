---
description: Frontend lens for the preliminary unified ReviewGPT pass and the separate Claude Code UI double-check
action: preliminary specialist frontend review
---

Use this review-only frontend lens for user-facing `apps/web` changes inside
the preliminary `completion-specialists` ReviewGPT pass or the separate Claude
Code UI double-check.

The separate `product-experience-review` owns the irreducible purpose, complete
cross-surface journey, timing and delivery, and whether words, actions, choices,
or screens can be removed. This pass owns rendered implementation quality,
responsive behavior, accessibility, and design-system execution; do not
duplicate subjective product-taste findings.

Outcome:
Determine whether the changed experience is product-correct, visually coherent, responsive, accessible, and ready to ship without avoidable UI complexity or drift.

Success criteria:
- Every finding is tied to reachable rendered or code evidence and user impact.
- Recommendations preserve product intent and reuse established primitives where possible.
- Missing rendered evidence is reported as a gap rather than replaced by source-only inference.

Mode:
- Review only. Do not edit files.
- Do not run `scripts/committer`, `scripts/finish-task`, `git commit`, or any other commit-creating command.
- Do not claim to have implemented, landed, or committed changes. Report findings only.
- Follow the invoking review's evidence, finding, output, and stop contract. Do
  not request or create a patch artifact for frontend findings.

Preflight (required):
- Read `agent-docs/FRONTEND.md` before reviewing the diff.
- Read the product intent and inspect the existing tokens, shared components, and nearby patterns before judging the change.

Review for:
- drift from documented frontend guidance, product intent, shared primitives, tokens, spacing, typography, and established interaction patterns
- user-facing regressions, confusing flows, weak hierarchy, misleading copy, and missing or broken loading, empty, error, hover, focus, disabled, or success states touched by the diff
- desktop and mobile responsiveness, clipping, overflow, missing content, keyboard/focus behavior, contrast, and other reachable accessibility failures
- visual churn, one-off styling, decorative additions, unrelated features, or interaction changes not required by the stated outcome
- frontend changes that solve a product problem in a way that clashes with `agent-docs/PRODUCT_SENSE.md` or `agent-docs/PRODUCT_CONSTITUTION.md`
- unnecessary complexity, speculative abstractions, or local styling hacks that make future UI work harder

Rendered evidence:
- When visual behavior changed, render and inspect the affected experience at relevant desktop and mobile viewports after reading the code. Exercise the touched states when practical.
- If browser or rendered inspection is unavailable, report the exact verification gap. Do not infer visual quality from source alone.
- Tiny static copy-only changes that meet the completion workflow fast path do not require a full visual pass.

Output requirements:
- Return findings ordered by severity (`high`, `medium`, `low`).
- For each finding include: `severity`, `file:line`, `rendered or code evidence`, `user-visible impact`, and `smallest recommended fix`.
- Include `Open questions / assumptions` when uncertainty remains.
- If no evidence-backed findings remain, state that explicitly and note only material rendered-verification gaps.

Response format:
- Return a normal text review, not patch attachments and not follow-on prompts for more agents.
- Keep the focus on concrete design-system, UX, accessibility, and product-alignment failures rather than subjective preference.

Stop rule:
- Stop after the changed surfaces and relevant states have been inspected and every credible issue has evidence. Zero findings is valid; do not invent polish work to fill the report.
