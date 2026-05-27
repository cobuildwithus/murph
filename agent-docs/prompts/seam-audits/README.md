# Seam Audit Prompt Pack

This folder contains one bespoke one-pass audit prompt per major Murph seam.
Each prompt is intentionally short: use one file as the starting prompt for a dedicated review run, then let the reviewer inspect the scoped files and nearby call paths.

## Usage

1. Pick the seam file that matches the owner boundary you want to audit.
2. Give the reviewer the file contents plus the current repo context or relevant diff context.
3. Expect one combined pass that reports concrete risk findings first and behavior-preserving simplification findings second.

## Prompt Files

- [01-contracts.md](./01-contracts.md)
- [02-core-write-batch.md](./02-core-write-batch.md)
- [03-core-event-history-attachments.md](./03-core-event-history-attachments.md)
- [04-core-bank-memory-preferences.md](./04-core-bank-memory-preferences.md)
- [05-core-vault-bootstrap-sync.md](./05-core-vault-bootstrap-sync.md)
- [06-runtime-state.md](./06-runtime-state.md)
- [07-importers-generic.md](./07-importers-generic.md)
- [08-importers-device-providers.md](./08-importers-device-providers.md)
- [09-query-read-model.md](./09-query-read-model.md)
- [10-query-wearables.md](./10-query-wearables.md)
- [11-query-knowledge.md](./11-query-knowledge.md)
- [12-vault-usecases.md](./12-vault-usecases.md)
- [13-device-syncd-config-ingress.md](./13-device-syncd-config-ingress.md)
- [14-device-syncd-runtime-store.md](./14-device-syncd-runtime-store.md)
- [15-messaging-ingress.md](./15-messaging-ingress.md)
- [16-inboxd-capture-persistence.md](./16-inboxd-capture-persistence.md)
- [17-inbox-services.md](./17-inbox-services.md)
- [18-parsers.md](./18-parsers.md)
- [19-gateway-core.md](./19-gateway-core.md)
- [21-assistant-engine-codex-runtime.md](./21-assistant-engine-codex-runtime.md)
- [22-assistant-engine-state-store.md](./22-assistant-engine-state-store.md)
- [23-assistant-engine-automation-delivery.md](./23-assistant-engine-automation-delivery.md)
- [24-assistant-runtime.md](./24-assistant-runtime.md)
- [25-hosted-execution.md](./25-hosted-execution.md)
- [26-cloudflare-hosted-control.md](./26-cloudflare-hosted-control.md)
- [27-web-member-core.md](./27-web-member-core.md)
- [28-web-hosted-runtime-authority.md](./28-web-hosted-runtime-authority.md)
- [29-web-browser-vault-experiments.md](./29-web-browser-vault-experiments.md)
- [30-web-device-sync-messaging-ingress.md](./30-web-device-sync-messaging-ingress.md)
- [31-cloudflare-user-runner.md](./31-cloudflare-user-runner.md)
- [32-cloudflare-runner-container.md](./32-cloudflare-runner-container.md)
- [33-cloudflare-runtime-platform-callbacks.md](./33-cloudflare-runtime-platform-callbacks.md)
- [34-cloudflare-hosted-email.md](./34-cloudflare-hosted-email.md)
- [35-assistantd.md](./35-assistantd.md)
- [36-health-commons.md](./36-health-commons.md)
