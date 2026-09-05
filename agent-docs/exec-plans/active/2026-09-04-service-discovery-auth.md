# Service discovery authentication

Status: active

## Outcome and invariant

Search must describe Murph-provided tools using the same exact service allowlist and credential configuration as execution. Personal account ownership and approval remain unchanged.

## Product UX

- Outcome: Supported service searches proceed without an unnecessary account-connection request. Missing server configuration is explained honestly.
- Reaches: Individual and group connected-app searches; personal OAuth searches and mixed service/account results preserve account requirements.
- Proof: Synthetic provider catalog metadata through production search and execution, configuration-unavailable regression, focused assistant journey.

## Design

Project service authentication at the existing Web search response boundary. Preserve schemas, search errors and personal account evidence. Replace contradictory provider connection status and cached workflow advice only when exact configured service actions are returned. No persisted state, new provider call or execution permission.

## Verification

Pending focused service tests, Web typecheck, assistant journey, complexity guard, candidate review, exact-head CI and final ReviewGPT.

## Candidate evidence

- Production owner regressions and focused real-Codex journey pass; synthetic reply and exact effects reviewed Ready.
- Relevant package checks and complexity guard pass. Web preparation requires the normal declared device-syncd package build in a fresh checkout.
- Content-only changelog archive SSR coverage passes; release provenance is bound to this PR.
- Remaining completion gates: final exact-head ReviewGPT, required CI and parent final review. No merge or deployment authorized.
