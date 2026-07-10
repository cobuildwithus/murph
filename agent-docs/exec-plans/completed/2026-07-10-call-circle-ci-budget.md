# PR 444 Call Circle CI Budget

Date: 2026-07-10
Status: completed
PR: #444

## Goal

Restore the hosted E2E gates after the intentional Call Circle runtime surface
increased the measured runner static boot closure beyond its ratcheted byte
budget.

## Design

- Keep the existing Call Circle architecture and runtime boundary unchanged.
- Ratchet only the static-closure baseline to the exact Linux CI measurement.
- Preserve the existing tolerance and total ceiling; do not add headroom or a
  new budget mechanism.

## Proof

- Runner bundle budget unit tests.
- Hosted runner bundle assembly through the same CI command.
- Final ReviewGPT and PR checks on the pushed correction.

## Progress

- Both failed hosted E2E jobs stop before execution at the identical static
  boot closure measurement: 6,830,249 bytes versus a 6,818,281-byte budget.
- The feature adds a required web-control port, validated response schema, and
  dynamic tool surface; the existing ratchet comment explicitly requires an
  exact baseline update for reviewed intentional growth.

Updated: 2026-07-10
Completed: 2026-07-10
