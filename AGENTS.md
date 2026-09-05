# AGENTS.md

## Purpose

Build the requested outcome with the smallest maintainable change. Prefer
removing, reordering, or deriving existing behavior before adding machinery.
Keep detailed rules with their owners; this file is the entrypoint.

## Precedence

Follow system and developer instructions, then the user's task and established
authorization. Within repository guidance, this file takes precedence, followed
by `agent-docs/operations/agent-workflow-routing.md` and the relevant owner doc.
Skills and examples do not create additional authority or override that order.
Resolve routine choices yourself; ask when an unresolved conflict materially
changes scope, product behavior, or permission.

## Read First

Read `agent-docs/operations/agent-workflow-routing.md`, then use
`agent-docs/index.md` to locate the docs relevant to the task. Read the affected
sections, not the entire documentation library. Completed execution plans are
immutable historical evidence, never current operating instructions.

## Task Router

| Task | Read before implementation |
| --- | --- |
| Code, tests, or config | Relevant `ARCHITECTURE.md` sections, `docs/contracts/00-invariants.md`, `agent-docs/ARCHITECTURE_GUIDANCE.md` |
| Verification and completion | `agent-docs/operations/verification-and-runtime.md`, `agent-docs/operations/completion-workflow.md` |
| Product behavior | `agent-docs/PRODUCT_SENSE.md`, `agent-docs/PRODUCT_CONSTITUTION.md`, `agent-docs/operations/product-ux.md` |
| Hosted Web UI | `agent-docs/FRONTEND.md` |
| Murph prompts, tools, routing, or replies | `.agents/skills/verify-murph-assistant/SKILL.md` |
| iMessage/SMS or assistant/provider prompts | `agent-docs/operations/imessage-deliverability.md` |
| Auth, secrets, dependencies, or external boundaries | `agent-docs/SECURITY.md` |
| Concurrency, retries, queues, or failure handling | `agent-docs/RELIABILITY.md` |
| Cloudflare infrastructure | Security and reliability docs above, plus current official Cloudflare docs |
| Test selection or verification changes | `agent-docs/references/testing-ci-map.md` |
| Marketing or Health Commons | `agent-docs/product-marketing-context.md`; `agent-docs/product-specs/health-commons.md` for Commons work |

## Hard Rules (Non-Negotiable)

- Keep secrets, `.env*` contents, direct personal identifiers, local usernames,
  home paths, and private production data out of artifacts and published output.
  Use synthetic examples. Screenshots, transcripts, and feedback are confidential;
  do not copy or closely paraphrase them into source, fixtures, docs, or PRs.
- Production secrets are unavailable to local agents. Do not read, download, or
  inject them, or build a secret-dependent workaround. Explain the blocked step
  and ask about a separately reviewed hosted path first. The sole local exception
  is already-provisioned, opaque Temporal diagnostics as documented in
  `agent-docs/references/hosted-temporal-orchestration.md`; begin read-only and
  require explicit current-task permission for any Temporal mutation.
- A Cloudflare rollback, including restoring older versions or repointing aliases,
  requires explicit permission for that exact rollback.
- Preserve unrelated edits and active work. Before resuming an existing PR,
  establish ownership from its head, worktree, and handoff. An ambiguous owner or
  unexpected head movement blocks mutation until an explicit handoff.
- Signal only processes this session started and whose exact ownership is proven.
  Never use broad process-name termination. Do not force worktree cleanup.
- Keep discovery inside the repository or explicit task roots. Never recursively
  search a home directory or filesystem root. Report missing required tools;
  use an available equivalent when it preserves the needed boundary.
- Use declared public workspace entrypoints and acyclic dependencies. Do not
  import sibling `src/` or `dist/`, add custom Turbopack workspace rewriting,
  or silence type errors with `as any` or an unproved `as unknown` cast.
- Keep dependencies registry-sourced, update the lockfile with manifest changes,
  and preserve pnpm supply-chain checks.
- Prove a bug's cause before fixing it. Preserve product-critical success paths,
  canonical state ownership, and production auth/runtime invariants in tests.
  For database work, apply the invariants' load/fanout rules: bounded collection
  work and short database-only transactions, with external work outside them.
- Use `https://www.withmurph.ai` for absolute production Web URLs.

## Workflow Defaults

- Continue authorized work through focused verification, review, and a scoped
  commit. Respect `review first`, `do not commit`, and other explicit boundaries.
- Use the routing doc for worktrees and plan lifecycle; create task checkouts only
  with `scripts/create-worktree`. Preserve open-PR worktrees and retire completed
  ones through `scripts/retire-worktree` from another checkout.
- Follow the routing doc's § Developer Friction Logging and
  `.agents/skills/frog/SKILL.md`; commit each created entry with the task.
- The completion workflow owns candidate review, PR evidence, and final gates.
  Start required ReviewGPT on the stable pushed head concurrently with CI.
  Keep one completion owner in the original session/thread, preferring `--wait`
  or paced polling. Reserve detached wake for deliberate handoffs; follow the
  review loop's waiting and finding-disposition policies.
- Run checks appropriate to the changed behavior. Once they pass, broaden or
  repeat only for new changes, failures, or a material evidence gap. Required
  exact-head CI remains a completion gate; report blockers honestly.
- Update the durable owner when its contract changes. Update the index when
  adding, removing, moving, or materially repurposing a document.

## Notes

- Before secondary-worktree development, read
  `agent-docs/operations/hosted-local-worktree-dev.md` for coordinated isolation.
- Primary local database: `postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync`.
  Secondary worktrees use `murph_dev_<slug>`; reserve `murph_test` for test lanes.
- For Codex CLI debugging, reuse `../codex`; clone there if needed.
- When Graft and `graft/` are available, use `graft map`, `graft ask "question"
  --source`, or `graft callers <symbol>` as navigation aids. Verify source spans;
  ranked hits are not exhaustive. Otherwise use repository-scoped `rg` and reads.
