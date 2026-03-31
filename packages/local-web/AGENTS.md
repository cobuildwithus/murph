# packages/local-web AGENTS Overlay

## Purpose

This file contains web-package-specific overlays for the repo root `AGENTS.md`.

## Read Order

1. `agent-docs/FRONTEND.md`
2. `agent-docs/PRODUCT_SENSE.md`
3. `agent-docs/operations/verification-and-runtime.md`
4. `packages/local-web/README.md`

## Hard Rules

- Treat `packages/local-web` as an operator-facing observability surface by default, not a marketing site.
- Default to utility copy, visible status, and obvious next actions.
- Use Tailwind utility classes only; theme tokens come from `packages/local-web/app/globals.css`.
- Preserve the read-only query boundary and route all device-account actions through the documented local device control plane.
- For UI-affecting changes, inspect the rendered result at desktop and mobile sizes before handoff.
