# Runner-Scoped Provider Egress Credential

## Goal

Fix hosted Codex OpenAI egress failures by replacing tokenless
container-identity provider auth with an explicit Murph provider credential
that is scoped to provider + hosted user + hosted runner. This PR wires the
new primitive to OpenAI first because Codex OpenAI egress is the production
breakage.

Success criteria:

- Codex normal `/v1/responses`, WebSocket `/v1/responses`, and
  `/v1/responses/compact` egress can authorize through the native OpenAI bearer
  slot without runtime authority headers, provider-egress side headers, or
  `ctx.containerId` recovery.
- The credential identifies provider, hosted user, and runner, while the
  Worker keeps the real OpenAI key server-side and performs all policy checks
  and usage attribution server-side.
- OpenAI provider egress no longer depends on child-supplied write-fence
  headers, the injected-credential sentinel, or container active-user-fence
  inference. UserRunner still decides live authority from server-side active
  runtime state.
- Warm Codex app-server reuse and Responses WebSockets remain enabled.
- Tokenless OpenAI sentinel-only requests fail closed in production.
- Focused Cloudflare and hosted Codex config tests cover the new boundary.

## Constraints

- Keep the architecture deletion-first and composable: no local gateway, no
  `auth.command`, no per-attempt Codex process churn, and no new generalized
  provider auth framework unless a test proves the simpler OpenAI path cannot
  work.
- Do not expose secrets, raw credentials, full authorization headers, direct
  personal identifiers, local paths, prompt contents, provider bodies, or
  runtime payloads in committed code, docs, tests, logs, or PR text.
- Keep Worker-owned provider secrets in `apps/cloudflare`; the hosted runtime
  must never receive the real OpenAI key.
- The new Murph bearer is a provider-scoped identity credential, not the real
  upstream credential. It may be stable for the runner, but it must still be
  validated server-side against currently active hosted runner state before
  injection.
- Delivery providers and generated media side effects must stay on exact
  write-fence, provider-token, or journal-owned authority. This change starts
  with OpenAI; Exa, Mapbox, `murph_data_api`, and `workers_ai_transcribe` can
  move to the same credential format only in deliberate follow-ups with
  provider-specific tests.
- Avoid broad refactors in the large egress file. Extract only the generic
  provider credential boundary and the minimum validation hooks needed for
  OpenAI.

## Intended Architecture

Current failing shape:

```text
Codex sends the injected-credential sentinel in the native OpenAI bearer slot
Worker sees no bound user/provider token/runtime authority
Worker tries ctx.containerId -> RunnerContainer -> active user fence
Production ctx.containerId is not a resolvable RunnerContainer identity
Worker fails closed before injecting OpenAI auth
```

Target shape:

```text
Codex sends a Murph provider runner credential in the native OpenAI bearer slot
Worker verifies Murph credential and extracts provider/user/runner identity
Worker asks UserRunner whether that runner is currently active for that user/provider
Worker applies OpenAI provider request policy
Worker records/attributes usage to the hosted user
Worker replaces the outbound provider credential with the real Worker-owned OpenAI key
Worker forwards upstream
```

The new invariant:

```text
Provider credential proves provider/user/runner identity.
UserRunner active state proves live provider authority.
Write-fence authority is for Murph internal runtime mutation.
Container identity is never provider-egress authorization.
```

## Approach

1. Add a small generic hosted provider runner credential primitive in
   `apps/cloudflare`, wired to OpenAI first.
   - Use a Worker-only signing secret or derive from an existing Worker-only
     secret only if that derivation stays scoped and documented.
   - Credential claims should include provider kind, user id, runner identity,
     version, and a narrow scope.
   - Do not persist raw credentials. Logs/tests should use placeholders or
     structural assertions only.
2. Mint the credential when building the hosted runner environment for a
   user/runner.
   - Keep Codex config unchanged: `env_key = "OPENAI_API_KEY"` and
     `supports_websockets = true`.
   - Set the runtime `OPENAI_API_KEY` value to the Murph provider credential
     for provider kind `openai` instead of the static injected-credential
     sentinel for real hosted user invocations.
   - Preserve deploy-smoke and local fixture paths with explicit tests.
3. Update OpenAI egress interception.
   - Accept the Murph provider runner credential from the native OpenAI bearer
     slot for OpenAI only in this PR.
   - Validate credential provider kind, runner/user state, and current active
     runtime before injecting the real OpenAI key.
   - Continue to reject requests without a valid OpenAI credential.
   - Remove OpenAI from the tokenless active-user-fence fallback set.
   - Keep non-OpenAI fallback behavior unchanged in this PR, then migrate it
     away from container inference in separate provider-scoped changes.
4. Rename or clarify diagnostics where this path is not actually validating a
   write fence.
   - At minimum, ensure new OpenAI credential failures are logged as provider
     egress auth failures rather than misleading write-fence mismatches.
5. Update durable docs.
   - `ARCHITECTURE.md`, `docs/contracts/00-invariants.md`,
     `agent-docs/SECURITY.md`, `agent-docs/references/hosted-runtime-protocol.md`,
     and `apps/cloudflare/README.md` should describe runner-scoped OpenAI
     egress and the remaining write-fence/providertoken paths accurately.
6. Add focused regression coverage.
   - Valid Murph provider runner bearer for `openai` with no side headers authorizes
     `/v1/responses` and `/v1/responses/compact`.
   - Sentinel-only OpenAI bearer with no side headers fails closed.
   - An opaque production-shaped `ctx.containerId` is irrelevant to successful
     OpenAI auth.
   - Codex hosted config still emits `env_key = "OPENAI_API_KEY"` and keeps
     WebSocket support.
   - Generated runner env carries the Murph credential shape rather than the
     real OpenAI key or the old sentinel for normal hosted user invocations.
7. Run verification.
   - Prefer focused Cloudflare and assistant-runtime tests during iteration.
   - Run `pnpm test:diff <changed paths>` when the diff is stable.
   - Run broader app/repo verification if the diff-aware lane is insufficient
     for the touched high-risk surfaces.
8. Commit and PR.
   - Use `scripts/finish-task` so this plan is archived and the ledger row is
     removed in the scoped commit.
   - Open a PR with the required intent/invariant body and run the PR
     ReviewGPT loop unless explicitly opted out.

## State

Active.

## Notes

- The production incident logs showed `missing_identity` and
  `active_user_context_missing`, not a bad write-fence match. That means the
  Worker had no explicit provider identity and failed before a fence could be
  validated.
- The user explicitly chose the simplification where OpenAI provider egress is
  downgraded from attempt-scoped credential authority to user/runner-scoped
  credential identity, with live authority still decided by server-side active
  runtime state.
  That is the architectural basis for retaining warm Codex processes and
  WebSockets without command auth or a local gateway.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
