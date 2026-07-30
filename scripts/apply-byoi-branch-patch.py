#!/usr/bin/env python3
"""Apply exact, idempotent BYOI source edits on the feature branch.

This file and its companion workflow are temporary implementation tooling. They
must be removed before the PR is marked ready for review.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text()
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one replacement anchor, found {count}")
    target.write_text(text.replace(old, new, 1))


def write_new(path: str, content: str) -> None:
    target = ROOT / path
    if target.exists():
        if target.read_text() != content:
            raise RuntimeError(f"{path}: existing content differs")
        return
    target.parent.mkdir(parents=True, exist_ok=True)
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
    replace_once(
        "apps/web/prisma/schema.prisma",
        "  codexAuthConnection            HostedCodexAuthConnection?\n",
        "  codexAuthConnection            HostedCodexAuthConnection?\n"
        "  inferenceConnection            HostedInferenceConnection?\n",
    )
    replace_once(
        "apps/web/prisma/schema.prisma",
        "model HostedProductFeedback {\n",
        "model HostedInferenceConnection {\n"
        "  memberId            String       @id @map(\"member_id\")\n"
        "  protocol            String\n"
        "  configEncrypted     String       @map(\"config_encrypted\")\n"
        "  revision            Int          @default(1)\n"
        "  contextWindowTokens Int          @map(\"context_window_tokens\")\n"
        "  supportsImages      Boolean      @default(false) @map(\"supports_images\")\n"
        "  verificationProfile String       @map(\"verification_profile\")\n"
        "  verifiedAt          DateTime     @map(\"verified_at\")\n"
        "  createdAt           DateTime     @default(now()) @map(\"created_at\")\n"
        "  updatedAt           DateTime     @updatedAt @map(\"updated_at\")\n"
        "  member              HostedMember @relation(fields: [memberId], references: [id], onDelete: Cascade)\n"
        "\n"
        "  @@map(\"hosted_inference_connection\")\n"
        "}\n"
        "\n"
        "model HostedProductFeedback {\n",
    )

    write_new(
        "apps/web/prisma/migrations/20260730233000_hosted_inference_connection/migration.sql",
        """BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE \"hosted_inference_connection\" (
  \"member_id\" TEXT NOT NULL,
  \"protocol\" TEXT NOT NULL,
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


def main() -> None:
    patch_crypto_lane()
    patch_prisma_schema()


if __name__ == "__main__":
    main()
