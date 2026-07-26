# PR 932 Round 14 Remediation

Status: completed

## Goal

Preserve the exact group signup journey after its first accepted link, without
blocking an independently intended second group reply, and make the existing
group-join design study satisfy the repository's rendered-proof gate.

## Proven gap

An accepted group-aware link consumes its exact outreach but does not mark the
existing daily fact that a signup link was accepted. A later ordinary inbound
can therefore send a second generic link whose destination no longer preserves
the group.

## Direction

- Keep exact source-event identities for group-aware links.
- Keep the daily marker bypass only while an unconsumed group reply context is
  present, so a genuinely distinct group reply remains independently answerable.
- Mark the existing daily signup fact after any accepted group-aware or generic
  link.
- A failed group-aware attempt reopens only its exact outreach and never clears
  a daily marker that may represent another successful link.
- Reuse the existing group-join design study and real production components;
  add no duplicate presentation.

## Proof

- First group-aware link from a null daily marker sets the marker on acceptance.
- A later ordinary same-day inbound returns `signup-link-already-sent` and makes
  no provider call.
- A second valid group reply bypasses the marker and sends under its own exact
  provider identity.
- Receipt-before-milestone failure/recovery keeps the marker monotonic while
  reopening only the exact group context.
- Focused unit and PostgreSQL proof, Web typecheck/lint, canonical diff and
  acceptance verification as routed.
- Desktop/mobile screenshots from `/design?tab=sections`, hosted for the PR
  design-proof check and packaged for the next exact-head ReviewGPT round.

## Completion evidence

- Focused Linq observability and transport tests: 139 passed.
- Isolated real-PostgreSQL group reply recovery proof: 1 passed.
- Frontend design proof guard: 10 passed.
- Documentation drift check: passed.
- Canonical affected-app verification: 6,838 passed, 176 skipped; TypeScript,
  lint, production build, and development smoke checks passed.
- Product-experience review: no findings.
- Rendered desktop and mobile design studies: no overflow and no private data.

Updated: 2026-07-26
Completed: 2026-07-26
