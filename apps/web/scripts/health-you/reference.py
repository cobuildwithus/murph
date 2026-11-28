"""Import only frozen aggregate parameters and invented parity cases from the R17 release."""
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
study = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(study / "model"))
import age
from hazard import BACKGROUND

web = Path(__file__).resolve().parents[2]
def write(path, data):
    path.write_text(json.dumps(data, allow_nan=False, ensure_ascii=False, separators=(",", ":")) + "\n")

keys = ("grade", "unit", "curve", "shrinkage", "log_floor", "minimum", "valid_range",
        "resolution", "age_range", "requires", "method_key", "method_weights")
catalog = {}
for key, row in age.CAT["factors"].items():
    if row["status"] == "scorable":
        catalog[key] = {k: row[k] for k in keys if k in row}
        catalog[key]["source"] = age.CAT["sources"][row["sources"][0]]["url"]
model = {k: age.M[k] for k in ("version", "knots", "prob", "ref", "grip_ref")}
model.update(coef=age.M["fit"]["coef"], strength=age.M["fit"]["strength"],
             fields={k: dict(zip(("group","unit","min","max","low","high","transform"), v)) for k,v in age.FIELDS.items()},
             hip=age.HIP, daily=age.D, unlock=age.UNLOCK, clinical_fit=age.CF,
             clinical_ranks=age.CLINICAL_RANKS,
             lipids={k: dict(zip(("min","max","target","step","ratio","quality"), v)) for k,v in age.clinical.CFG["lipid"].items()},
             candidates={k: dict(zip(("group","unit","min","max","target","step","sign"), v)) for k,v in age.clinical.CFG["candidates"].items()},
             caps=age.clinical.CFG["caps"], lpa_molar=age.clinical.CFG["lpa_molar"], policy=age.POLICY, ordinal=age.ORDINAL, catalog=catalog,
             overlap=age.CAT["overlap"], optional=sorted(age.OPTIONAL), labs=age.LAB,
             feeds=age.CONFIG, extra_context=age.EXTRA_CONTEXT, bridges=age.BRIDGES,
             completion=age.COMPLETION, display=age.FACTOR_TEXT, extra_ranks=age.EXTRA_RANKS,
             background={k: BACKGROUND[k] for k in ("accident_fraction","young_panel","historical")},
             calibration=age.CAL, reference=age.TABLE)
model.update(display_weights=age.doses.EXTRA, step_center=age.doses.STEP_LOG_CENTER,
             dose_curves={k: v["curve"] for k,v in age.doses.CAT["factors"].items()
                         if k in ("bmi","hba1c","hs_crp","steps","mvpa_device","egfr","fasting_glucose")},
             landmark=age.projection.FIT, bootstrap=age.projection.BOOT, projection=age.projection.POL,
             coverage=age.coverage_inputs.PARAMS, evidence=age.evidence_inputs.PARAMS,
             panel=age.panel.FIT, standalone=age.panel.STANDALONE, combine=age.combine_context.CFG)
model["policy"]["protocol"]["member_entered_home_cuff_assumed_validated"] = True
write(web / "src/lib/health-you/engine/model.json", model)
# The canonical action and the scorer share a frozen, versioned closed-choice vocabulary.
questions_path = web.parents[1] / "packages/contracts/src/habit-questions-v1.ts"
questions_path.write_text("// Generated from the frozen version-one form by the age reference importer.\n"
                          + "export const habitQuestionsV1 = "
                          + json.dumps(age.evidence_inputs.QUESTIONS, ensure_ascii=False, indent=2)
                          + " as const;\n")
cases = [row for path in sorted((study / "golden").glob("*.json")) for row in json.loads(path.read_text())]
assert model["version"] == "r17.0" and all(row["history"] for row in cases)
assert len({row["case"] for row in cases}) == len(cases) == 1071
write(web / "test/fixtures/health-you/reference.json", cases)
