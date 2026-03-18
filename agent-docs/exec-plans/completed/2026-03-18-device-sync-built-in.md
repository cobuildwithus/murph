# built-in device-sync daemon packaging and lifecycle

Status: completed
Created: 2026-03-18
Updated: 2026-03-18

## Goal

- Make device sync feel like a built-in Healthy Bob capability by shipping `@healthybob/device-syncd` in the grouped release, installing it with `healthybob`, and letting the CLI own local daemon startup/status/stop behavior on top of the existing localhost HTTP control plane.

## Success criteria

- The fixed-version release manifest and publish metadata include `@healthybob/device-syncd`.
- Installing `healthybob` also installs the device-sync daemon package needed for the local control plane.
- `healthybob device ...` can start or reuse the local daemon instead of requiring the operator to launch `healthybob-device-syncd` manually first.
- The daemon remains a separate local process and HTTP boundary for OAuth callbacks, webhook ingress, and background reconcile work, but the CLI presents it as a first-class built-in service.
- Focused tests cover release-manifest inclusion plus daemon lifecycle and auto-start behavior, and architecture/runtime docs explain the new ownership model.

## Scope

- In scope:
  - release-manifest and package metadata changes for `@healthybob/device-syncd`
  - CLI-owned daemon launcher/state helpers plus `device daemon` command surface and auto-start-on-demand behavior
  - targeted runtime-state helpers, tests, and docs needed to keep the local daemon lifecycle explicit
- Out of scope:
  - replacing the localhost HTTP control plane with in-process calls
  - changing provider OAuth/webhook semantics
  - packaging the web app as a public npm package

## Risks and mitigations

1. Risk: auto-starting a background daemon could become opaque or leave stale state behind.
   Mitigation: persist explicit launcher state, expose status/stop commands, and detect stale or mismatched processes before reusing them.
2. Risk: release/package changes could drift from the fixed-version monorepo contract.
   Mitigation: keep `device-syncd` inside the manifest and update release-shape assertions and docs together.
3. Risk: the CLI and daemon can drift in version or runtime assumptions.
   Mitigation: install them together through a direct package dependency and keep lifecycle logic in CLI code rather than shell wrappers.

## Tasks

1. Add `@healthybob/device-syncd` to the grouped release surface and wire `healthybob` to install it directly.
2. Introduce CLI-owned device daemon lifecycle helpers that can resolve the packaged daemon entrypoint, persist launcher state, and start/reuse/stop the local process safely.
3. Extend the `device` command surface to expose daemon management and automatically ensure the daemon is available for normal device operations.
4. Refresh docs/tests and run the required verification plus completion workflow audits.

## Verification

- Focused: device CLI/client tests plus release-flow assertions covering the added package and daemon lifecycle.
- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
Completed: 2026-03-18
