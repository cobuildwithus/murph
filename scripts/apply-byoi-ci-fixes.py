#!/usr/bin/env python3
"""Apply exact, idempotent BYOI CI integration fixes on the feature branch.

Temporary branch tooling. Remove this file before the pull request is ready.
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


def patch_web_typescript_paths() -> None:
    replace_once(
        "apps/web/tsconfig.json",
        '      "@murphai/hosted-execution/assistant-identifiers": [\n'
        '        "../../packages/hosted-execution/src/assistant-identifiers.ts"\n'
        '      ],\n',
        '      "@murphai/hosted-execution/assistant-identifiers": [\n'
        '        "../../packages/hosted-execution/src/assistant-identifiers.ts"\n'
        '      ],\n'
        '      "@murphai/hosted-execution/assistant-inference": [\n'
        '        "../../packages/hosted-execution/src/assistant-inference.ts"\n'
        '      ],\n',
    )


def patch_connection_store_reader_type() -> None:
    replace_once(
        "apps/web/src/lib/hosted-inference/connection-store.ts",
        "type HostedInferenceConnectionReadClient = PrismaClient | Prisma.TransactionClient;\n",
        "type HostedInferenceConnectionReadClient = PrismaClient | Prisma.TransactionClient;\n\n"
        "type HostedInferenceConnectionSelectionReadClient = {\n"
        "  hostedMember: Pick<\n"
        "    Prisma.TransactionClient[\"hostedMember\"],\n"
        "    \"findUnique\"\n"
        "  >;\n"
        "};\n",
    )
    replace_once(
        "apps/web/src/lib/hosted-inference/connection-store.ts",
        "export async function readSelectedHostedInferenceConnectionOverride(input: {\n"
        "  memberId: string;\n"
        "  prisma?: HostedInferenceConnectionReadClient;\n"
        "}): Promise<HostedAssistantCustomInferenceOverride | null> {\n",
        "export async function readSelectedHostedInferenceConnectionOverride(input: {\n"
        "  memberId: string;\n"
        "  prisma?: HostedInferenceConnectionSelectionReadClient;\n"
        "}): Promise<HostedAssistantCustomInferenceOverride | null> {\n",
    )
    replace_once(
        "apps/web/src/lib/hosted-inference/connection-store.ts",
        "async function readSelectedHostedInferenceConnectionRow(input: {\n"
        "  memberId: string;\n"
        "  prisma?: HostedInferenceConnectionReadClient;\n"
        "}): Promise<HostedInferenceConnectionRow | null> {\n",
        "async function readSelectedHostedInferenceConnectionRow(input: {\n"
        "  memberId: string;\n"
        "  prisma?: HostedInferenceConnectionSelectionReadClient;\n"
        "}): Promise<HostedInferenceConnectionRow | null> {\n",
    )


def patch_package_export_contract() -> None:
    replace_once(
        "packages/hosted-execution/test/hosted-execution.test.ts",
        '      "./assistant-identifiers",\n'
        '      "./assistant-model",\n',
        '      "./assistant-identifiers",\n'
        '      "./assistant-inference",\n'
        '      "./assistant-model",\n',
    )


def main() -> None:
    patch_web_typescript_paths()
    patch_connection_store_reader_type()
    patch_package_export_contract()


if __name__ == "__main__":
    main()
