# Redesign Habitat categories as horizontal sections

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Replace the unreadable Habitat card grid with a clear, full-width category
  summary system that lets a member immediately see what Murph knows, what is
  missing, which targets are met, and which areas need attention.

## Success criteria

- Every category has a visible name, direct target score, coverage percentage,
  known/unknown counts, and clearly separated positive, negative, known, and
  skipped facts.
- Desktop uses one horizontal category section per row with a larger scene or
  equipment visual; mobile reflows structurally into a readable stack.
- The ambiguous global score strip, detached legend, and tiny context chips are
  removed or replaced with self-explanatory summaries.
- The UI preserves Habitat's research-audit framing and avoids gamified ring
  charts, points, celebrations, or decorative dashboard metrics.
- Focused tests/typecheck, desktop and mobile browser review, Impeccable layout
  verification, final `/impeccable audit`, and the required repo frontend
  review all pass.

## Scope

- In scope: `/environment` information architecture, category summary
  components, category scene/equipment presentation, responsive layout, UI
  copy, and focused tests.
- Out of scope: Habitat persistence, live replica data wiring, catalog grading
  semantics, the separate `/environment/3d` experiment, and unrelated app UI.

## Constraints

- Technical constraints: reuse `HABITAT_CATALOG`, `CategoryNote`, and the
  existing resolved scene model; do not add dependencies or new state.
- Product/process constraints: preserve Murph's warm-paper design system,
  avoid nested cards and ring charts, keep target claims evidence-based, and
  preserve unrelated dirty work.

## Risks and mitigations

1. Risk: A repeated full-width row can become monotonous.
   Mitigation: keep the row anatomy stable for comprehension while letting
   scenes, equipment strips, and evidence density vary by category content.
2. Risk: Letter grades can overstate evidence and read as gamification.
   Mitigation: do not render letter grades; show only the exact count of
   directly verified targets met.
3. Risk: Dense facts become unreadable on mobile.
   Mitigation: use structural breakpoint reflow, readable body sizes, and
   explicit status headings/icons rather than shrinking the desktop layout.

## Tasks

1. Synthesize visual and mechanical layout assessments.
2. Simplify the page header and rebuild category sections horizontally.
3. Rework evidence groups and visual/equipment presentation.
4. Verify responsive behavior, semantics, tests, and typecheck.
5. Run Impeccable audit plus required repo frontend review, then finish the
   scoped task.

## Decisions

- Use a percentage plus linear progress bar for coverage. A ring chart would
  conflict with Murph's explicit no-ring-chart product rule.
- Replace category letter grades with direct `targets met / targets assessed`
  ratios; remove the ambiguous global mock grade.
- Prefer deletion: remove the detached status legend and explain states inline
  where the member reads the facts.

## Verification

- Impeccable detector: `[]` for the changed Habitat UI files.
- Focused tests: 17/17 passed across `environment-page.test.tsx` and
  `browser-vault-dashboard-pages.test.tsx`.
- Focused ESLint: passed for the changed Habitat UI and test files.
- Browser review: verified at 1440×1000 and 390×844 with no console/runtime
  errors or horizontal overflow.
- Workspace `test:diff` passed dependency policy, workspace boundaries, hosted
  runtime guards, and reached the apps/web verification lane. Standalone
  typecheck remains blocked by the unrelated pre-existing
  `src/components/dashboard/sidebar.tsx:329` `string` to `never` error.
- Required layout, coverage-write, and frontend-review audits were run. Their
  accepted findings removed proxy target claims and made next-focus selection
  compare unmet and unknown candidates in one priority-ordered list.
- The fresh release review after those fixes found no remaining P0-P2 issues.

## Impeccable audit

Audit Health Score: **19/20 — Excellent**

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Accessibility | 4/4 | Semantic heading hierarchy, labeled progress bars and illustrations, no fake interactive controls, keyboard-independent equipment states, and verified AA contrast ratios from 4.71:1 to 11.18:1. |
| Performance | 4/4 | Static server rendering, no client state or layout reads, no new animation, local bounded SVG assets, and tree-shaken Lucide imports. |
| Responsive design | 4/4 | Structural reflow verified at 1440×1000 and 390×844 with no horizontal overflow or runtime errors. |
| Theming | 3/4 | UI chrome uses semantic Tailwind/shadcn tokens; authored diorama SVG fills remain intentionally light-mode-specific until the product's deferred dark-mode phase. |
| Anti-patterns | 4/4 | No ring charts, hero-metric decoration, nested cards, shadowed card grids, fake buttons, hover-only meaning, or identical multi-column card matrix. |

Anti-pattern verdict: **Pass.** The screen reads as a Habitat research audit,
not a generic health dashboard. No P0, P1, or P2 findings remain. One deferred
P3 is documented: if product dark mode ships, the authored diorama palette
will need a deliberate dark-mode treatment rather than automatic token swaps.
Completed: 2026-07-10
