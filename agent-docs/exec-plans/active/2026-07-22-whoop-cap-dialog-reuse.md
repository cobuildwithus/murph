# Reuse the WHOOP setup dialog at capacity

Status: active
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- When direct WHOOP capacity is full, open the existing WHOOP Apple Health
  setup dialog instead of replacing the connect-source grid with a separate
  inline fallback.
- Keep the voice memo, numbered setup steps, app download, and Murph
  conversation action identical to the normal WHOOP completion journey.

## Success criteria

- Manual and device-intent WHOOP capacity errors open the existing setup-guide
  dialog directly.
- Dismissing the dialog returns to the unchanged source grid.
- The normal successful WHOOP completion flow remains unchanged.
- The obsolete inline fallback component and its duplicated copy are deleted.
- Focused tests, responsive design-catalog proof, required review, CI, and
  ReviewGPT pass for the exact PR head.

## Scope

- The hosted Web connect-page client and server page props.
- The existing device-sync completion/setup dialog and shared setup-guide
  builder.
- Connect-page and completion-dialog tests plus the live design catalog.
- The canonical audit-bundle allowlist needed to include the frontend guidance
  and its root product/design sources required by the review prompt.

## Constraints

- Do not change WHOOP capacity ownership, counting, provider authorization, or
  Apple Health instructions.
- Keep one owner for the setup-guide copy and App Store action.
- Reuse the current Base UI dialog and selected-voice memo.

## Tasks

1. Extract the existing setup-guide modal as a reusable controlled dialog.
2. Move the WHOOP setup-guide model builder to a client-safe shared owner.
3. Route both capacity-error entry paths into that dialog and delete the inline
   fallback.
4. Update focused behavior tests and the existing design-catalog proof state.
5. Complete responsive browser proof, verification, review, and PR gates.

## Evidence

- The capacity branch currently renders `WhoopAppleHealthFallback`, which
  duplicates a subset of the normal WHOOP setup-guide dialog.
- The normal completion dialog already owns the desired voice memo, two-step
  checklist, download action, and Continue with Murph action.
- Focused Web tests pass for the manual and device-intent capacity paths, the
  normal completion path, and the design-catalog entry.
- Canonical diff-aware verification passes: 494 Web test files, 6,216 tests,
  TypeScript, lint, production build, and development smoke.
- The local `product-experience-review` returned `NO FINDINGS`. Existing
  desktop and mobile catalog captures confirm the unchanged guide hierarchy;
  a fresh branch capture is blocked because no in-app browser instance is
  available in this session.
- `pnpm verify:acceptance` passes the touched Web/device-sync surfaces but is
  blocked by three deterministic failures in an untouched assistant-runtime
  diagnostics test caused by a pending-input state schema mismatch. The exact
  test also fails when rerun alone.
- The required Fable UI double-check stopped on explicit usage-credit
  exhaustion, so no Claude fallback was attempted.
- Preliminary ReviewGPT packaging exposed that the canonical bundle omitted
  `agent-docs/FRONTEND.md` even though the reviewer prompt requires it. The
  bundle allowlist now includes the guide and its required root `PRODUCT.md`
  and `DESIGN.md` sources, with focused regression assertions.
- Fresh desktop and mobile evidence was captured from this branch by opening
  `/design?tab=components#whoop-completion-dialog` and activating its direct
  `Preview capacity fallback` control.
