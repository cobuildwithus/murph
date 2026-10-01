# Vercel build warnings

## Outcome and owners

Keep Vercel on the supported Node 24 major, make the device daemon executable
available for package-manager linking before compilation, and explicitly retain
the existing disabled dependency-script policy.

The root and Web package manifests own Node selection. The device-syncd package
owns its executable and continues to run the same compiled entrypoint. The
existing pnpm `allowBuilds` block remains the sole script-permission owner.
No dependency is upgraded and no previously blocked install script is enabled.

## Proof

- [x] Frozen installation links the daemon without missing-bin or ignored-script warnings.
- [x] Dependency policy, relevant typechecks, and executable smoke pass.
- [x] Review manifest/lockfile parity and commit the scoped changes.

The previous runtime-correction plan remains immutable. This follow-up extends
the same candidate with build-log cleanup. These changes have no additional
member-visible behavior or separate changelog requirement. Production Web
continues on Node 24; package rollback has no data migration.

Clean frozen offline install passes without build warnings; an existing install
can retain stale pnpm ignored-build records until its install state is refreshed.
Device daemon dependency build, daemon typecheck, dependency policy guard and
its three tests pass. The wrapper smoke reaches the existing missing-config
validation without starting the daemon. The dependency lockfile is unchanged.
Status: completed
Updated: 2026-10-01
Completed: 2026-10-01
