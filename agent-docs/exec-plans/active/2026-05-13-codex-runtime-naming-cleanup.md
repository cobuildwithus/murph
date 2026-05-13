# Codex Runtime Naming Cleanup

## Goal

Collapse the remaining assistant provider-generic runtime naming that now wraps
only Codex execution into Codex-specific modules and internal identifiers.

Success criteria:

- Codex-only assistant runtime files use Codex-specific filenames.
- Internal turn-planning and runtime identifiers use Codex thread/continuity
  names instead of provider-session names where doing so is behavior-preserving.
- Persisted compatibility fields and external diagnostic event names are not
  changed unless the current code already treats them as non-contractual.
- Tests and static guards refer to the new module names.

## Constraints

- Naming and import cleanup only; do not mix in logic changes.
- Preserve existing dirty worktree edits in hosted/web/runtime/Murph Age lanes.
- Do not rename unrelated device/channel provider identifiers.
- Preserve redaction, secret, transcript, and path privacy behavior.

## Plan

1. Map current assistant provider-generic modules and call sites.
2. Rename Codex-only modules and update imports/mocks/static guards.
3. Rename local/internal Codex continuity identifiers where safe.
4. Run focused assistant-engine verification plus required repo checks.
5. Run required completion reviews and commit scoped cleanup if safe.

## Verification

- Pending.

## Handoff Notes

- Pending.

Status: active
Updated: 2026-05-13
