# Add GPT-6 Sol and Luna and make Sol the default

Status: completed
Created: 2026-09-22
Updated: 2026-09-22

## Outcome and invariant

Add exact GPT-6 Sol and Luna model IDs, price both at $2.50 input and $15 output per million tokens, and default managed OpenAI personal and group conversations to GPT-6 Sol. Preserve explicit older-model preferences, custom inference, provider boundaries, and premium Astra/legacy Sol eligibility.

## Owners and scope

Extend the existing hosted-execution model contract, Web preference and allowance owners, native catalog filter, automation model metadata, and Settings choices. No new persistence or migration. Existing null preferences follow the new default; explicit choices remain explicit. Venice keeps its supported GPT-5.6 models and default Terra.

## Product UX

- Effort: Product change.
- Entry and promise: New or default-managed chats use GPT-6 Sol; members can select GPT-6 Luna in Settings or conversation.
- Journeys: Default personal and group chats; explicit legacy model; new-model selection; Venice switching; custom inference; unavailable premium model.
- Proof: Model parsing, preference write/readback, provider rejection, usage pricing, native catalog filtering, and Settings rendering.
- Done when: Focused checks pass and the pinned native runtime contains both new models. Keep the PR draft if release metadata or model availability prevents runtime proof.

## Risks and deployment

Deploy the model-capable runtime and pricing reader before enabling the Web default. Old readers reject new IDs, so activation cannot precede consumer rollout. Do not manufacture native model metadata. OpenAI documentation and latest published Codex 0.155.1 currently omit these models. Cache and service-tier launch rates remain to be confirmed; record assumptions explicitly before readiness.

## Tasks

1. Extend contracts and selection while retaining existing choices.
2. Add requested prices and catalog/default integration.
3. Add focused proof, update durable architecture and public changelog.
4. Run tests/typechecks, review the diff, commit and open the PR.
5. Complete runtime and external review/CI gates when release support permits readiness.

## Verification

- Passing focused suites: Web preference/pricing/Settings; configuration tool and Settings route; hosted-execution provider/model/runtime contracts; assistant automation/configuration; hosted-local catalog/stack; local setup; changelog rendering.
- Passing typechecks: hosted-execution, assistant-engine, hosted-local-harness, setup-cli, Cloudflare, and Web.
- Browser proof: real Settings study at 390px and 1280px, GPT-6 Sol checked, Luna enabled, both unavailable through Venice. Captures inspected locally; no private data.
- Complexity: no debt increase; existing owner hotspots retained without unrelated refactoring.
- Native container contract: 11 checks pass; installed-release catalog check fails because pinned Codex lacks the requested IDs. Latest published 0.155.1 also lacks them.
- Ready status: Hold for launch. Pin a release with authentic native metadata, confirm cache/service-tier pricing, and run a focused real GPT-6 Sol journey before Ready/ReviewGPT/required CI. Current provisional launch rates apply the supplied input rate to every cache bucket with no service-tier adjustment; provenance is explicitly Murph launch configuration.
- No production changes, deployment, live model requests, or merge performed. This plan delivers a reviewable draft; release-dependent follow-up remains explicit in its PR.
Completed: 2026-09-22
