from pathlib import Path
import subprocess
import sys


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text()
    if text.count(old) != 1:
        raise RuntimeError(f"{label}: expected one match, found {text.count(old)}")
    path.write_text(text.replace(old, new, 1))


review_script = Path("scripts/finalize-persona-review.py")
fixture = '''    """    const member = {
      assistantDetail: null as number | null,
""",
    """    const member = {
      assistantPersona: null as string | null,
      assistantPersonaCausalSeq: null as bigint | null,
      assistantDetail: null as number | null,
""",
    1,
)'''
replace_once(
    review_script,
    fixture,
    fixture.replace("    1,\n)", "    6,\n)"),
    "repeated hosted preference fixtures",
)

result_pair = '''replace_exact(
    hosted_preferences_test,
    """    })).resolves.toMatchObject({
      assistantTone: "casual",
      assistantVoice: "warm",
""",
    """    })).resolves.toMatchObject({
      assistantPersona: "navy-seal",
      assistantTone: "casual",
      assistantVoice: "warm",
""",
    1,
)'''
replace_once(
    review_script,
    result_pair,
    result_pair.replace("    1,\n)", "    2,\n)"),
    "two-phase persona result assertions",
)

overlapping = '''replace_exact(
    hosted_preferences_test,
    """    })).resolves.toMatchObject({
      assistantTone: "casual",
      assistantVoice: "warm",
      dispatch: {
""",
    """    })).resolves.toMatchObject({
      assistantPersona: "navy-seal",
      assistantTone: "casual",
      assistantVoice: "warm",
      dispatch: {
""",
    1,
)
'''
replace_once(review_script, overlapping, "", "overlapping persona result assertion")

subprocess.run([sys.executable, "scripts/repair-persona-remaining.py"], check=True)
subprocess.run([sys.executable, str(review_script)], check=True)

prompt_path = Path("packages/assistant-engine/src/assistant/persona-prompts.ts")
replace_once(
    prompt_path,
    '    "Do not announce the persona, imitate a real person, or claim its credentials or biography.",\n',
    (
        '    "Do not announce the persona.",\n'
        '    "Do not imitate a real person or claim this persona\'s credentials or biography.",\n'
    ),
    "persona anti-impersonation prompt",
)

Path(__file__).unlink()
print("final persona review transformations complete")
