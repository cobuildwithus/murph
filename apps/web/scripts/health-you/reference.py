"""Import only frozen aggregate parameters and invented parity cases from the R3 release."""
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
study = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(study / "model"))
import age

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
             hip=age.HIP, policy=age.POLICY, ordinal=age.ORDINAL, catalog=catalog,
             overlap=age.CAT["overlap"], optional=sorted(age.OPTIONAL), labs=age.LAB,
             feeds=age.CONFIG, extra_context=age.EXTRA_CONTEXT, bridges=age.BRIDGES,
             completion=age.COMPLETION, display=age.FACTOR_TEXT, extra_ranks=age.EXTRA_RANKS,
             calibration=age.CAL, reference=age.TABLE)
model["policy"]["protocol"]["member_entered_home_cuff_assumed_validated"] = True
write(web / "src/lib/health-you/engine/model.json", model)
cases = [row for path in sorted((study / "golden").glob("*.json")) for row in json.loads(path.read_text())]
assert len({row["case"] for row in cases}) == len(cases) == 120
write(web / "test/fixtures/health-you/reference.json", cases)
