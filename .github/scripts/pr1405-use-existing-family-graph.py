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
        raise RuntimeError(f"{relative}: expected one match, found {count}: {old[:160]!r}")
    write(relative, text.replace(old, new, 1))


replace_once(
    "packages/health-commons/content/families/dry-sauna.md",
    '''  -\n    type: "parent_family"\n    target: "experiment_family:sauna"\n''',
    "",
)
replace_once(
    "packages/health-commons/content/families/infrared-sauna.md",
    '''  -\n    type: parent_family\n    target: experiment_family:sauna\n''',
    "",
)

old_loop = '''      for (const relation of entity.relations ?? []) {\n        if (relation.type !== "parent_family") {\n          continue;\n        }\n        const parent = entitiesByKey.get(relation.target);\n        if (!parent) {\n          continue;\n        }\n        insertTopicOwner.run(normalizeTopicPhrase(parent.title), parent.key, entity.key, 0);\n        if (entity.entityType === "experiment_family") {\n          for (const alias of parent.aliases ?? []) {\n            insertTopicOwner.run(\n              normalizeTopicPhrase(alias),\n              parent.key,\n              entity.key,\n              1,\n            );\n          }\n        }\n      }\n'''
new_loop = '''      for (const relation of entity.relations ?? []) {\n        if (relation.type === "parent_family") {\n          const parent = entitiesByKey.get(relation.target);\n          if (!parent) {\n            continue;\n          }\n          insertTopicOwner.run(\n            normalizeTopicPhrase(parent.title),\n            parent.key,\n            entity.key,\n            0,\n          );\n          continue;\n        }\n        if (\n          relation.type !== "child_family"\n          || entity.entityType !== "experiment_family"\n        ) {\n          continue;\n        }\n        const child = entitiesByKey.get(relation.target);\n        if (child?.entityType !== "experiment_family") {\n          continue;\n        }\n        insertTopicOwner.run(\n          normalizeTopicPhrase(entity.title),\n          entity.key,\n          child.key,\n          0,\n        );\n        for (const alias of entity.aliases ?? []) {\n          insertTopicOwner.run(\n            normalizeTopicPhrase(alias),\n            entity.key,\n            child.key,\n            1,\n          );\n        }\n      }\n'''
replace_once("packages/health-commons/src/knowledge-index.ts", old_loop, new_loop)

print("Reused the existing child_family graph for broad Health Commons topic expansion")
