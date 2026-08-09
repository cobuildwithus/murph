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
new_funcs = """def indent_nonblank_lines(value: str, width: int) -> str:
    prefix = ' ' * width
    return ''.join(
        prefix + line if line.strip() else line
        for line in value.splitlines(keepends=True)
    )


def resolve_indented_pair(
    text: str,
    old: str,
    new: str,
) -> tuple[str, str] | None:
    exact_count = text.count(old)
    if exact_count == 1:
        return old, new
    if exact_count > 1:
        return None

    matches: list[tuple[str, str]] = []
    for width in range(1, 41):
        candidate_old = indent_nonblank_lines(old, width)
        count = text.count(candidate_old)
        if count == 1:
            matches.append((candidate_old, indent_nonblank_lines(new, width)))
        elif count > 1:
            return None
    return matches[0] if len(matches) == 1 else None


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    pair = resolve_indented_pair(text, old, new)
    if pair is None:
        FAILURES.append(
            f"{path}: expected one exact or uniformly indented occurrence: {old[:160]!r}",
        )
        return
    resolved_old, resolved_new = pair
    write(path, text.replace(resolved_old, resolved_new, 1))


def append_once(path: str, marker: str, addition: str) -> None:
    text = read(path)
    if addition.strip() in text:
        FAILURES.append(f"{path}: addition already present")
        return
    pair = resolve_indented_pair(text, marker, marker + addition)
    if pair is None:
        FAILURES.append(f"{path}: marker missing or ambiguous: {marker!r}")
        return
    resolved_marker, resolved_replacement = pair
    write(path, text.replace(resolved_marker, resolved_replacement, 1))
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

route_anchor = "    '                    route: currentSenderAuthority.directRoute,\\n',"
route_replacement = "    'route: currentSenderAuthority.directRoute,\\n',"
if route_anchor not in s:
    raise SystemExit('private route anchor missing')
s = s.replace(route_anchor, route_replacement, 1)

end = 'print("Applied message_current_sender implementation and focused tests.")\n'
additional = r'''replace_once(
    "packages/assistant-engine/src/assistant-codex/dynamic-tools.ts",
    dedent('''\
      if (parsed.data.action === 'ask_current_sender') {
        return {
          ok: true,
          request: {
            action: 'ask_current_sender',
            messageRef: parsed.data.message_ref,
          },
        }
      }
      if (parsed.data.action === 'read_shared') {
    '''),
    dedent('''\
      if (
        parsed.data.action === 'ask_current_sender'
        || parsed.data.action === 'message_current_sender'
      ) {
        return {
          ok: true,
          request: {
            action: parsed.data.action,
            messageRef: parsed.data.message_ref,
          },
        }
      }
      if (parsed.data.action === 'read_shared') {
    '''),
)

'''
replacement = additional + """if FAILURES:
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
