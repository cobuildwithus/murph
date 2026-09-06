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

Follow `agent-docs/operations/product-ux.md` for the changed journey and
`agent-docs/operations/completion-workflow.md` for review and PR gates.
Frontend work has no special implementation-model requirement.

- Preserve the page shell across loading, empty, unavailable, and error states.
  Reuse sibling state patterns and shape skeletons like the content they replace.
- Put useful content first. Add supporting copy only when it helps understanding
  or action; avoid repeating headings, status, dates, or controls.
- Reuse the component catalog before adding a near-duplicate. Every user-facing
  hosted Web change needs a reviewer-openable representation on the matching
  `/design` tab or `/screenshots/<category>`, current to the changed state.
- Presentation studies render real production components with synthetic props,
  no live data/requests, and inert controls. Use the actual page for journey proof.
  Noindex/unlinked routes are not security boundaries.
- Inspect material states, accessibility, and viewports where behavior can differ.
  There is no screenshot quota; capture evidence that actually proves the claim.
- Keep local data personas synthetic and on real query paths. Never bundle member
  exports, private data, or credentials into development selectors or studies.
- Follow the completion workflow's design-proof fields and narrow metadata-only
  exception. Content-only changelog records follow `apps/web/changelog/README.md`.

## Rendered evidence and publication

For the Playwright fallback, prefer an existing design-proof capture spec.
If none covers the state, use the established `apps/web/e2e/pr-*-design-proof.spec.ts`
pattern for one task-scoped spec: run through `apps/web/playwright.config.ts`
so its smoke environment owns the dev server, open the anchored `/design` or
`/screenshots` state, block non-loopback requests, wait for fonts and two
animation frames, assert the production surface, and capture that surface
rather than a long full page. In a secondary worktree, choose a task-unique
port and Next dist suffix. For example:

```bash
VIEWPORT_OVERFLOW_PORT=<unique-port> \
NEXT_DIST_DIR_SUFFIX=<task-slug>-proof \
DESIGN_PROOF_OUTPUT_DIR=../../.artifacts/review-gpt/<task-slug> \
  pnpm --dir apps/web exec playwright test \
    e2e/<capture-spec>.spec.ts --config playwright.config.ts --project chromium
```

Inspect each selected image at native resolution, keep it ignored and
redacted under `.artifacts/review-gpt/`, and remove a one-off capture spec
after proof unless it adds durable regression value.

Before any image or video leaves the machine, inspect each screenshot at
native resolution and replay each video, including its audio. Prefer
synthetic fixtures, then crop or redact all private or identifying material:
names, handles, email addresses, phone numbers, member or provider
identifiers, real faces or identifying avatars, health or conversation
content, secrets and tokens, sensitive URLs or query strings, local usernames
or home-directory paths, notifications, and unrelated browser or system
chrome. Strip embedded location or device metadata, use a flattened export
rather than editable redaction overlays, and keep file names, alt text, and
surrounding prose identifier-free. Treat GitHub attachments as public, durable
third-party artifacts: never upload an unsafe original with the intention to
edit or delete it later. If redaction would remove the proof or privacy is
uncertain, do not upload the media; record the evidence blocker and use
another proof surface.

Publish only the selected privacy-safe media with GitHub CLI 2.99.0 or newer.
Use the repeatable `--attach` flag on `gh pr create`, `gh pr edit`, or
`gh pr comment`; append `#<alt text>` to an image path, while video paths do
not accept alt text. When the body already references the same local path,
`gh` replaces that reference with the uploaded URL; otherwise it appends the
attachment. For example:

```bash
gh pr comment <pr-number> \
  --body 'Responsive design proof' \
  --attach './.artifacts/review-gpt/<task-slug>/desktop.png#Desktop changed state' \
  --attach './.artifacts/review-gpt/<task-slug>/phone.png#Phone changed state'
```

Reopen the rendered PR or comment after upload. Confirm the intended media
and image alt text appear, no private material is visible, and no local path
remains. A nonzero command can still mean some attachments were published;
inspect the rendered result before retrying and retry only missing media.
See GitHub's
[media attachment announcement](https://github.blog/changelog/2026-09-01-github-cli-media-in-issues-pull-requests-and-comments/)
for the supported command surface.

## Docs to update

Update only the owner whose contract changed: `DESIGN.md` for tokens and
patterns, `PRODUCT.md` for brand principles, `agent-docs/PRODUCT_SENSE.md` for
product meaning, or `apps/web/README.md` for setup/runtime contracts.
