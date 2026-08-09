from pathlib import Path

p = Path('/tmp/apply_message_current_sender.py')
s = p.read_text()

s = s.replace(
    'ROOT = Path.cwd()\n\n\n',
    'ROOT = Path.cwd()\nFAILURES: list[str] = []\n\n\n',
    1,
)

old_funcs = """def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


def append_once(path: str, marker: str, addition: str) -> None:
    text = read(path)
    if addition.strip() in text:
        raise RuntimeError(f"{path}: addition already present")
    if marker not in text:
        raise RuntimeError(f"{path}: marker missing: {marker!r}")
    write(path, text.replace(marker, marker + addition, 1))
"""
new_funcs = """def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        FAILURES.append(
            f"{path}: expected one occurrence, found {count}: {old[:160]!r}",
        )
        return
    write(path, text.replace(old, new, 1))


def append_once(path: str, marker: str, addition: str) -> None:
    text = read(path)
    if addition.strip() in text:
        FAILURES.append(f"{path}: addition already present")
        return
    if marker not in text:
        FAILURES.append(f"{path}: marker missing: {marker!r}")
        return
    write(path, text.replace(marker, marker + addition, 1))
"""
if old_funcs not in s:
    raise SystemExit('function block not found')
s = s.replace(old_funcs, new_funcs, 1)

old_block = """    dedent('''\\
      if (target.kind === "group_sender") {
        if (origin.kind !== "accepted_input") {
          throw new TypeError(`${label}.origin must be an accepted input for group_sender.`);
        }
        return { expiresAt, origin, question, target };
      }
    '''),
    dedent('''\\
      if (
        target.kind === "group_sender"
        || target.kind === "group_sender_private"
      ) {
        if (origin.kind !== "accepted_input") {
          throw new TypeError(
            `${label}.origin must be an accepted input for ${target.kind}.`,
          );
        }
        return { expiresAt, origin, question, target };
      }
    '''),"""
new_block = """    (
        '  if (target.kind === "group_sender") {\\n'
        '    if (origin.kind !== "accepted_input") {\\n'
        '      throw new TypeError(`${label}.origin must be an accepted input for group_sender.`);\\n'
        '    }\\n'
        '    return { expiresAt, origin, question, target };\\n'
        '  }\\n'
    ),
    (
        '  if (\\n'
        '    target.kind === "group_sender"\\n'
        '    || target.kind === "group_sender_private"\\n'
        '  ) {\\n'
        '    if (origin.kind !== "accepted_input") {\\n'
        '      throw new TypeError(\\n'
        '        `${label}.origin must be an accepted input for ${target.kind}.`,\\n'
        '      );\\n'
        '    }\\n'
        '    return { expiresAt, origin, question, target };\\n'
        '  }\\n'
    ),"""
if old_block not in s:
    raise SystemExit('known anchor block not found')
s = s.replace(old_block, new_block, 1)

end = 'print("Applied message_current_sender implementation and focused tests.")\n'
replacement = """if FAILURES:
    print("Patch preflight failed with the following source-anchor mismatches:")
    for failure in FAILURES:
        print(f"- {failure}")
    raise SystemExit(1)

print("Applied message_current_sender implementation and focused tests.")
"""
if end not in s:
    raise SystemExit('end marker missing')
s = s.replace(end, replacement, 1)

p.write_text(s)
