# Remove Redundant Member-Memory Sandbox Profile

Status: active
Updated: 2026-08-20

## Goal

Delete the member-memory-specific filesystem/network permission profile while
preserving the simpler tool-only maintenance boundary and successful overnight
memory consolidation.

## Evidence

- The failed implementation depended on a file-scoped writable sandbox mount;
  Codex treated the writable root as a directory and failed before the model
  turn could run.
- The repaired implementation no longer reads or writes memory through shell or
  filesystem access. The host exposes one canonical `murph.member_memory` tool
  only to the exact managed automation.
- The maintenance thread already disables shell, apps, browser use, plugins,
  web search, environment tools, hosted tool context, artifact materialization,
  progress delivery, and public internet fetch.
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
2. Leave the shared tool-only thread restriction and host-owned memory tool
   unchanged.
3. Update focused tests and durable security/reliability claims to describe the
   capability boundary instead of the deleted sandbox mechanism.
4. Run focused package tests and typechecks, then exact-head ReviewGPT and CI.
5. Merge, deploy the Cloudflare execution plane with immediate rollout, and
   verify the exact live version plus bounded memory-maintenance error logs.

## Verification

- Focused permission-config, assistant-turn, provider-seam, hosted-config, and
  real App Server memory-boundary tests: passed. The App Server scenario ran
  with `danger-full-access`, did not expose or execute the attempted shell call,
  and completed canonical memory read/write through `murph.member_memory`.
- Affected `hosted-execution`, `assistant-runtime`, and `assistant-engine`
  package typechecks: passed.
- Exact-head round-one preliminary review found that the real App Server test
  proved the forbidden shell effect but did not assert the complete advertised
  provider tool inventory. Direct request inspection proved that Responses Lite
  carries provider tools in `additional_tools` and the former Terra target's
  catalog re-enabled collaboration despite generic feature flags. The focused
  correction pins the managed maintenance seed to hosted OpenAI `gpt-5.5`,
  disables the remaining process-owned registries, and requires every provider
  request to expose exactly the one `member_memory` function. Verification is
  pending.
- Exact-head CI and final review gate: pending.
- Production deploy and bounded runtime-log verification: pending.
