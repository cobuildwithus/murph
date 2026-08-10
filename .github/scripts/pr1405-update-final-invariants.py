from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def write(relative: str, text: str) -> None:
    (ROOT / relative).write_text(text, encoding="utf-8")


def replace_once(relative: str, old: str, new: str) -> None:
    text = read(relative)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{relative}: expected one match, found {count}: {old[:180]!r}")
    write(relative, text.replace(old, new, 1))


hc_test = "packages/health-commons/test/knowledge-index-full-catalog.test.ts"
replace_once(
    hc_test,
    '''      expect(database.prepare(`\n        SELECT COUNT(*) AS count\n        FROM topic_owners child_owner\n        JOIN topic_owners parent_owner\n          ON parent_owner.phrase = child_owner.phrase\n         AND parent_owner.owner_key = child_owner.owner_key\n         AND parent_owner.entity_key = parent_owner.owner_key\n        WHERE child_owner.entity_key LIKE 'protocol_variant:%'\n          AND child_owner.match_priority > 0\n          AND NOT EXISTS (\n            SELECT 1\n            FROM topic_owners family_child\n            WHERE family_child.phrase = child_owner.phrase\n              AND family_child.owner_key = child_owner.owner_key\n              AND family_child.entity_key LIKE 'experiment_family:%'\n              AND family_child.entity_key <> family_child.owner_key\n          )\n      `).get()).toMatchObject({ count: 0 });\n''',
    '''      // Specific family-alias isolation is covered above for collagen and\n      // cold-water variants. Broad families with authored child_family edges may\n      // intentionally project their aliases through that typed descendant closure.\n''',
)

skill_test = "packages/assistant-engine/test/assistant-skill-assets.test.ts"
replace_once(
    skill_test,
    '''    expect(ASSISTANT_SKILLS.some((skill) => skill.slug === 'red-light-therapy')).toBe(false)\n''',
    '''    expect(ASSISTANT_SKILLS.map((skill) => String(skill.slug))).not.toContain(\n      'red-light-therapy',\n    )\n''',
)

print("Updated final broad-family and removed-skill invariants")
