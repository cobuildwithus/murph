# Preserve authentication store during hosted verification isolation

Status: completed
Created: 2026-10-16
Updated: 2026-10-16

## Goal

Preserve existing file, keyring and automatic authentication selection while
excluding personal behavioral config and global instructions in hosted checks.

## Success criteria

- Synthetic keyring-only credentials resolve without creating or copying auth files.
- Personal instructions/grants remain excluded; project instructions and managed
  requirements remain effective. CLI and managed overrides retain precedence.
- Existing ignore-all native exec behavior and default App Server behavior stay intact.
- Focused native and composed fixture proofs, renewed sensitive review and exact-head
  CI pass before the user-authorized merge. No deployment or package publication.

## Scope

The authoritative native patch, its native source/tests, composed verification
inspection, and current owner documentation. Completed earlier plan is immutable.
No direct credential inspection/copying, migration, global installation, or runtime-policy relaxation. Existing-account reuse stays opaque.

## Constraints and design

The accepted third-round finding proves the empty user layer loses
cli_auth_credentials_store. The existing AuthConfig owner also depends on
secret_auth_storage for its keyring backend, forced login/workspace restrictions,
and the ChatGPT endpoint. Keep this bounded authentication projection in its
original user layer using an explicit App Server loader option. Existing layer merging owns
precedence; do not rebuild config in the launcher or introduce another auth owner.
The new option defaults off, preserving existing exec isolation behavior. Missing
or invalid auth metadata follows existing native errors, never an auth fallback.

## Tasks

1. Revalidate owned head, source and handoff; trace authentication and profile layers.
2. Add narrow loader selection plus synthetic regression and remove forced File masking.
3. Refresh authoritative patch, rebuild the owned artifact, run focused composed proof.
4. Parent audit and scoped commit; Ready launches exact-head CI. After verification
   and CI complete, run the user-authorized fourth sensitive review.
5. Guarded merge, verify main and adoption, matched closure and sanctioned retirement.

## Decisions

- Explicit user resumption authorizes native-auth remediation, continued review and
  merge after gates. It does not waive verification or authorize deployment.
- Reuse the existing #4144 report; no duplicate friction entry.

## Verification

Native config/login/App Server regressions; selected-artifact fixture and focused
real-Codex journey; patch provenance, privacy, docs and applicable CI. Preserve
known official-baseline daemon limitation independently of the new regression.

## Implementation result

The native user-layer projection retains only credential-store selection,
secret-auth-storage backend selection, login/workspace restrictions, and the
ChatGPT authentication endpoint. It preserves selected-profile, CLI, and managed
precedence. Only isolated App Server opts in; normal App Server and existing
ignore-all exec behavior keep their defaults. Personal proxy settings and
unrelated features remain excluded. The composed inspector no longer forces File.

## Completed proof

- Before the fix, both regression tests fail with File instead of Keyring.
- After the fix, 358 native tests pass: the config owner, App Server isolation,
  and a 40-case ConfigManager-to-AuthManager matrix using a process-local synthetic
  keyring installed before account reads. Both keyring backends, Keyring/Auto,
  normal/isolated startup, and CLI/managed/login restrictions are covered.
- Fourteen launcher/preflight tests and the actual provider resolver-to-adapter
  RPC proof pass with the new artifact and no forced File override.
- The selected-artifact subscription meal journey passes in 19.561 seconds with
  one provider request, one exact meal record, no delivery/automation effects,
  and a truthful reply reviewed Ready.
- Native scoped fix, Murph typecheck, complexity, guarded-context tests, and source
  pin/patch applicability pass. Bazel lock update introduces no drift; only the
  existing workspace keyring test dependency edge enters Cargo.lock.
- The native artifact builds in 182 seconds with two jobs. All 69 packaged source
  files match the built worktree. No global installation, publication, deployment,
  live credential copy, or authentication migration occurred.
- Rust/Just formatting completed; untouched Python/Starlark formatter portions
  lack optional tools. The previously documented daemon fixture expectation
  reproduces against the official unmodified release and is not claimed green.
- Parent source and normal base-merge audits pass. The sole manual base conflict
  retained both documentation-index entries; no runtime merge resolution exists.

## Delivery handoff at archive

Implementation and focused proof are complete. Exact-head PR CI, the explicitly
authorized fourth sensitive review, and the final guarded merge remain delivery
gates. Prior CI is not reused for the new authored head. The first-reviewed head
stays immutable, and the cap retrospective identifies the two test-scaffolding
corrections and original native-auth gap. Source adoption must be verified through
the documented local artifact selection path before matched issue closure;
package publication and production deployment are not implied.
Completed: 2026-10-16
