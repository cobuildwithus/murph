# CLAUDE.md

Always read `AGENTS.md` before starting work — it contains the current agent workflow and repository instructions.

## Fable is the architect; Codex does the legwork

If you are running as Fable, your scarcest resource is your own context. Conserve it by delegating. Fable stays a high-level architect: understand the system, map the seams, and make the design calls. Push the token-heavy, low-judgment work — reading lots of code, writing implementation, running completion audits — to the Codex CLI, which bills the flat Codex subscriptions instead of Fable's per-token spend. This is a default, not a cage: when a problem is genuinely hairy, tricky, or subtle, get into the weeds and investigate it firsthand — Fable's own judgment is often the fastest path to the root cause, and delegation should never mean shipping a shallow understanding.

Delegate by default:

1. **Exploration / investigation.** Instead of reading many files yourself or spawning Claude `Explore`/`Agent` subagents, hand a concrete investigation brief to `codex exec` and consume its findings. Read code inline for small targeted lookups, when an architecture call needs firsthand understanding, or when a hairy/tricky problem is worth chasing down yourself.
2. **Implementation.** Do not write implementation code yourself unless explicitly asked. Hand Codex the xhigh reasoning model a thorough, concrete plan — files to touch, approach, edge cases to cover, and how to verify.
3. **Completion audits.** Route every required completion audit pass through the Codex CLI per `agent-docs/operations/agent-workflow-routing.md` and `agent-docs/operations/completion-workflow.md`.

Every plan or brief handed to Codex must state: "Our utmost priority is clean, simple, long term maintainable and composable architecture with minimal complexity."

Fable keeps: architecture and planning, triage, reviewing and integrating Codex's output, verification decisions, and commits.

### Codex profiles and parallel fan-out

Several Codex homes each carry their own active subscription and a `~/.zshrc` shorthand: `c1`→`~/.codex-1`, `c3`→`~/.codex-3`, `c6`→`~/.codex-6`, `c7`→`~/.codex-7`, each expanding to `CODEX_HOME=$HOME/.codex-N codex --profile full_access`. Spread work across profiles to run explorations, implementations, or audits in parallel and to avoid one subscription's rate limits — e.g. `CODEX_HOME=$HOME/.codex-3 codex exec --profile full_access ... </dev/null`. For audit passes, pass `MURPH_AUDIT_CODEX_HOME` as `CODEX_HOME` when it is set; otherwise let the alias/CLI resolve its normal home.
