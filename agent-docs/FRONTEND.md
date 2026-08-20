# Frontend

## Scope

UI work lives in `apps/web/`. One Next.js 16 app (App Router, React 19, Tailwind v4).

## Design System

Design context lives in two files at the repo root. Read both before any UI work:

- **`PRODUCT.md`** — strategic: register (brand vs product), target users, brand personality, anti-references, design principles. The "who / what / why".
- **`DESIGN.md`** — visual: color tokens, typography, elevation, components, do's and don'ts. Follows the [Google Stitch DESIGN.md format](https://stitch.withgoogle.com/docs/design-md/format/) — YAML frontmatter (machine-readable tokens) + six fixed sections (Overview, Colors, Typography, Elevation, Components, Do's and Don'ts). The "how it looks".

Both files are managed through the installed `impeccable` skill. They are the single source of truth for product strategy and visual design. Don't duplicate their values into other docs or code comments.

Colors and fonts are mapped to standard shadcn CSS variables in `apps/web/app/globals.css`. Brand guidelines and reusable components live at [localhost:3000/design](http://localhost:3000/design) when running the dev server (`?tab=brand`, `?tab=components`, and `?tab=consent`). Unlinked, noindex presentation studies live under [localhost:3000/screenshots](http://localhost:3000/screenshots).

### Impeccable skill

Invoke the installed `impeccable` skill by name. Skill installation is environment-owned; do not assume a checkout-local skill directory exists.

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
- **shadcn skill**: **invoke the installed `shadcn` skill by name before any shadcn work.** It loads project registry config, current style (`base-nova` = base UI), installed components, and the correct docs endpoint (`components/base/[name]`). Do not rely on general shadcn knowledge — the project is on base UI, and components have evolved past what a model may remember.

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

- Follow the task-class implementation route in `agent-docs/operations/agent-workflow-routing.md`; frontend implementation has no separate implementation-model requirement. Follow `agent-docs/operations/completion-workflow.md` for routed browser proof, the frontend lens inside the preliminary `completion-specialists` ReviewGPT pass, and any independently applicable final ReviewGPT gate.
- Follow `agent-docs/operations/product-ux.md` before and after code. Treat
  loading time, progress, skeletons, empty, partial, stale, error, and recovery
  states as part of the product experience.
- Use shadcn components and standard Tailwind classes. Arbitrary values for edge cases only.
- No `@radix-ui/*` imports. We use base UI.
- Motion restrained — only for hierarchy or affordance.
- Verify UI changes in the browser at every viewport where the result can
  materially differ. Check phone and desktop when responsive behavior can
  change.
- Reuse [localhost:3000/design?tab=components](http://localhost:3000/design?tab=components) before creating a near-duplicate, and add each new shared component there. Do not update the catalog for every UI diff.
- Add a `/screenshots` study only when a difficult or reusable state benefits from stable presentation proof. Render the real production component with synthetic props, no live data, no live requests, and all interactive controls `inert`. A screenshot study proves presentation only, not the complete product journey.
- Treat the unlinked and noindex route as a discovery control, not security. Never put private member data or credentials there.
- Match rendered evidence to the changed visual, state, interaction, and
  responsive risk. A change can need no screenshots, one screenshot, or many.
  Do not capture another viewport only to meet a quota. When a screenshot is
  useful, crop it to the changed component or section and inspect it at native
  resolution so ordinary body copy is legible.
- The `Pull request evidence` check requires literal `Direct:` and `Coverage:`
  list items for user-facing UI diffs. It does not require a catalog update or
  screenshot count. Design and screenshot-study changes are exempt so those
  references can be maintained independently. Existing `page.tsx` and
  `layout.tsx` files also receive a narrow metadata-only exemption when the
  checker can prove that the only runtime source change is an unreferenced static
  object-literal `metadata` export. Dynamic metadata, viewport or theme
  metadata, route additions/deletions, and any rendered-source change still
  require frontend proof.

## Docs to update

When frontend behavior changes:
- `DESIGN.md` (visual tokens, new components, updated patterns)
- `PRODUCT.md` (only if brand personality, anti-references, or design principles shift)
- `agent-docs/PRODUCT_SENSE.md`
- `apps/web/README.md`
