from __future__ import annotations

from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(
            f"{path}: expected exactly one match, found {count}: {old[:120]!r}"
        )
    write(path, content.replace(old, new, 1))


def sub_once(path: str, pattern: str, replacement: str) -> None:
    content = read(path)
    updated, count = re.subn(
        pattern,
        lambda _match: replacement,
        content,
        count=1,
        flags=re.DOTALL | re.MULTILINE,
    )
    if count != 1:
        raise RuntimeError(
            f"{path}: expected exactly one regex match, found {count}: {pattern[:120]!r}"
        )
    write(path, updated)


# Remove every source-branch validation artifact before producing the candidate.
for pattern in (
    ".github/pr1405-*",
    ".github/scripts/pr1405-*",
    ".github/workflows/pr1405-*",
):
    for target in ROOT.glob(pattern):
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()

# Generic "sauna" is the canonical parent topic. Canonical family titles may
# include typed descendants; ordinary aliases remain family-scoped.
replace_once(
    "packages/health-commons/content/families/sauna.md",
    """title: Sauna / Passive Heat
summary: The broad passive-heat intervention family. User-facing families such as dry sauna and infrared sauna stay separate beneath this parent.
status: field-testing
quality: usable
aliases:
  - sauna
  - passive heat
  - heat exposure""",
    """title: Sauna
summary: The broad passive-heat intervention family. User-facing families such as dry sauna and infrared sauna stay separate beneath this parent.
status: field-testing
quality: usable
aliases:
  - Sauna / Passive Heat
  - passive heat
  - heat exposure""",
)

# Health Commons owns reusable red-light evidence. Delete the duplicate topic
# skill while preserving experiment-onboarding as the explicit try/track flow.
replace_once(
    "packages/assistant-engine/src/assistant-skill-assets.ts",
    """  {
    slug: 'red-light-therapy',
    name: 'red-light-therapy',
    triggerHint:
      'Use for red light therapy or photobiomodulation questions, including dosing, session duration, treatment distance, wavelengths, device irradiance, Bestqool lamps, safety boundaries, and whether to set up a bounded Health Commons PBM experiment.',
  },
""",
    "",
)
replace_once(
    "packages/assistant-engine/src/assistant-skill-assets.ts",
    """      'Use for sauna, cold plunge, contrast therapy, compression, massage, foam rolling, percussion guns, stretching-as-recovery, breathwork-as-recovery, and recovery modality tradeoffs. Use red-light-therapy for red/NIR photobiomodulation dose, duration, distance, wavelengths, device irradiance, or Bestqool questions.',
""",
    """      'Use for sauna, cold plunge, contrast therapy, compression, massage, foam rolling, percussion guns, stretching-as-recovery, breathwork-as-recovery, and recovery modality tradeoffs.',
""",
)
replace_once(
    "packages/assistant-engine/skills/recovery-modalities/SKILL.md",
    """- Use red-light-therapy for red/NIR photobiomodulation dose, duration, distance, wavelengths, device irradiance, Bestqool lamps, or PBM experiment setup.
- This skill does not own PBM device-dose math.
""",
    """- Red/NIR photobiomodulation uses the same Health Commons evidence lookup as every other substantive health topic. Use experiment-onboarding only when the user asks to try or track it.
""",
)
replace_once(
    "packages/assistant-engine/skills/general-eye-health/SKILL.md",
    """- Use red-light-therapy for photobiomodulation devices, dose, and device-specific eye-exposure precautions; return here for eye symptoms or vision changes.
""",
    """- For photobiomodulation evidence, dose, or device-specific questions, use the ordinary Health Commons lookup; this skill still owns eye symptoms, vision changes, and eye-exposure triage.
""",
)

