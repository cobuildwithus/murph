# Frontend

## Scope

UI work lives in `apps/web/`. One Next.js 16 app (App Router, React 19, Tailwind v4).

## Design System

Design context lives in two files at the repo root. Read both before any UI work:

- **`PRODUCT.md`** — strategic: register (brand vs product), target users, brand personality, anti-references, design principles. The "who / what / why".
- **`DESIGN.md`** — visual: color tokens, typography, elevation, components, do's and don'ts. Follows the [Google Stitch DESIGN.md format](https://stitch.withgoogle.com/docs/design-md/format/) — YAML frontmatter (machine-readable tokens) + six fixed sections (Overview, Colors, Typography, Elevation, Components, Do's and Don'ts). The "how it looks".

Both files are managed by the `impeccable` skill (`.agents/skills/impeccable/`). They are the single source of truth for product strategy and visual design. Don't duplicate their values into other docs or code comments.

Colors and fonts are mapped to standard shadcn CSS variables in `apps/web/app/globals.css`. Brand guidelines and the reviewable UI catalog live at [localhost:3000/design](http://localhost:3000/design) when running the dev server (`?tab=brand` for visual identity, `?tab=components` for reusable components, and `?tab=sections` for composed page sections).

### Impeccable skill

Installed in repo (`.agents/skills/impeccable/`). Available after pull — no extra install needed.

Run via `$impeccable <command>` (or pinned shortcuts if created). Useful commands for this project:
- `$impeccable craft [feature]` — shape, then build a feature end-to-end.
- `$impeccable shape [feature]` — plan UX/UI before writing code.
- `$impeccable critique [target]` — UX review with heuristic scoring.
- `$impeccable audit [target]` — accessibility, performance, responsive checks.
- `$impeccable polish [target]` — final quality pass before shipping.
- `$impeccable typeset [target]` / `$impeccable layout [target]` / `$impeccable distill [target]` — targeted refinement.
- `$impeccable teach` — regenerate `PRODUCT.md` (strategic context).
- `$impeccable document` — regenerate `DESIGN.md` (visual tokens and components) from current code.

### Tailwind / shadcn conventions

Use shadcn token classes (`text-primary`, `bg-card`, `border-border`) and standard Tailwind scale (`text-sm`, `text-3xl`, `gap-4`) wherever possible. The goal: any agent that knows shadcn + Tailwind can work in this codebase without learning custom tokens.

**Arbitrary values are fine** for one-off cases — a non-standard font size (`text-[10px]`), unusual spacing (`gap-[18px]`), or a color used once (`bg-[#c4a882]`). Don't add these to the config. Only add to `globals.css` if a value repeats across multiple components and maps to a shadcn semantic token (like `--primary` or `--border`).

### Component variants (cva)

Use `class-variance-authority` when a component has multiple visual variants. Define variants with `cva()`, export both the component and the variants object. Keep variant names generic (`default`, `outline`, `muted`, `primary`, `destructive`) — not tied to specific features or domain concepts.

```tsx
import { cva, type VariantProps } from "class-variance-authority";

const badgeVariants = cva("rounded-full px-2 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground",
      muted: "bg-muted text-muted-foreground",
      outline: "border border-border text-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});
```

## Stack

- **shadcn/ui** with **base UI, not Radix** — `apps/web/components.json`. We use `@base-ui/react` primitives. Do not install or import from `@radix-ui/*`.
- **Components**: `apps/web/src/components/ui/` (shadcn), `apps/web/src/components/` (custom)
- **Imports**: `@/*` → `apps/web/*`, e.g. `@/src/components/ui/button`, `@/src/lib/utils`
- **Icons**: `lucide-react` is the default import (matches existing usage). Reserve Lucide Animated (`pnpm dlx shadcn@latest add https://lucide-animated.com/r/{icon-name}.json`) for icons that specifically need motion — loaders, hover affordances, etc.
- **Transitions**: View Transitions API (`<ViewTransition>` from `next/navigation`), not Framer Motion
- **shadcn skill**: `.agents/skills/shadcn/` — **invoke this skill (`Skill(shadcn)` or `/shadcn`) before any shadcn work.** It loads project registry config, current style (`base-nova` = base UI), installed components, and the correct docs endpoint (`components/base/[name]`). Do not rely on general shadcn knowledge — the project is on base UI, and components have evolved past what a model may remember.

### Commands

```bash
# Add a shadcn component
cd apps/web && pnpm dlx shadcn@latest add <component>

# Add an animated icon
pnpm dlx shadcn@latest add https://lucide-animated.com/r/{icon-name}.json

# Dev server
cd apps/web && pnpm dev

# Typecheck
cd apps/web && pnpm typecheck
```

## Rules

- Follow the task-class implementation route in `agent-docs/operations/agent-workflow-routing.md`; frontend implementation has no separate implementation-model requirement. Follow `agent-docs/operations/completion-workflow.md` for routed browser proof, the frontend lens inside the preliminary `completion-specialists` ReviewGPT pass, the separate UI double-check, and any applicable final ReviewGPT gate.
- Use shadcn components and standard Tailwind classes. Arbitrary values for edge cases only.
- No `@radix-ui/*` imports. We use base UI.
- Motion restrained — only for hierarchy or affordance.
- Verify UI changes in browser (desktop + mobile) before handoff.
- Every pull request that changes user-facing frontend UI must update the reviewable catalog with the real production component: use [localhost:3000/design?tab=components](http://localhost:3000/design?tab=components) for reusable components, or [localhost:3000/design?tab=sections](http://localhost:3000/design?tab=sections) for a complete page section or flow.
- Include desktop and mobile screenshots captured from the applicable design-page tab in the pull request. Use lossless PNG at 2x device scale or higher, crop to the changed component or section, and inspect the local and hosted images at native resolution so ordinary body copy is immediately legible. Show each materially changed component or section and every state needed to judge the change.
- The `Frontend design proof` pull-request check enforces the catalog-file update and the required hosted screenshot links for user-facing UI diffs. Design-catalog-only changes are exempt so the catalog can be maintained independently.

## Docs to update

When frontend behavior changes:
- `DESIGN.md` (visual tokens, new components, updated patterns)
- `PRODUCT.md` (only if brand personality, anti-references, or design principles shift)
- `agent-docs/PRODUCT_SENSE.md`
- `apps/web/README.md`
## Member-owned provider setup

- `/connect`, contextual assistant handoffs, and reconnect/repair render the same
  Web-owned provider-indexed setup projection. Do not reproduce the state machine
  in React or prompts, and do not add a provider-specific scalar prop to the page.
- Use `MemberOwnedProviderSetup` for production and both design-catalog studies.
  Pass explicit registered provider presentation metadata; the component has no
  hidden Strava default.
  Studies are synthetic and inert; production actions call authenticated,
  CSRF-protected routes.
- Show one truthful primary action only when provider sign-in/prerequisite,
  consent, OAuth, or retry is required. A reached provider prerequisite may add
  one secondary `Cancel setup` action. Render the setup group flat inside the
  source card, without nested card chrome. Working and connected states have no
  action; in disconnect-first, the source card's confirmation-opening
  registered `Disconnect <provider> first` control is the sole action. Never
  render client-id or client-secret fields, and never display a captured secret.
- Browser handoffs must remain same-origin under `/computer/handoff/`; external
  redirects are reserved for the exact OAuth authorization URL. Preserve source
  card semantics, keyboard focus, accessible status copy, and narrow-screen flow.
