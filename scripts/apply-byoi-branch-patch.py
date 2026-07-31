#!/usr/bin/env python3
"""Apply exact, idempotent BYOI source edits on the feature branch.

This file and its companion workflow are temporary implementation tooling. They
must be removed before the PR is marked ready for review.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

INFERENCE_MODEL_LEGACY = """model HostedInferenceConnection {
  memberId            String       @id @map("member_id")
  protocol            String
  configEncrypted     String       @map("config_encrypted")
  revision            Int          @default(1)
  contextWindowTokens Int          @map("context_window_tokens")
  supportsImages      Boolean      @default(false) @map("supports_images")
  verificationProfile String       @map("verification_profile")
  verifiedAt          DateTime     @map("verified_at")
  createdAt           DateTime     @default(now()) @map("created_at")
  updatedAt           DateTime     @updatedAt @map("updated_at")
  member              HostedMember @relation(fields: [memberId], references: [id], onDelete: Cascade)

  @@map("hosted_inference_connection")
}
"""

INFERENCE_MODEL = """model HostedInferenceConnection {
  memberId            String       @id @map("member_id")
  protocol            String
  selected            Boolean      @default(false)
  configEncrypted     String       @map("config_encrypted")
  revision            Int          @default(1)
  contextWindowTokens Int          @map("context_window_tokens")
  supportsImages      Boolean      @default(false) @map("supports_images")
  verificationProfile String       @map("verification_profile")
  verifiedAt          DateTime     @map("verified_at")
  createdAt           DateTime     @default(now()) @map("created_at")
  updatedAt           DateTime     @updatedAt @map("updated_at")
  member              HostedMember @relation(fields: [memberId], references: [id], onDelete: Cascade)

  @@map("hosted_inference_connection")
}
"""


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text()
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one replacement anchor, found {count}")
    target.write_text(text.replace(old, new, 1))


def write_exact(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists() or target.read_text() != content:
        target.write_text(content)


def patch_crypto_lane() -> None:
    replace_once(
        "packages/runtime-state/src/hosted-domain-crypto.ts",
        '  "hosted-member-private-field",\n',
        '  "hosted-member-private-field",\n'
        '  "hosted-inference-connection",\n',
    )
    replace_once(
        "packages/runtime-state/src/hosted-domain-crypto.ts",
        '  "hosted-member-private-field": "control",\n',
        '  "hosted-member-private-field": "control",\n'
        '  "hosted-inference-connection": "control",\n',
    )
    replace_once(
        "apps/web/src/lib/hosted-crypto/secure-box.ts",
        '  "hosted-member-private-field",\n',
        '  "hosted-member-private-field",\n'
        '  "hosted-inference-connection",\n',
    )


def patch_prisma_schema() -> None:
    schema_path = ROOT / "apps/web/prisma/schema.prisma"
    text = schema_path.read_text()

    relation = "  inferenceConnection            HostedInferenceConnection?\n"
    if relation not in text:
        anchor = "  codexAuthConnection            HostedCodexAuthConnection?\n"
        if text.count(anchor) != 1:
            raise RuntimeError("schema.prisma: inference relation anchor drifted")
        text = text.replace(anchor, anchor + relation, 1)

    model_count = text.count("model HostedInferenceConnection {")
    if model_count == 0:
        marker = "model HostedProductFeedback {\n"
        if text.count(marker) != 1:
            raise RuntimeError("schema.prisma: product feedback model anchor drifted")
        text = text.replace(marker, INFERENCE_MODEL + "\n" + marker, 1)
    elif model_count == 1:
        if INFERENCE_MODEL not in text:
            if INFERENCE_MODEL_LEGACY not in text:
                raise RuntimeError("schema.prisma: inference model shape drifted")
            text = text.replace(INFERENCE_MODEL_LEGACY, INFERENCE_MODEL, 1)
    elif model_count == 2:
        if text.count(INFERENCE_MODEL_LEGACY) != 1 or text.count(INFERENCE_MODEL) != 1:
            raise RuntimeError("schema.prisma: unexpected duplicate inference models")
        text = text.replace(INFERENCE_MODEL_LEGACY + "\n", "", 1)
    else:
        raise RuntimeError(
            f"schema.prisma: expected at most two inference models, found {model_count}"
        )

    if text.count("model HostedInferenceConnection {") != 1:
        raise RuntimeError("schema.prisma: inference model did not converge")
    schema_path.write_text(text)

    write_exact(
        "apps/web/prisma/migrations/20260730233000_hosted_inference_connection/migration.sql",
        """BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE \"hosted_inference_connection\" (
  \"member_id\" TEXT NOT NULL,
  \"protocol\" TEXT NOT NULL,
  \"selected\" BOOLEAN NOT NULL DEFAULT false,
  \"config_encrypted\" TEXT NOT NULL,
  \"revision\" INTEGER NOT NULL DEFAULT 1,
  \"context_window_tokens\" INTEGER NOT NULL,
  \"supports_images\" BOOLEAN NOT NULL DEFAULT false,
  \"verification_profile\" TEXT NOT NULL,
  \"verified_at\" TIMESTAMP(3) NOT NULL,
  \"created_at\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \"updated_at\" TIMESTAMP(3) NOT NULL,

  CONSTRAINT \"hosted_inference_connection_pkey\" PRIMARY KEY (\"member_id\"),
  CONSTRAINT \"hosted_inference_connection_protocol_valid\"
    CHECK (\"protocol\" IN ('responses', 'chat_completions')),
  CONSTRAINT \"hosted_inference_connection_revision_valid\"
    CHECK (\"revision\" >= 1),
  CONSTRAINT \"hosted_inference_connection_context_window_valid\"
    CHECK (\"context_window_tokens\" BETWEEN 8192 AND 2000000),
  CONSTRAINT \"hosted_inference_connection_member_id_fkey\"
    FOREIGN KEY (\"member_id\") REFERENCES \"hosted_member\"(\"id\")
    ON DELETE CASCADE ON UPDATE CASCADE
);

COMMIT;
""",
    )


def patch_workspace_contracts() -> None:
    replace_once(
        "packages/hosted-execution/src/runtime-control.ts",
        'import type {\n  AssistantUsageRecord,\n  AssistantUsageTokenPricingBasis,\n} from "./assistant-usage.ts";\n',
        'import type {\n  AssistantUsageRecord,\n  AssistantUsageTokenPricingBasis,\n} from "./assistant-usage.ts";\n'
        'import type {\n  HostedAssistantCustomInferenceOverride,\n} from "./assistant-inference.ts";\n',
    )
    replace_once(
        "packages/hosted-execution/src/runtime-control.ts",
        "export interface HostedWorkspaceReadResponse {\n"
        "  fetchedAt: string;\n",
        "export interface HostedWorkspaceReadResponse {\n"
        "  fetchedAt: string;\n"
        "  hostedAssistantCustomInferenceOverride?: HostedAssistantCustomInferenceOverride;\n",
    )
    replace_once(
        "packages/hosted-execution/src/parsers/runtime-control.ts",
        'import {\n  parseAssistantUsageRecord,\n} from "../assistant-usage.ts";\n',
        'import {\n  parseAssistantUsageRecord,\n} from "../assistant-usage.ts";\n'
        'import {\n  parseHostedAssistantCustomInferenceOverride,\n} from "../assistant-inference.ts";\n',
    )
    replace_once(
        "packages/hosted-execution/src/parsers/runtime-control.ts",
        "  const hostedAssistantModelOverride = parseHostedAssistantModelOverride(\n"
        "    record.hostedAssistantModelOverride,\n"
        "  );\n",
        "  const hostedAssistantCustomInferenceOverride =\n"
        "    record.hostedAssistantCustomInferenceOverride === undefined\n"
        "      || record.hostedAssistantCustomInferenceOverride === null\n"
        "      ? null\n"
        "      : parseHostedAssistantCustomInferenceOverride(\n"
        "          record.hostedAssistantCustomInferenceOverride,\n"
        "        );\n"
        "  const hostedAssistantModelOverride = parseHostedAssistantModelOverride(\n"
        "    record.hostedAssistantModelOverride,\n"
        "  );\n",
    )
    replace_once(
        "packages/hosted-execution/src/parsers/runtime-control.ts",
        "  return {\n"
        "    fetchedAt: requireString(record.fetchedAt, \"Hosted workspace read response fetchedAt\"),\n",
        "  return {\n"
        "    fetchedAt: requireString(record.fetchedAt, \"Hosted workspace read response fetchedAt\"),\n"
        "    ...(hostedAssistantCustomInferenceOverride\n"
        "      ? { hostedAssistantCustomInferenceOverride }\n"
        "      : {}),\n",
    )


def patch_architecture_docs() -> None:
    replace_once(
        "agent-docs/product-specs/bring-your-own-inference.md",
        "- compatibility profile; and\n- verification time.\n\n"
        "Selection reuses `HostedMember.assistantProviderPreference = \"custom\"`. There is\n"
        "no duplicate selected flag, connection id, provider registry, status machine,\n"
        "verification queue, retry row, or Cloudflare copy of durable connection state.\n",
        "- compatibility profile;\n- verification time; and\n- one selection boolean.\n\n"
        "The selection boolean lives on the singular connection so the existing managed\n"
        "OpenAI/Venice, model, and reasoning preferences remain dormant and unchanged.\n"
        "There is no connection id, selected-connection foreign key, provider registry,\n"
        "status machine, verification queue, retry row, or Cloudflare copy of durable\n"
        "connection state. Replacing the connection deselects it until the member\n"
        "explicitly selects the verified replacement.\n",
    )
    replace_once(
        "agent-docs/exec-plans/active/2026-07-30-bring-your-own-inference.md",
        "- The singular connection is selected through the existing provider preference;\n"
        "  updating or deleting the connection first returns the member to managed\n"
        "  inference.\n",
        "- The singular connection owns one selection boolean so managed provider, model,\n"
        "  and reasoning preferences remain untouched. Updating the connection deselects\n"
        "  it before the verified replacement can be selected.\n",
    )
    replace_once(
        "agent-docs/exec-plans/active/2026-07-30-bring-your-own-inference.md",
        "- `assistantProviderPreference = \"custom\"` is the only selection fact; there is\n"
        "  no duplicate selected flag or connection registry.\n",
        "- The singular connection's `selected` boolean is the only custom-selection\n"
        "  fact. Existing managed provider/model/reasoning preferences remain dormant;\n"
        "  there is no selected-connection foreign key or connection registry.\n",
    )


def main() -> None:
    patch_crypto_lane()
    patch_prisma_schema()
    patch_workspace_contracts()
    patch_architecture_docs()


if __name__ == "__main__":
    main()