replace_once(
    "packages/assistant-engine/test/assistant-skill-assets.test.ts",
    """
    expect(registeredSkillSlugs.has('red-light-therapy')).toBe(true)
    expect(buildAssistantSkillFileRef('red-light-therapy')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/red-light-therapy/SKILL.md',
    )
""",
    """
    expect(registeredSkillSlugs.has('red-light-therapy')).toBe(false)
""",
)
sub_once(
    "packages/assistant-engine/test/assistant-skill-assets.test.ts",
    r"""  it\('routes red light dose ownership to the dedicated red-light skill', async \(\) => \{.*?^  \}\)\n\n  it\('keeps red light therapy registered with device seed data', async \(\) => \{.*?^  \}\)\n""",
    """  it('keeps red-light research in Health Commons instead of a topic skill', async () => {
    expect(
      ASSISTANT_SKILLS.some((skill) => skill.slug === 'red-light-therapy'),
    ).toBe(false)

    const recoverySkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'recovery-modalities',
    )
    expect(recoverySkill).toBeTruthy()
    if (!recoverySkill) {
      return
    }

    expect(recoverySkill.triggerHint).not.toContain('red-light-therapy')
    const recoveryText = await readSkillFile(recoverySkill)
    expect(recoveryText).toContain('Health Commons evidence lookup')
    expect(recoveryText).not.toContain('device-seeds.json')
  })
""",
)

replace_once(
    "packages/assistant-engine/src/assistant/system-prompt.ts",
    "aerobic-fitness, competition-training, mobility-posture, physical-therapy, recovery-modalities, red-light-therapy.",
    "aerobic-fitness, competition-training, mobility-posture, physical-therapy, recovery-modalities.",
)
replace_once(
    "packages/assistant-engine/test/model-behavior.test.ts",
    "aerobic-fitness, competition-training, mobility-posture, physical-therapy, recovery-modalities, red-light-therapy.",
    "aerobic-fitness, competition-training, mobility-posture, physical-therapy, recovery-modalities.",
)

skill_root = ROOT / "packages/assistant-engine/skills/red-light-therapy"
if not skill_root.is_dir():
    raise RuntimeError("Expected packages/assistant-engine/skills/red-light-therapy")
shutil.rmtree(skill_root)

# Replace the old model-facing exact-title/focus/two-call protocol in the
# product spec with the single natural-question runtime boundary.
spec_path = "agent-docs/product-specs/health-commons.md"
spec = read(spec_path)
start_marker = "The\ngenerated `knowledge.sqlite` FTS projection"
start = spec.find(start_marker)
if start < 0:
    raise RuntimeError(f"{spec_path}: knowledge projection section start not found")
end = spec.find("\nHosted runner packaging", start)
if end < 0:
    raise RuntimeError(f"{spec_path}: knowledge projection section end not found")
replacement = """The generated `knowledge.sqlite` FTS projection gives the assistant a
bounded claim-level read path for ordinary health questions. Authored Markdown
and JSONL remain authoritative. The SQLite file is read-only build output,
contains no user data, and returns a small packet instead of loading the catalog
or source files into a turn. The assistant passes one natural-language question
to `vault-cli commons knowledge search`; exact titles, aliases, question focus,
ranking, result limits, and safety selection remain internal to the Health
Commons reader. The reader resolves the most specific authored title or alias
contained in the question and fails closed when the best phrase has multiple
owners. A canonical family title may include its typed descendants, while family
aliases stay family-scoped. Source findings use one unambiguous authored target:
`related_protocol`, then `parent_family`, then `measures`; multi-target and
untargeted findings stay out until ownership is authored more precisely. The
packet contains at most three distinct sourced evidence items and one relevant
safety item, with at most four direct source locators per item. Safety comes only
from directly sourced safety claims or typed source findings. Unsourced overview
text, page-wide safety arrays, and editorial evidence-appraisal bookkeeping do
not enter the assistant projection. Evidence and safety are returned in the same
lookup, and retrieval never starts or suggests an experiment unless the member
asks to try or track the intervention.
"""
write(spec_path, spec[:start] + replacement + spec[end:])

plan_path = "agent-docs/exec-plans/active/2026-08-07-health-commons-agent-knowledge.md"
plan = read(plan_path)
note = """- Red-light research no longer has a parallel topic skill. Health Commons owns
  reusable evidence; experiment-onboarding remains only for explicit try/track intent.
"""
if note not in plan:
    if not plan.endswith("\n"):
        plan += "\n"
    plan += note
write(plan_path, plan)

remaining = []
for path in (ROOT / "packages/assistant-engine").rglob("*"):
    if path.is_file() and "red-light-therapy" in path.read_text(
        encoding="utf-8", errors="ignore"
    ):
        remaining.append(str(path.relative_to(ROOT)))
if remaining:
    raise RuntimeError(
        "Removed skill is still referenced by: " + ", ".join(sorted(remaining))
    )

print("Applied clean PR #1405 finalization")
