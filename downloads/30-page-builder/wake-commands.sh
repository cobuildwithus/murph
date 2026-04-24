#!/usr/bin/env bash
set -euo pipefail

# Refresh the saved thread export without relying on the consumer repo's pnpm workspace state.
'<HOME_DIR>/.nvm/versions/node/v24.14.1/bin/node' '<HOME_DIR>/startup1/murph/node_modules/.pnpm/@cobuild+review-gpt@0.5.76_@cfworker+json-schema@4.1.1/node_modules/@cobuild/review-gpt/dist/bin.mjs' 'thread' 'export' '--browser-endpoint' 'http://127.0.0.1:9554' '--chat-url' 'https://chatgpt.com/c/69ea3b43-8db0-839d-8659-e9a2674b7edc' '--output' '<HOME_DIR>/startup1/murph/downloads/30-page-builder/thread.json'

# Re-download the current assistant artifacts into the wake downloads directory.
# artifact 0: whole-body-red-and-near-infrared-light-exposure.md
'<HOME_DIR>/.nvm/versions/node/v24.14.1/bin/node' '<HOME_DIR>/startup1/murph/node_modules/.pnpm/@cobuild+review-gpt@0.5.76_@cfworker+json-schema@4.1.1/node_modules/@cobuild/review-gpt/dist/bin.mjs' 'thread' 'download' '--browser-endpoint' 'http://127.0.0.1:9554' '--chat-url' 'https://chatgpt.com/c/69ea3b43-8db0-839d-8659-e9a2674b7edc' '--artifact-index' '0' '--output-dir' '<HOME_DIR>/startup1/murph/downloads/30-page-builder/downloads'
# artifact 1: whole-body-photobiomodulation.md
'<HOME_DIR>/.nvm/versions/node/v24.14.1/bin/node' '<HOME_DIR>/startup1/murph/node_modules/.pnpm/@cobuild+review-gpt@0.5.76_@cfworker+json-schema@4.1.1/node_modules/@cobuild/review-gpt/dist/bin.mjs' 'thread' 'download' '--browser-endpoint' 'http://127.0.0.1:9554' '--chat-url' 'https://chatgpt.com/c/69ea3b43-8db0-839d-8659-e9a2674b7edc' '--artifact-index' '1' '--output-dir' '<HOME_DIR>/startup1/murph/downloads/30-page-builder/downloads'
# artifact 2: research-artifacts.json
'<HOME_DIR>/.nvm/versions/node/v24.14.1/bin/node' '<HOME_DIR>/startup1/murph/node_modules/.pnpm/@cobuild+review-gpt@0.5.76_@cfworker+json-schema@4.1.1/node_modules/@cobuild/review-gpt/dist/bin.mjs' 'thread' 'download' '--browser-endpoint' 'http://127.0.0.1:9554' '--chat-url' 'https://chatgpt.com/c/69ea3b43-8db0-839d-8659-e9a2674b7edc' '--artifact-index' '2' '--output-dir' '<HOME_DIR>/startup1/murph/downloads/30-page-builder/downloads'
# artifact 3: whole-body-photobiomodulation-package-draft.zip
'<HOME_DIR>/.nvm/versions/node/v24.14.1/bin/node' '<HOME_DIR>/startup1/murph/node_modules/.pnpm/@cobuild+review-gpt@0.5.76_@cfworker+json-schema@4.1.1/node_modules/@cobuild/review-gpt/dist/bin.mjs' 'thread' 'download' '--browser-endpoint' 'http://127.0.0.1:9554' '--chat-url' 'https://chatgpt.com/c/69ea3b43-8db0-839d-8659-e9a2674b7edc' '--artifact-index' '3' '--output-dir' '<HOME_DIR>/startup1/murph/downloads/30-page-builder/downloads'

# Replace <artifact-index> with an assistant artifact index from thread.json when needed.
'<HOME_DIR>/.nvm/versions/node/v24.14.1/bin/node' '<HOME_DIR>/startup1/murph/node_modules/.pnpm/@cobuild+review-gpt@0.5.76_@cfworker+json-schema@4.1.1/node_modules/@cobuild/review-gpt/dist/bin.mjs' 'thread' 'download' '--browser-endpoint' 'http://127.0.0.1:9554' '--chat-url' 'https://chatgpt.com/c/69ea3b43-8db0-839d-8659-e9a2674b7edc' '--artifact-index' '<artifact-index>' '--output-dir' '<HOME_DIR>/startup1/murph/downloads/30-page-builder/downloads'
