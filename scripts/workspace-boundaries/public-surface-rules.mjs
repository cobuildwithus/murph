import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  pathExists,
  repoRoot,
  sourceMentionsSpecifier,
  sourceMentionsText,
  sourceReexportsSpecifier,
} from "./scanner.mjs";

export async function verifyAssistantEnginePublicSourceSurface(failures) {
  const assistantEngineIndexPath = path.join(repoRoot, "packages", "assistant-engine", "src", "index.ts");
  const assistantEngineProviderPath = path.join(
    repoRoot,
    "packages",
    "assistant-engine",
    "src",
    "assistant-provider.ts",
  );

  const indexSource = await readFile(assistantEngineIndexPath, "utf8");
  const providerSource = await readFile(assistantEngineProviderPath, "utf8");

  for (const specifier of [
    "./assistant-cli-access.js",
    "./assistant-cli-tools.js",
    "./assistant-vault-paths.js",
    "./knowledge.js",
    "./process-kill.js",
  ]) {
    if (sourceReexportsSpecifier(indexSource, specifier)) {
      failures.push(
        specifier === "./knowledge.js"
          ? "packages/assistant-engine/src/index.ts re-exports ./knowledge.js; knowledge operations already have a dedicated @murphai/assistant-engine/knowledge entrypoint and should not leak through the ambient root barrel."
          : `packages/assistant-engine/src/index.ts re-exports ${JSON.stringify(specifier)}; assistant-engine's public root must stay on canonical runtime surfaces instead of leaking internal CLI/config helpers.`,
      );
    }
  }

  if (sourceReexportsSpecifier(providerSource, "./assistant/provider-config.js")) {
    failures.push(
      "packages/assistant-engine/src/assistant-provider.ts re-exports ./assistant/provider-config.js; assistant provider config remains owned by @murphai/operator-config and should not leak through the assistant-provider surface.",
    );
  }

  for (const specifier of [
    "./assistant-cli-access.js",
    "./assistant-cli-tools.js",
  ]) {
    if (sourceReexportsSpecifier(providerSource, specifier)) {
      failures.push(
        `packages/assistant-engine/src/assistant-provider.ts re-exports ${JSON.stringify(specifier)}; assistant-provider must stay on provider runtime state and recovery instead of leaking CLI access or tool-catalog helpers.`,
      );
    }
  }
}

export async function verifyAssistantRuntimePublicSourceSurface(failures) {
  const assistantRuntimeIndexPath = path.join(repoRoot, "packages", "assistant-runtime", "src", "index.ts");
  const indexSource = await readFile(assistantRuntimeIndexPath, "utf8");

  if (sourceMentionsSpecifier(indexSource, "./hosted-email-route.ts")) {
    failures.push(
      "packages/assistant-runtime/src/index.ts re-exports ./hosted-email-route.ts; hosted email self-target reconciliation is an internal runtime helper and must not leak through the assistant-runtime root barrel.",
    );
  }

  if (sourceMentionsSpecifier(indexSource, "./hosted-email.ts")) {
    failures.push(
      "packages/assistant-runtime/src/index.ts re-exports ./hosted-email.ts; hosted email transport codecs should stay on @murphai/assistant-runtime/hosted-email so Cloudflare transport code does not depend on the ambient runtime root.",
    );
  }
}

