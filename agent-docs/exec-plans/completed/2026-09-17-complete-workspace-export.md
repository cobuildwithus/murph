# Complete private workspace exports

## Outcome
Follow the explicit product decision to export the authenticated member's entire
workspace as-is. Remove the prior content exclusions and sanitization from PR
#3537. Preserve existing send approval, original files and workspace ownership.
The prior completed plan is historical evidence, not the current contract.

## Scope and proof
ReviewGPT authors the compact replacement instructions. Parent updates source
owners and tests, then runs focused deterministic proof and the three Terra
journeys: general full export, explicit runtime export, and ordinary file ZIP.
ZIP assertions require every synthetic file and binary byte unchanged, including
credential-named and configuration files; no omission/sanitization notice.
Use no production workspace or credentials. Measure complete provider input for
private and group contexts, review the diff, and finish the existing PR gates.

## Status
Owned worktree and unchanged remote head 92a1cd521a9f verified. PR returned to
Draft. Source audit found no normal plaintext platform key/password/signing-key
writer in the member vault; encrypted device OAuth records are a real runtime
case. The owner explicitly authorizes all workspace files regardless of content.

ReviewGPT supplied both production replacements. The author response was captured
but did not meet the tool's review-duration minimum; parent inspected and applied
it as an authoring draft, never as the final review gate. The complete archive
contract has no content sensitivity exclusions, redaction, sanitization or
additional scope confirmation. Delivery approval and workspace ownership remain.

## Candidate verification
All three real-Codex journeys passed on gpt-5.6-terra: general complete workspace,
explicit runtime inclusion and ordinary file ZIP. Exact ZIP membership and bytes
include the synthetic credential file, hidden configuration, instructions and
binary runtime data. Originals, one staged ZIP and one pending approval pass.
Product UX: Ready. No external member data or provider delivery was exercised.

243 focused assistant cases, package typecheck, four complete provider-input
captures, ten changelog tests, docs drift, complexity diff and whitespace pass.
Private first-request bytes: 157504 to 159360 (+1856, +1.18%); group remains
141587. Exact target tokenizer unavailable. Production diff is two instruction
literals; existing routing, schema and hash/destination send boundaries remain.
Parent candidate review passed. Final review and exact-head CI remain pending.

## Final review and closeout
ReviewGPT round 2 passed on aafb3b2847137cc51216a1827dbf18468d352ebc with
verified gpt-6-pro response and no qualifying findings. Parent final review
accepted that result and confirmed the complete owner-export contract, unchanged
delivery boundaries and synthetic proof. No accepted findings remain.
The final commit only closes this plan; it changes no reviewed runtime behavior.
The existing completed narrower-export plan remains immutable history.
Current main 687897a30cc3 was verified against the remote and merges cleanly.
Final-head CI remains the completion gate; merge and deployment are separate.
Status: completed
Updated: 2026-09-17
Completed: 2026-09-17
