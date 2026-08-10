from pathlib import Path

path = Path("packages/device-syncd/test/junction-blood-pressure-backfill.test.ts")
text = path.read_text()
old = '''  assert.equal(result.scheduledJobs?.length ?? 0, 0);\n  assert.equal(result.metadataPatch?.[BP_HISTORY_VERSION_KEY], 1);\n});\n\ntest("ordinary empty webhook fetches do not enter the historical retry ladder"'''
new = '''  assert.equal(\n    result.scheduledJobs?.length ?? 0,\n    0,\n    JSON.stringify(result),\n  );\n  assert.equal(result.metadataPatch?.[BP_HISTORY_VERSION_KEY], 1);\n});\n\ntest("ordinary empty webhook fetches do not enter the historical retry ladder"'''
if text.count(old) != 1:
    raise RuntimeError(f"expected one fetched-record assertion, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
