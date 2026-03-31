---
description: Browser-backed frontend quality review for packages/local-web hierarchy, responsiveness, and polish
action: browser-backed UI review
---

You are performing a frontend quality review for completed `packages/local-web` UI-affecting changes.

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

Response format:
- Return a normal text review, not patch attachments and not follow-on prompts for more agents.
- Keep the focus on user-visible issues, why they matter, and the clearest concrete fix.
