"""One-time GitHub-hosted transfer to the reviewed Garmin Environment key.

Remove with the migration workflow after the operator imports all five secrets.
This program never calls a provider or imports secrets into GitHub.
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import re
import sys
from typing import Mapping

from nacl import public


SOURCE_REPOSITORY = "cobuildwithus/murph"
WORKFLOW_PATH = ".github/workflows/junction-wearable-secret-migration.yml"
RECIPIENT_REPOSITORY = "cobuildwithus/murph-cloud"
RECIPIENT_ENVIRONMENT = "junction-wearable-canary"
# Public encryption material from this exact recipient Environment API. A new
# recipient or key requires a reviewed source change, never a dispatch input.
RECIPIENT_KEY_ID = "3380204578043523366"
RECIPIENT_PUBLIC_KEY = "FdUkJMi0G3LaTRFYMLo80OodxSf3zKvFTHJx3Si4qns="
SECRET_NAMES = (
    "JUNCTION_API_KEY",
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "KERNEL_API_KEY",
    "GARMIN_CANARY_EMAIL",
    "GARMIN_CANARY_PASSWORD",
)
MAX_SECRET_BYTES = 4096
MAX_CAPSULE_BYTES = 32768
CAPSULE_DIRECTORY = "junction-wearable-secret-migration"
CAPSULE_FILENAME = "capsule.json"


def validate_admission(environment: Mapping[str, str]) -> None:
    expected = {
        "GITHUB_REPOSITORY": SOURCE_REPOSITORY,
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_REF_PROTECTED": "true",
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_RUN_ATTEMPT": "1",
        "GITHUB_WORKFLOW_REF": f"{SOURCE_REPOSITORY}/{WORKFLOW_PATH}@refs/heads/main",
    }
    if any(environment.get(name) != value for name, value in expected.items()):
        raise ValueError("Migration admission failed.")
    sha = environment.get("GITHUB_SHA", "")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Migration revision failed validation.")
    if environment.get("MIGRATION_ADMITTED_SHA") != sha:
        raise ValueError("Migration revision is not current main.")
    if not re.fullmatch(r"[1-9][0-9]{0,19}", environment.get("GITHUB_RUN_ID", "")):
        raise ValueError("Migration run failed validation.")


def build_capsule(environment: Mapping[str, str]) -> bytes:
    validate_admission(environment)
    # Validate every value before encrypting or creating any output. Do not trim,
    # normalize, fingerprint, or serialize plaintext, especially the identity key.
    values = {name: environment.get(name, "").encode("utf-8") for name in SECRET_NAMES}
    if any(not value or len(value) > MAX_SECRET_BYTES for value in values.values()):
        raise ValueError("Migration requires five bounded nonempty values.")
    if not values["JUNCTION_API_KEY"].startswith(b"sk_us_"):
        raise ValueError("Migration requires Junction sandbox US authority.")
    recipient_key = base64.b64decode(RECIPIENT_PUBLIC_KEY, validate=True)
    if len(recipient_key) != public.PublicKey.SIZE:
        raise ValueError("Migration recipient key failed validation.")
    sealed_box = public.SealedBox(public.PublicKey(recipient_key))
    capsule = {
        "contractVersion": 1,
        "source": {
            "repository": SOURCE_REPOSITORY,
            "sha": environment["GITHUB_SHA"],
            "runId": environment["GITHUB_RUN_ID"],
            "runAttempt": 1,
        },
        "recipient": {
            "repository": RECIPIENT_REPOSITORY,
            "environment": RECIPIENT_ENVIRONMENT,
            "keyId": RECIPIENT_KEY_ID,
            "publicKey": RECIPIENT_PUBLIC_KEY,
        },
        "secrets": {
            name: base64.b64encode(sealed_box.encrypt(value)).decode("ascii")
            for name, value in values.items()
        },
    }
    encoded = (json.dumps(capsule, separators=(",", ":")) + "\n").encode("ascii")
    if len(encoded) > MAX_CAPSULE_BYTES:
        raise ValueError("Migration capsule exceeded its size bound.")
    return encoded


def main() -> int:
    try:
        environment = dict(os.environ)
        for name in SECRET_NAMES:
            os.environ.pop(name, None)
        capsule = build_capsule(environment)
        output_directory = Path(environment["RUNNER_TEMP"]) / CAPSULE_DIRECTORY
        # A stale directory or file fails closed; never overwrite another run.
        output_directory.mkdir(mode=0o700)
        descriptor = os.open(
            output_directory / CAPSULE_FILENAME,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL,
            0o600,
        )
        with os.fdopen(descriptor, "wb") as output:
            output.write(capsule)
    except Exception:
        # Exception details can contain credential bytes, so emit no cause/trace.
        print("Garmin secret migration failed.", file=sys.stderr)
        return 1
    print("Sealed five Garmin canary credentials for the pinned recipient.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 1:
        print("Garmin secret migration accepts no arguments.", file=sys.stderr)
        sys.exit(1)
    sys.exit(main())
