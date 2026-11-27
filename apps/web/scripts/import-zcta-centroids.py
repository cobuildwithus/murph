"""Extract public Census representative points from the pinned national archive."""
import csv
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

archive = Path(sys.argv[1]).read_bytes()
if hashlib.sha256(archive).hexdigest() != "f1e9046b91f6e60686a99343cb2752834c02b0764939403b331c78c017e2c54c":
    raise ValueError("Unexpected 2026 Census ZCTA archive digest")
with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
    with zipped.open("2026_Gaz_zcta_national.txt") as table:
        rows = csv.DictReader(io.TextIOWrapper(table), delimiter="|")
        # Three decimals is about 110 m, finer than a ZIP's representative point.
        points = {row["GEOID"]: [round(float(row["INTPTLAT"]), 3), round(float(row["INTPTLONG"]), 3)] for row in rows}
Path(sys.argv[2]).write_text(json.dumps(points, sort_keys=True, separators=(",", ":")) + "\n")
