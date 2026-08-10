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


INDEX = "packages/health-commons/src/knowledge-index.ts"
old_loop = '''      for (const relation of entity.relations ?? []) {\n        if (relation.type === "parent_family") {\n          const parent = entitiesByKey.get(relation.target);\n          if (!parent) {\n            continue;\n          }\n          insertTopicOwner.run(\n            normalizeTopicPhrase(parent.title),\n            parent.key,\n            entity.key,\n            0,\n          );\n          continue;\n        }\n        if (\n          relation.type !== "child_family"\n          || entity.entityType !== "experiment_family"\n        ) {\n          continue;\n        }\n        const child = entitiesByKey.get(relation.target);\n        if (child?.entityType !== "experiment_family") {\n          continue;\n        }\n        insertTopicOwner.run(\n          normalizeTopicPhrase(entity.title),\n          entity.key,\n          child.key,\n          0,\n        );\n        for (const alias of entity.aliases ?? []) {\n          insertTopicOwner.run(\n            normalizeTopicPhrase(alias),\n            entity.key,\n            child.key,\n            1,\n          );\n        }\n      }\n    }\n    for (const chunk of buildKnowledgeChunks(catalog)) {\n'''
new_loop = '''      for (const relation of entity.relations ?? []) {\n        if (relation.type !== "parent_family") {\n          continue;\n        }\n        const parent = entitiesByKey.get(relation.target);\n        if (!parent) {\n          continue;\n        }\n        insertTopicOwner.run(\n          normalizeTopicPhrase(parent.title),\n          parent.key,\n          entity.key,\n          0,\n        );\n      }\n    }\n    for (const entity of catalog.entities) {\n      if (entity.entityType !== "experiment_family") {\n        continue;\n      }\n      const descendantKeys = collectBroadFamilyDescendantKeys(\n        entity.key,\n        entitiesByKey,\n      );\n      if (descendantKeys.length === 0) {\n        continue;\n      }\n      for (\n        const [index, phrase] of [entity.title, ...(entity.aliases ?? [])].entries()\n      ) {\n        for (const descendantKey of descendantKeys) {\n          insertTopicOwner.run(\n            normalizeTopicPhrase(phrase),\n            entity.key,\n            descendantKey,\n            index === 0 ? 0 : 1,\n          );\n        }\n      }\n    }\n    for (const chunk of buildKnowledgeChunks(catalog)) {\n'''
replace_once(INDEX, old_loop, new_loop)

marker = '''function sourceFindingTargets(\n  entity: HealthCommonsCatalogEntity,\n  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>,\n): HealthCommonsCatalogEntity[] {\n'''
helper = '''function collectBroadFamilyDescendantKeys(\n  rootKey: string,\n  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>,\n): string[] {\n  const root = entitiesByKey.get(rootKey);\n  if (\n    root?.entityType !== "experiment_family"\n    || !(root.relations ?? []).some((relation) => relation.type === "child_family")\n  ) {\n    return [];\n  }\n  const descendants = new Set<string>();\n  const visitedFamilies = new Set<string>();\n  const pendingFamilies = [rootKey];\n\n  while (pendingFamilies.length > 0) {\n    const familyKey = pendingFamilies.shift();\n    if (!familyKey || visitedFamilies.has(familyKey)) {\n      continue;\n    }\n    visitedFamilies.add(familyKey);\n    const family = entitiesByKey.get(familyKey);\n    if (family?.entityType !== "experiment_family") {\n      continue;\n    }\n    for (const relation of family.relations ?? []) {\n      if (relation.type !== "child_family") {\n        continue;\n      }\n      const child = entitiesByKey.get(relation.target);\n      if (child?.entityType !== "experiment_family") {\n        continue;\n      }\n      descendants.add(child.key);\n      pendingFamilies.push(child.key);\n    }\n    for (const candidate of entitiesByKey.values()) {\n      if (\n        candidate.entityType === "protocol_variant"\n        && (candidate.relations ?? []).some((relation) =>\n          relation.type === "parent_family"\n          && relation.target === familyKey\n        )\n      ) {\n        descendants.add(candidate.key);\n      }\n    }\n  }\n\n  return [...descendants].sort((left, right) => left.localeCompare(right));\n}\n\n'''
replace_once(INDEX, marker, helper + marker)

TEST = "packages/health-commons/test/knowledge-index-full-catalog.test.ts"
old_assertion = '''      expect(database.prepare(`\n        SELECT COUNT(*) AS count\n        FROM topic_owners child_owner\n        JOIN topic_owners parent_owner\n          ON parent_owner.phrase = child_owner.phrase\n         AND parent_owner.owner_key = child_owner.owner_key\n         AND parent_owner.entity_key = parent_owner.owner_key\n        WHERE child_owner.entity_key <> child_owner.owner_key\n          AND child_owner.match_priority > 0\n      `).get()).toMatchObject({ count: 0 });\n'''
new_assertion = '''      expect(database.prepare(`\n        SELECT COUNT(*) AS count\n        FROM topic_owners child_owner\n        JOIN topic_owners parent_owner\n          ON parent_owner.phrase = child_owner.phrase\n         AND parent_owner.owner_key = child_owner.owner_key\n         AND parent_owner.entity_key = parent_owner.owner_key\n        WHERE child_owner.entity_key LIKE 'protocol_variant:%'\n          AND child_owner.match_priority > 0\n          AND NOT EXISTS (\n            SELECT 1\n            FROM topic_owners family_child\n            WHERE family_child.phrase = child_owner.phrase\n              AND family_child.owner_key = child_owner.owner_key\n              AND family_child.entity_key LIKE 'experiment_family:%'\n              AND family_child.entity_key <> family_child.owner_key\n          )\n      `).get()).toMatchObject({ count: 0 });\n      expect(database.prepare(`\n        SELECT COUNT(DISTINCT entity_key) AS count\n        FROM topic_owners\n        WHERE phrase = 'sauna'\n          AND owner_key = 'experiment_family:sauna'\n      `).get()).toMatchObject({ count: expect.any(Number) });\n      const saunaOwnerCount = database.prepare(`\n        SELECT COUNT(DISTINCT entity_key) AS count\n        FROM topic_owners\n        WHERE phrase = 'sauna'\n          AND owner_key = 'experiment_family:sauna'\n      `).get();\n      expect(Number(saunaOwnerCount?.count ?? 0)).toBeGreaterThan(3);\n'''
replace_once(TEST, old_assertion, new_assertion)

print("Expanded only authored broad child-family closures into their protocol descendants")
