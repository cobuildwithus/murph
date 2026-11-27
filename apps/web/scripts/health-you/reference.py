"""Generate frozen aggregates and synthetic parity examples. Run with python -B and the R2 directory."""
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
study = Path(sys.argv[1]).resolve()
sys.path[:0] = [str(study / "tests"), str(study / "model")]
import personas
import age

web = Path(__file__).resolve().parents[2]

def write(path, data):
    path.write_text(json.dumps(data, allow_nan=False, ensure_ascii=False, separators=(",", ":")) + "\n")

# Keep only scoring parameters and published source URLs. No study participants.
keys = ("status", "grade", "unit", "curve", "shrinkage", "log_floor", "minimum", "valid_range",
        "resolution", "age_range", "requires", "method_key", "method_weights")
catalog = {}
for key, row in age.CAT["factors"].items():
    if row["status"] == "scorable":
        catalog[key] = {k: row[k] for k in keys if k in row}
        catalog[key]["source"] = age.CAT["sources"][row["sources"][0]]["url"]
model = {k: age.M[k] for k in ("version", "knots", "prob", "ref", "grip_ref", "completion")}
model.update(coef=age.M["fit"]["coef"], strength=age.M["fit"]["strength"], fields={k: dict(zip(("group","unit","min","max","low","high","transform"), v)) for k,v in age.FIELDS.items()},
             hip=age.HIP, policy=age.POLICY, ordinal=age.ORDINAL, catalog=catalog,
             overlap=age.CAT["overlap"], optional=sorted(age.OPTIONAL), labs=age.LAB)
write(web / "src/lib/health-you/engine/model.json", model)

inputs = {}
cases = []
def case(kind, member, day):
    data = dict(member)
    profile = data.pop("profile")
    inputs.setdefault(kind, data)
    assert inputs[kind] == data
    result = age.from_raw(member, day)
    cases.append(dict(kind=kind, profile=profile, date=day, age=result["biological_age"],
                      real=result["chronological_age"], days=result["days_aged"],
                      tenths=result["contributions_tenths"], ranks=result["ranks"],
                      targets={k:v["target"] for k,v in result["factors"].items()}))

for years in (20, 27, 41, 57, 70, 80):
    for sex in ("female", "male"):
        for kind in personas.KINDS:
            case(kind, personas.member(years, sex, kind), personas.when())
trajectory = personas.member(54, kind="blood")
trajectory.update(personas.wear(65, mod=3, rhr=88))
for row in trajectory["daily"][-22:]:
    row.update(moderate_min=55, rhr=59)
for offset in (-21, -14, -7, 0, 4, 366):
    case("trajectory", trajectory, personas.when(offset))
# Exercise changes of method, panel entry, loss of freshness and amended results.
def extra(kind, **records):
    case(kind, {**personas.member(59), **records}, personas.when())

extra("food-overlap", checkins=[dict(date=personas.when(), method_verified=True,
      diet_pattern="Q5", vegetables=185, fish=80, sugary_drinks=300)])
extra("habit-change", checkins=[dict(date=personas.when(-40), alcohol_g_day=60),
      dict(date=personas.when(-20), alcohol_g_day=4)])
extra("bp-home", bp=[dict(date=personas.when(d), datetime=personas.when(d)+"T"+t,
      setting="home", validated=True, sbp=128, dbp=72)
      for d in (-7,-5,-3) for t in ("06:30","06:33","19:10","19:13")])
extra("same-draw", labs=[personas.lab("hdl",55,"mg/dL",panel_id="sample"),
      personas.lab("total_cholesterol",187,"mg/dL",panel_id="sample")])
extra("amendment", labs=[personas.lab("rdw",13,"%",revision=1),
      personas.lab("rdw",11,"%",revision=2,retracted=True)])
extra("watch-method", vo2=[dict(date=personas.when(d),source="apple",method="device_estimate",value=43)
      for d in (-5,-2)])
extra("late-change", daily=[dict(date=personas.when(d),source="garmin",wear_complete=True,
      rhr=57 if d>-14 else 79,received_at=personas.when() if d>-14 else personas.when(d)) for d in range(-30,1)])
extra("grip-unverified", fitness_tests=[{**r,"verified":"self"} for r in personas.grip()])
write(web / "test/fixtures/health-you/reference.json", dict(inputs=inputs, cases=cases))
