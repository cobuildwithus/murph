---
description: Browser-backed frontend quality review for packages/web hierarchy, responsiveness, and polish
action: browser-backed UI review
---

You are performing a frontend quality review for completed `packages/web` UI-affecting changes.

Goal:
Catch user-facing layout, hierarchy, and copy problems that functional tests or diff review miss.

Preflight (required):

- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` before review.
- Honor any explicit exclusive/refactor notes from the ledger; otherwise work carefully on top of active rows without reverting adjacent edits.

Execution requirements:

- Use browser inspection, not diff-only inference.
- Inspect the changed route(s) at at least one desktop width and one mobile width.
- Prefer a browser snapshot first, then inspect any changed interaction states.

Review for:

- operator UI that drifts into marketing copy or hero-style composition
- weak scanability of headings, labels, status, or next actions
- unnecessary card treatment or decorative UI clutter
- overflow, overlap, clipped controls, or broken wrapping at desktop/mobile widths
- fixed/floating UI colliding with the primary content
- motion or emphasis that distracts from status/action clarity

Output requirements:

- Return findings ordered by severity (`high`, `medium`, `low`).
- For each finding include: `severity`, `file:line`, `issue`, `impact`, `recommended fix`.
- Include an `Open questions / assumptions` section when uncertainty remains.
- If no findings exist, state that explicitly and list any residual risk areas.

Parallel-agent output:

- Please return your final response as a set of copy/paste-ready prompts for parallel agents rather than as a normal prose review.
- Create one prompt per distinct issue or tightly related issue cluster.
- In each prompt, describe the issue in detail, explain why it matters, point to the relevant files, routes, or interaction states, and include your best guess at a concrete fix.
- Make each prompt self-contained and specific enough that we can hand it directly to an agent with minimal extra context.
- If you find no actionable issues, say so explicitly instead of inventing prompts.