export async function verifyFocusedOwnerSourceSurfaces(failures) {
  const deletedCompatibilityFiles = [
    {
      path: path.join(repoRoot, "packages", "messaging-ingress", "src", "index.ts"),
      message:
        "packages/messaging-ingress/src/index.ts exists; messaging-ingress is subpath-only and must not revive a package-root barrel beside its explicit provider entrypoints.",
    },
    {
      path: path.join(repoRoot, "packages", "cloudflare-hosted-control", "src", "index.ts"),
      message:
        "packages/cloudflare-hosted-control/src/index.ts exists; cloudflare-hosted-control is subpath-only and must not revive a package-root barrel beside its explicit client and route entrypoints.",
    },
    {
      path: path.join(repoRoot, "packages", "operator-config", "src", "index.ts"),
      message:
        "packages/operator-config/src/index.ts exists; operator-config is subpath-only and must not revive a package-root barrel beside its explicit config and runtime entrypoints.",
    },
    {
      path: path.join(repoRoot, "packages", "operator-config", "src", "knowledge-contracts.ts"),
      message:
        "packages/operator-config/src/knowledge-contracts.ts exists; knowledge result contracts are owned by @murphai/query and must not return through an operator-config compatibility shim.",
    },
    {
      path: path.join(repoRoot, "packages", "assistant-engine", "src", "knowledge", "contracts.ts"),
      message:
        "packages/assistant-engine/src/knowledge/contracts.ts exists; assistant-engine knowledge helpers must depend on @murphai/query directly instead of reviving a local compatibility shim.",
    },
    {
      path: path.join(repoRoot, "packages", "operator-config", "src", "assistant", "state-ids.ts"),
      message:
        "packages/operator-config/src/assistant/state-ids.ts exists; shared assistant opaque id validation is owned by @murphai/runtime-state and must not return through an operator-config helper copy.",
    },
    {
      path: path.join(repoRoot, "packages", "cli", "src", "knowledge-cli-contracts.ts"),
      message:
        "packages/cli/src/knowledge-cli-contracts.ts exists; CLI knowledge command wiring should import query-owned schemas directly instead of carrying a second local knowledge-contract alias layer.",
    },
  ];
  const sourceChecks = [
    {
      path: path.join(repoRoot, "packages", "assistant-engine", "src", "knowledge", "documents.ts"),
      failures: [
        {
          specifier: "./contracts.js",
          message:
            "packages/assistant-engine/src/knowledge/documents.ts imports ./contracts.js; knowledge document helpers should depend on @murphai/query for KnowledgePage types instead of reviving a local compatibility shim.",
        },
      ],
      predicate: sourceMentionsSpecifier,
    },
    {
      path: path.join(repoRoot, "packages", "assistant-engine", "src", "knowledge.ts"),
      failures: [
        {
          specifier: "assertKnowledgeSourcePathAllowed",
          message:
            "packages/assistant-engine/src/knowledge.ts mentions assertKnowledgeSourcePathAllowed; the assistant-engine public knowledge surface should stay on service operations instead of leaking lower-level validation helpers.",
        },
        {
          specifier: "./knowledge/documents.js",
          message:
            "packages/assistant-engine/src/knowledge.ts mentions ./knowledge/documents.js; the assistant-engine public knowledge surface should stay on service operations instead of leaking document-normalization helpers through a second boundary.",
        },
        {
          specifier: "@murphai/query",
          message:
            "packages/assistant-engine/src/knowledge.ts mentions @murphai/query; knowledge result contracts are owned by @murphai/query and should be imported from there directly instead of re-exporting them through @murphai/assistant-engine/knowledge.",
        },
      ],
      predicate: sourceMentionsSpecifier,
    },
    {
      path: path.join(repoRoot, "packages", "assistant-engine", "src", "assistant", "state-ids.ts"),
      failures: [
        {
          specifier: "export function isValidAssistantOpaqueId",
          message:
            "packages/assistant-engine/src/assistant/state-ids.ts declares isValidAssistantOpaqueId locally; shared assistant opaque id helpers are owned by @murphai/runtime-state/assistant-ids and must not be duplicated here.",
        },
      ],
      predicate: sourceMentionsText,
    },
    {
      path: path.join(repoRoot, "packages", "assistant-engine", "src", "assistant", "state-ids.ts"),
      failures: [
        {
          specifier: "@murphai/runtime-state/assistant-ids",
          message:
            "packages/assistant-engine/src/assistant/state-ids.ts re-exports @murphai/runtime-state/assistant-ids; assistant opaque id helpers should stay on the dedicated runtime-state subpath instead of leaking through the assistant-engine state surface.",
        },
      ],
      predicate: sourceReexportsSpecifier,
    },
    {
      path: path.join(repoRoot, "packages", "runtime-state", "src", "index.ts"),
      failures: [
        {
          specifier: "assistant-ids",
          message:
            "packages/runtime-state/src/index.ts mentions assistant-ids; assistant opaque id helpers should stay on the dedicated @murphai/runtime-state/assistant-ids subpath instead of the broad runtime-state root barrel.",
        },
      ],
      predicate: sourceMentionsText,
    },
    {
      path: path.join(repoRoot, "packages", "operator-config", "src", "assistant-cli-contracts.ts"),
      failures: [
        {
          specifier: "./assistant/state-ids.js",
          message:
            "packages/operator-config/src/assistant-cli-contracts.ts imports ./assistant/state-ids.js; assistant opaque id validation should come from @murphai/runtime-state/assistant-ids instead of an operator-config helper copy.",
        },
      ],
      predicate: sourceMentionsSpecifier,
    },
    {
      path: path.join(repoRoot, "packages", "vault-usecases", "src", "query-runtime.ts"),
      failures: [
        {
          specifier: "export const ALL_QUERY_ENTITY_FAMILIES",
          message:
            "packages/vault-usecases/src/query-runtime.ts re-exports ALL_QUERY_ENTITY_FAMILIES; query entity-family metadata is owned by @murphai/query/entity-families and should not flow through the vault-usecases runtime helper layer.",
        },
      ],
      predicate: sourceMentionsSpecifier,
    },
    {
      path: path.join(repoRoot, "packages", "vault-usecases", "src", "runtime.ts"),
      failures: [
        {
          specifier: "ALL_QUERY_ENTITY_FAMILIES",
          message:
            "packages/vault-usecases/src/runtime.ts mentions ALL_QUERY_ENTITY_FAMILIES; query entity-family metadata should stay on @murphai/query/entity-families instead of leaking through @murphai/vault-usecases/runtime.",
        },
      ],
      predicate: sourceMentionsSpecifier,
    },
    {
      path: path.join(repoRoot, "packages", "query", "src", "index.ts"),
      failures: [
        {
          specifier: "ALL_QUERY_ENTITY_FAMILIES",
          message:
            "packages/query/src/index.ts mentions ALL_QUERY_ENTITY_FAMILIES; query entity-family metadata should stay on the dedicated @murphai/query/entity-families subpath instead of the broad query root barrel.",
        },
      ],
      predicate: sourceMentionsText,
    },
    {
      path: path.join(repoRoot, "packages", "device-syncd", "src", "public-ingress.ts"),
      failures: [
        {
          specifier: "./config.ts",
          message:
            "packages/device-syncd/src/public-ingress.ts imports or re-exports ./config.ts; the shared public-ingress seam must stay on provider-agnostic callback and webhook behavior instead of leaking daemon config readers through a second boundary.",
        },
        {
          specifier: "./http.ts",
          message:
            "packages/device-syncd/src/public-ingress.ts imports or re-exports ./http.ts; the shared public-ingress seam must not depend on daemon HTTP helpers when @murphai/device-syncd/http already owns that surface.",
        },
      ],
      predicate: sourceMentionsSpecifier,
    },
    {
      path: path.join(repoRoot, "packages", "cli", "src", "index.ts"),
      failures: [
        {
          specifier: "./knowledge-cli-contracts.js",
          message:
            "packages/cli/src/index.ts re-exports ./knowledge-cli-contracts.js; shared knowledge result contracts belong on @murphai/query, not on the published CLI root surface.",
        },
      ],
      predicate: sourceMentionsSpecifier,
    },
    {
      path: path.join(repoRoot, "packages", "cli", "src", "commands", "knowledge.ts"),
      failures: [
        {
          specifier: "../knowledge-cli-contracts.js",
          message:
            "packages/cli/src/commands/knowledge.ts imports ../knowledge-cli-contracts.js; CLI knowledge commands should consume query-owned schemas directly instead of routing through a package-local alias layer.",
        },
      ],
      predicate: sourceMentionsSpecifier,
    },
    {
      path: path.join(repoRoot, "packages", "cli", "src", "vault-cli-command-manifest.ts"),
      failures: [
        {
          specifier: "./knowledge-cli-contracts.js",
          message:
            "packages/cli/src/vault-cli-command-manifest.ts imports ./knowledge-cli-contracts.js; CLI manifest metadata should reference query-owned knowledge schemas directly instead of a local alias boundary.",
        },
      ],
      predicate: sourceMentionsSpecifier,
    },
    {
      path: path.join(repoRoot, "packages", "messaging-ingress", "src", "telegram-webhook.ts"),
      failures: [
        {
          specifier: "./telegram-webhook-payload.ts",
          message:
            "packages/messaging-ingress/src/telegram-webhook.ts imports or re-exports ./telegram-webhook-payload.ts; raw Telegram payload parsing must stay on its dedicated owner surface instead of hiding behind the thread-target and summary entrypoint.",
        },
      ],
      predicate: sourceMentionsSpecifier,
    },
    {
      path: path.join(repoRoot, "packages", "messaging-ingress", "src", "telegram-webhook-payload.ts"),
      failures: [
        {
          specifier: "./telegram-webhook.ts",
          message:
            "packages/messaging-ingress/src/telegram-webhook-payload.ts imports ./telegram-webhook.ts; raw Telegram payload parsing should depend on shared telegram-types.ts instead of the higher-level summary entrypoint.",
        },
      ],
      predicate: sourceMentionsSpecifier,
    },
    {
      path: path.join(repoRoot, "packages", "query", "src", "knowledge-graph.ts"),
      failures: [
        {
          specifier: "./knowledge-search.ts",
          message:
            "packages/query/src/knowledge-graph.ts imports or re-exports ./knowledge-search.ts; derived-knowledge graph loading must stay readable without routing back through the search owner surface.",
        },
      ],
      predicate: sourceMentionsSpecifier,
    },
  ];

  for (const check of sourceChecks) {
    const source = await readFile(check.path, "utf8");

    for (const failure of check.failures) {
      if (check.predicate(source, failure.specifier)) {
        failures.push(failure.message);
      }
    }
  }

  for (const check of deletedCompatibilityFiles) {
    if (await pathExists(check.path)) {
      failures.push(check.message);
    }
  }

  const knowledgeGraphPath = path.join(repoRoot, "packages", "query", "src", "knowledge-graph.ts");
  const knowledgeGraphSource = await readFile(knowledgeGraphPath, "utf8");

  if (/\bDerivedKnowledgeSearch(?:Filters|Hit|Result)\b/u.test(knowledgeGraphSource)) {
    failures.push(
      "packages/query/src/knowledge-graph.ts still declares derived-knowledge search types; search contracts belong with packages/query/src/knowledge-search.ts so graph loading stays on one owner surface.",
    );
  }
}
