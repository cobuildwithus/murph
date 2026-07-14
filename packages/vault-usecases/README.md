# @murphai/vault-usecases

Workspace-private owner for CLI/headless vault usecase orchestration.

This package exists to give CLI shells, assistant runtimes, daemons, setup flows, hosted runtime code, and inbox-service helpers one neutral service layer over the real vault owners:

- `packages/core` owns canonical vault writes.
- `packages/importers` owns import parsing and normalization before core writes.
- `packages/query` owns read models, query projections, and export packs.

`@murphai/vault-usecases` composes those owners into command-shaped services and narrow helper seams. It owns shared CLI-style input normalization, typed service interfaces, lazy runtime loaders, assistant-safe vault path helpers, and the `@murphai/vault-usecases/vault-services` factory.

It does not own canonical record schemas, canonical write behavior, query entity-family contracts, query projection storage, device-sync runtime state, inbox daemon behavior, assistant/session state, hosted product facts, or CLI-only device/control-plane composition. Those stay with their owning packages.

Keep this package thin. Add a surface here only when multiple CLI/headless callers need the same vault usecase orchestration and importing the lower-level owner internals would create the wrong dependency direction.

## Clinical FHIR snapshots

`@murphai/vault-usecases/clinical-records` is the explicit execution seam for a
retrieved FHIR snapshot. It validates bounded page files, atomically writes the
immutable pages plus manifest under
`raw/clinical/fhir/<connection>/<retrieval>/`, then lazily loads the clinical
importer and applies its event decisions through core. Stable raw paths allow a
byte-identical crash replay; conflicting bytes at the same retrieval identity
fail closed. Raw evidence commits before canonical projection, so a canonical
write failure can be retried without fetching or rewriting provider data.
