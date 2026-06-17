# Scan bounds invariant

## Goal

Add a baseline invariant that prevents silent latency traps from unbounded
linear-or-worse scans over repo data, runtime state, persisted records, or other
growing collections.

## Success criteria

- `docs/contracts/00-invariants.md` states the general scan-bound rule.
- The rule allows explicit bounded, indexed, paginated, cursor-based, or
  offline/admin-only exceptions when justified.
- The change stays text-only and is pushed to `main`.

## Verification

- Read back the touched invariant doc.
- Use the text-only docs/process verification fast path.
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
