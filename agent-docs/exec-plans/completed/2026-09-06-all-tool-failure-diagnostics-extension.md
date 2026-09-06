# All-tool failure diagnostics extension

Status: completed (patch authoring; repository verification pending locally)
Created: 2026-09-06
Updated: 2026-09-06

## Goal and scope

Extend PR #2985 snapshot ae4e28aefede3dd798c91758a28ce577a7099748 from
automation/event-only telemetry to all returned Murph dynamic-tool failures and
failed command/MCP actions already observed by the tracker. This is a separate
extension record; the original completed plan remains immutable.

## Decisions and implementation

- One private finite metadata helper and one common returned-failure boundary;
  owner-known reasons, explicit unknown fallback, no model/RPC changes.
- Reuse the existing caller's schema/unsupported/outer-exception issues and enrich
  group-specific issues instead of adding a second branch issue. Caller-owned
  admission/finalization refusals use the same helper. Preserve throws.
- Keep the generic completion event codes/keys, predicate and action counts;
  distinguish classification from completion rows, never sum them as calls.
- Recognize Vault CLI through the existing command parser, including finite batch
  families and unknown subcommands; parse only complete <=16KiB error envelopes.
- Reuse the sanitizer, eight-issue cap and best-effort transport. No new I/O,
  persistence, dependencies, timing machinery or telemetry backend.
- Update the existing README contract/query for mixed-version evidence and caps.

## Verification and handoff

Synthetic Vitest coverage was added/updated for common dispatch, modular/inline
owners, fallback, typed exceptions, native caller admission with exact RPC
responses, media serialization, group issue
preservation, CLI/MCP categories, sentinel exclusion, caps and action counts.
An isolated harness executed actual helper/normalizer/display-parser/tracker/
reducer modules: 145 assertions passed. Its unused batch_argv-only dependency
was a fail-closed stub; this is not a full dispatch or Vitest suite pass.

Changed TypeScript parses without syntax errors. A TypeScript-AST audit using
the repository guard's counting rules found no increased per-file complexity
debt or maximum above the limit; added functions are <=20. The actual Babel
complexity guard and Vitest cannot start without snapshot dependencies. Package
typechecking is not green in this dependency-free environment (including absent
Zod/Vitest); a base/head comparison of changed production files found no added
production diagnostics. Root guards and dependency-complete checks belong to
the local application/review step. No production access, live journey, commits
or upstream merges were performed. The handoff is an apply-compatible patch.
