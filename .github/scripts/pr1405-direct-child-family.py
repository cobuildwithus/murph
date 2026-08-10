from pathlib import Path

path = Path("packages/health-commons/src/knowledge-index.ts")
text = path.read_text(encoding="utf-8")
old = '''      for (const relation of entity.relations ?? []) {
        if (relation.type !== "parent_family") {
          continue;
        }
        const parent = entitiesByKey.get(relation.target);
        if (!parent) {
          continue;
        }
        for (const phrase of canonicalTopicPhrases(parent.title)) {
          insertTopicOwner.run(phrase, parent.key, entity.key, 0);
        }
      }
    }
    for (const chunk of buildKnowledgeChunks(catalog)) {'''
new = '''      for (const relation of entity.relations ?? []) {
        if (relation.type !== "parent_family") {
          continue;
        }
        const parent = entitiesByKey.get(relation.target);
        if (!parent) {
          continue;
        }
        for (const phrase of canonicalTopicPhrases(parent.title)) {
          insertTopicOwner.run(phrase, parent.key, entity.key, 0);
        }
      }
      if (entity.entityType === "experiment_family") {
        for (const relation of entity.relations ?? []) {
          if (relation.type !== "child_family") {
            continue;
          }
          const child = entitiesByKey.get(relation.target);
          if (!child || child.entityType !== "experiment_family") {
            continue;
          }
          for (const phrase of canonicalTopicPhrases(entity.title)) {
            insertTopicOwner.run(phrase, entity.key, child.key, 0);
          }
        }
      }
    }
    for (const chunk of buildKnowledgeChunks(catalog)) {'''
if text.count(old) != 1:
    raise RuntimeError(f"expected one parent-family block, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("Added canonical parent-to-child family topic expansion.")
