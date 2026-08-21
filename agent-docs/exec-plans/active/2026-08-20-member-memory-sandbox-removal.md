# Remove Redundant Member-Memory Sandbox Profile

Status: active
Updated: 2026-08-21

## Goal

Delete the member-memory-specific filesystem/network permission profile while
preserving the simpler one-shot maintenance path and successful overnight
memory consolidation.

## Evidence

- The failed implementation depended on a file-scoped writable sandbox mount;
  Codex treated the writable root as a directory and failed before the model
  turn could run.
- The repaired implementation no longer reads or writes memory through shell or
  filesystem access. The host exposes one canonical `murph.member_memory` tool
  only to the exact managed automation.
- The maintenance thread already requests suppression of shell, apps, browser
  use, plugins, web search, environment tools, hosted tool context, artifact
  materialization, progress delivery, and public internet fetch. Host execution
  remains the effect boundary when a provider still advertises native controls.
- The remaining member-specific permission profile duplicates those denials and
  is not the owner of memory read or write authority.

## Constraints

- Keep the exact managed automation-id authorization check.
- Keep the host-owned canonical memory tool as the only state boundary.
- Do not restore shell mutation, vault-wide reads, network tools, or a second
  memory implementation.
- Preserve the fresh one-shot thread and silent no-delivery behavior.

## Plan

1. Remove the member-memory-specific permission profile and its generated
   hosted config.
2. Leave the shared restricted thread configuration and host-owned memory tool
   unchanged.
3. Update focused tests and durable security/reliability claims to describe the
   capability boundary instead of the deleted sandbox mechanism.
4. Run focused package tests and typechecks, then exact-head ReviewGPT and CI.
5. Merge, deploy the Cloudflare execution plane with immediate rollout, and
   verify the exact live version plus bounded memory-maintenance error logs.

## Verification

- ReviewGPT returned a deletion-first implementation patch. Parent inspection
  rejected its changes to files that were identical to the PR base, then kept
  the original 13-file sandbox removal as the complete candidate (`+76/-84`)
  with no provider-authority, model-pricing, or target-reconciliation delta.
- Focused permission-config, assistant-turn, provider-seam, hosted-config, and
  real App Server memory-boundary tests: passed. The App Server scenario ran
  with `danger-full-access`; its provider advertised native controls, the host
  suppressed the attempted shell effect, and canonical memory read/write
  completed through `murph.member_memory`. Per the explicit simplicity
  decision, this PR adds no provider-catalog inventory enforcement.
- Affected `hosted-execution`, `assistant-runtime`, and `assistant-engine`
  package typechecks: passed.
- Exact-head CI and review gates: pending.
- Production deploy and bounded runtime-log verification: pending.
