from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(
            f"{path}: expected one generated syntax fragment, found {count}"
        )
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


CAPABILITY_TEST = (
    "packages/assistant-engine/test/assistant-capability-policy-skills.test.ts"
)
for old, new in [
    (
        "      'Set `message_ref` to that request's visible `ain_...` reference.',",
        '      "Set `message_ref` to that request\'s visible `ain_...` reference.",',
    ),
    (
        "      'The host reloads that exact message and revalidates the provider sender's current room membership and Murph activation.',",
        '      "The host reloads that exact message and revalidates the provider sender\'s current room membership and Murph activation.",',
    ),
    (
        "      'One participant's request never authorizes a different participant's identity, account, contact details, health facts, or other private facts.',",
        '      "One participant\'s request never authorizes a different participant\'s identity, account, contact details, health facts, or other private facts.",',
    ),
    (
        "      'This skill never expands the conversation's scope boundary or authorizes code production or work, school, or professional operations.',",
        '      "This skill never expands the conversation\'s scope boundary or authorizes code production or work, school, or professional operations.",',
    ),
    (
        "      'never infer or disclose another participant's private identity, account, contact, or health facts',",
        '      "never infer or disclose another participant\'s private identity, account, contact, or health facts",',
    ),
]:
    replace_once(CAPABILITY_TEST, old, new)

replace_once(
    "packages/assistant-engine/test/assistant-codex-real-e2e.test.ts",
    "          ].join('\n\n'),",
    r"          ].join('\n\n'),",
)

print("generated group phone-call test syntax fixed")
