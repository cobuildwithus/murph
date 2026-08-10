from __future__ import annotations

import re
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
        raise RuntimeError(f"{relative}: expected one literal match, found {count}: {old[:120]!r}")
    write(relative, text.replace(old, new, 1))


def replace_regex_once(relative: str, pattern: str, replacement: str) -> None:
    text = read(relative)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{relative}: expected one regex match, found {count}: {pattern}")
    write(relative, updated)


replace_once(
    "packages/health-commons/content/families/sauna.md",
    '''aliases:\n  - passive heat\n''',
    '''aliases:\n  - sauna\n  - passive heat\n''',
)

strict_resolver = r'''function resolveKnowledgeTopic(
  database: DatabaseSync,
  normalizedQuestion: string,
): { ownerKey: string; phrase: string } | null {
  const paddedQuestion = ` ${normalizedQuestion} `;
  const matches = database.prepare(`
    SELECT DISTINCT phrase, owner_key, match_priority
    FROM topic_owners
    ORDER BY length(phrase) DESC, match_priority ASC, owner_key ASC
  `).all().flatMap((row) => {
    const phrase = String(row["phrase"]);
    if (!phrase || !paddedQuestion.includes(` ${phrase} `)) {
      return [];
    }
    return [{
      matchPriority: Number(row["match_priority"]),
      ownerKey: String(row["owner_key"]),
      phrase,
      tokenCount: phrase.split(" ").length,
    }];
  });
  matches.sort((left, right) =>
    right.tokenCount - left.tokenCount
    || right.phrase.length - left.phrase.length
    || left.matchPriority - right.matchPriority
    || left.ownerKey.localeCompare(right.ownerKey)
  );
  const best = matches[0];
  if (!best) {
    return null;
  }
  const equallyRankedOwners = new Set(matches
    .filter((match) =>
      match.tokenCount === best.tokenCount
      && match.phrase.length === best.phrase.length
      && match.matchPriority === best.matchPriority
    )
    .map((match) => match.ownerKey));
  if (equallyRankedOwners.size !== 1) {
    return null;
  }
  return {
    ownerKey: best.ownerKey,
    phrase: best.phrase,
  };
}

function questionFocusTokens'''
replace_regex_once(
    "packages/health-commons/src/knowledge-index.ts",
    r'function resolveKnowledgeTopic\(.*?\nfunction questionFocusTokens',
    strict_resolver,
)

print("Added authored sauna alias and restored identity-first topic resolution")
