"""Synthetic proof only: real sealed boxes, disposable keys, no provider calls."""

import base64
from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

from nacl import exceptions, public
import yaml


ROOT = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location(
    "garmin_migration", ROOT / "scripts/junction-wearable-secret-migration.py"
)
assert SPEC is not None and SPEC.loader is not None
migration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migration)


def synthetic_environment():
    return {
        "GITHUB_REPOSITORY": "cobuildwithus/murph",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_REF_PROTECTED": "true",
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_RUN_ATTEMPT": "1",
        "GITHUB_WORKFLOW_REF": (
            "cobuildwithus/murph/.github/workflows/"
            "junction-wearable-secret-migration.yml@refs/heads/main"
        ),
        "GITHUB_SHA": "a" * 40,
        "MIGRATION_ADMITTED_SHA": "a" * 40,
        "GITHUB_RUN_ID": "12345",
        "JUNCTION_API_KEY": "sk_us_synthetic-only",
        "JUNCTION_CLIENT_USER_ID_SECRET": " stable synthetic identity\n",
        "KERNEL_API_KEY": "synthetic-browser-authority",
        "GARMIN_CANARY_EMAIL": "garmin@example.test",
        "GARMIN_CANARY_PASSWORD": "  synthetic-π-password\nwith $ and ` bytes  ",
        "UNRELATED_SECRET": "must-never-be-exported",
    }


class SealedMigrationProof(unittest.TestCase):
    def setUp(self):
        self.environment = synthetic_environment()
        self.recipient = public.PrivateKey.generate()
        self.public_key = base64.b64encode(bytes(self.recipient.public_key)).decode("ascii")

    def capsule(self, environment=None):
        # Replace only the public recipient with a disposable test key. Encryption,
        # metadata admission, value validation, and serialization remain real.
        with patch.object(migration, "RECIPIENT_PUBLIC_KEY", self.public_key):
            return migration.build_capsule(environment or self.environment)

    def test_real_recipient_decrypts_every_original_utf8_byte(self):
        encoded = self.capsule()
        capsule = json.loads(encoded)
        self.assertEqual(set(capsule), {"contractVersion", "source", "recipient", "secrets"})
        self.assertEqual(capsule["contractVersion"], 1)
        self.assertEqual(capsule["source"], {
            "repository": "cobuildwithus/murph", "sha": "a" * 40,
            "runId": "12345", "runAttempt": 1,
        })
        self.assertEqual(capsule["recipient"], {
            "repository": "cobuildwithus/murph-cloud",
            "environment": "junction-wearable-canary",
            "keyId": migration.RECIPIENT_KEY_ID,
            "publicKey": self.public_key,
        })
        self.assertEqual(set(capsule["secrets"]), set(migration.SECRET_NAMES))
        for name, ciphertext in capsule["secrets"].items():
            plaintext = public.SealedBox(self.recipient).decrypt(base64.b64decode(ciphertext, validate=True))
            self.assertEqual(plaintext, self.environment[name].encode("utf-8"))
            self.assertNotIn(self.environment[name].encode("utf-8"), encoded)
        self.assertNotIn(b"must-never-be-exported", encoded)

    def test_wrong_recipient_and_modified_ciphertext_fail(self):
        capsule = json.loads(self.capsule())
        ciphertext = base64.b64decode(capsule["secrets"]["GARMIN_CANARY_PASSWORD"])
        with self.assertRaises(exceptions.CryptoError):
            public.SealedBox(public.PrivateKey.generate()).decrypt(ciphertext)
        damaged = bytearray(ciphertext)
        damaged[-1] ^= 1
        with self.assertRaises(exceptions.CryptoError):
            public.SealedBox(self.recipient).decrypt(bytes(damaged))

    def test_environment_cannot_replace_the_reviewed_recipient(self):
        environment = {
            **self.environment,
            "RECIPIENT_PUBLIC_KEY": self.public_key,
            "RECIPIENT_KEY_ID": "attacker-selected",
            "RECIPIENT_REPOSITORY": "untrusted/repository",
        }
        capsule = json.loads(migration.build_capsule(environment))
        self.assertEqual(capsule["recipient"]["publicKey"], migration.RECIPIENT_PUBLIC_KEY)
        self.assertEqual(capsule["recipient"]["keyId"], migration.RECIPIENT_KEY_ID)
        self.assertEqual(capsule["recipient"]["repository"], "cobuildwithus/murph-cloud")
        with self.assertRaises(exceptions.CryptoError):
            public.SealedBox(self.recipient).decrypt(
                base64.b64decode(capsule["secrets"]["JUNCTION_CLIENT_USER_ID_SECRET"])
            )

    def test_repeated_sealing_does_not_publish_a_stable_plaintext_fingerprint(self):
        first = json.loads(self.capsule())["secrets"]
        second = json.loads(self.capsule())["secrets"]
        self.assertTrue(all(first[name] != second[name] for name in migration.SECRET_NAMES))

    def test_rejects_each_missing_empty_and_oversized_secret(self):
        for name in migration.SECRET_NAMES:
            for value in [None, "", "x" * (migration.MAX_SECRET_BYTES + 1)]:
                with self.subTest(name=name, value_kind=type(value).__name__):
                    environment = dict(self.environment)
                    if value is None:
                        del environment[name]
                    else:
                        environment[name] = value
                    with self.assertRaises(ValueError):
                        self.capsule(environment)

    def test_rejects_production_and_wrong_region_before_export(self):
        for key in ["pk_us_synthetic", "pk_eu_synthetic", "sk_eu_synthetic", "not-a-key"]:
            with self.subTest(prefix=key.split("_")[0]):
                with self.assertRaises(ValueError):
                    self.capsule({**self.environment, "JUNCTION_API_KEY": key})

    def test_rejects_every_changed_admission_field(self):
        changes = {
            "GITHUB_REPOSITORY": "untrusted/repository",
            "GITHUB_REF": "refs/heads/feature",
            "GITHUB_REF_PROTECTED": "false",
            "GITHUB_EVENT_NAME": "pull_request",
            "GITHUB_RUN_ATTEMPT": "2",
            "GITHUB_WORKFLOW_REF": "untrusted-workflow@refs/heads/main",
            "GITHUB_SHA": "invalid",
            "MIGRATION_ADMITTED_SHA": "b" * 40,
            "GITHUB_RUN_ID": "0",
        }
        for name, value in changes.items():
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    self.capsule({**self.environment, name: value})

    def test_maximum_values_fit_capsule_bound(self):
        environment = {**self.environment, **{
            name: "x" * migration.MAX_SECRET_BYTES for name in migration.SECRET_NAMES
        }}
        environment["JUNCTION_API_KEY"] = "sk_us_" + "x" * (migration.MAX_SECRET_BYTES - 6)
        self.assertLessEqual(len(self.capsule(environment)), migration.MAX_CAPSULE_BYTES)

    def test_entrypoint_writes_private_file_and_refuses_stale_output(self):
        with tempfile.TemporaryDirectory(prefix="garmin-migration-proof-") as temporary:
            environment = {**self.environment, "RUNNER_TEMP": temporary}
            output, errors = io.StringIO(), io.StringIO()
            with patch.dict(os.environ, environment, clear=True), redirect_stdout(output), redirect_stderr(errors):
                self.assertEqual(migration.main(), 0)
                self.assertTrue(all(name not in os.environ for name in migration.SECRET_NAMES))
            capsule_path = Path(temporary) / migration.CAPSULE_DIRECTORY / migration.CAPSULE_FILENAME
            original = capsule_path.read_bytes()
            self.assertEqual(stat.S_IMODE(capsule_path.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(capsule_path.parent.stat().st_mode), 0o700)
            self.assertEqual(json.loads(original)["recipient"]["publicKey"], migration.RECIPIENT_PUBLIC_KEY)
            with patch.dict(os.environ, environment, clear=True), redirect_stdout(output), redirect_stderr(errors):
                self.assertEqual(migration.main(), 1)
            self.assertEqual(capsule_path.read_bytes(), original)
            self.assertEqual(output.getvalue(), "Sealed five Garmin canary credentials for the pinned recipient.\n")
            self.assertEqual(errors.getvalue(), "Garmin secret migration failed.\n")
            for name in migration.SECRET_NAMES:
                self.assertNotIn(environment[name], output.getvalue() + errors.getvalue())

    def test_failed_validation_writes_nothing_and_logs_no_exception_payload(self):
        with tempfile.TemporaryDirectory(prefix="garmin-migration-proof-") as temporary:
            environment = {**self.environment, "RUNNER_TEMP": temporary, "GARMIN_CANARY_PASSWORD": ""}
            output, errors = io.StringIO(), io.StringIO()
            with patch.dict(os.environ, environment, clear=True), redirect_stdout(output), redirect_stderr(errors):
                self.assertEqual(migration.main(), 1)
            self.assertEqual(list(Path(temporary).iterdir()), [])
            self.assertEqual(output.getvalue(), "")
            self.assertEqual(errors.getvalue(), "Garmin secret migration failed.\n")


class WorkflowAuthorityProof(unittest.TestCase):
    def setUp(self):
        self.workflow = yaml.load(
            (ROOT / migration.WORKFLOW_PATH).read_text(), Loader=yaml.BaseLoader
        )

    def test_only_manual_admitted_main_can_attach_source_environment(self):
        self.assertEqual(set(self.workflow["on"]), {"workflow_dispatch"})
        self.assertEqual(self.workflow["on"]["workflow_dispatch"], "")
        self.assertEqual(self.workflow["permissions"], {"contents": "read"})
        self.assertEqual(self.workflow["concurrency"], {
            "group": "live-junction-wearable-canary", "cancel-in-progress": "false",
        })
        admit = self.workflow["jobs"]["admit"]
        self.assertNotIn("environment", admit)
        self.assertEqual(admit["steps"][0]["env"], {"GH_TOKEN": "${{ github.token }}"})
        for condition in [
            "github.repository == 'cobuildwithus/murph'",
            "github.event_name == 'workflow_dispatch'",
            "github.ref == 'refs/heads/main'", "github.ref_protected", "github.run_attempt == 1",
        ]:
            self.assertIn(condition, admit["if"])
        self.assertIn("git/ref/heads/main", admit["steps"][0]["run"])
        seal = self.workflow["jobs"]["seal"]
        self.assertEqual(seal["needs"], "admit")
        self.assertEqual(seal["if"], admit["if"])
        self.assertEqual(seal["environment"], "junction-wearable-canary")

    def test_credentials_reach_only_the_sealer_after_install_and_main_revalidation(self):
        steps = self.workflow["jobs"]["seal"]["steps"]
        self.assertEqual(set(self.workflow["jobs"]), {"admit", "seal"})
        self.assertNotIn("env", self.workflow)
        for job in self.workflow["jobs"].values():
            self.assertNotIn("env", job)
        secret_steps = [
            (index, step) for index, step in enumerate(steps)
            if "secrets." in json.dumps(step)
        ]
        self.assertEqual(len(secret_steps), 1)
        index, sealer = secret_steps[0]
        self.assertEqual(set(sealer["env"]), {*migration.SECRET_NAMES, "MIGRATION_ADMITTED_SHA"})
        for name in migration.SECRET_NAMES:
            self.assertEqual(sealer["env"][name], "${{ secrets." + name + " }}")
        self.assertEqual(sealer["run"], "/usr/bin/python3 scripts/junction-wearable-secret-migration.py")
        prior = json.dumps(steps[:index])
        self.assertIn("python3-nacl=1.5.0-4build1", prior)
        self.assertIn("junction-wearable-secret-migration.test.py", prior)
        self.assertIn("git/ref/heads/main", steps[index - 1]["run"])
        checkout = steps[0]
        self.assertEqual(checkout["with"]["ref"], "${{ github.sha }}")
        self.assertEqual(checkout["with"]["persist-credentials"], "false")

    def test_pr_proof_never_attaches_an_environment_or_receives_credentials(self):
        proof = yaml.load(
            (ROOT / ".github/workflows/junction-wearable-secret-migration-check.yml").read_text(),
            Loader=yaml.BaseLoader,
        )
        self.assertEqual(proof["permissions"], {"contents": "read"})
        self.assertNotIn("secrets.", json.dumps(proof))
        for job in proof["jobs"].values():
            self.assertNotIn("environment", job)

    def test_only_exact_ciphertext_file_can_be_uploaded_then_owned_cleanup_runs(self):
        steps = self.workflow["jobs"]["seal"]["steps"]
        uploads = [step for step in steps if "actions/upload-artifact@" in step.get("uses", "")]
        self.assertEqual(len(uploads), 1)
        self.assertEqual(uploads[0]["with"], {
            "name": "garmin-secret-migration-${{ github.run_id }}-${{ github.run_attempt }}",
            "path": "${{ runner.temp }}/junction-wearable-secret-migration/capsule.json",
            "if-no-files-found": "error", "retention-days": "1",
        })
        cleanup = steps[-1]
        self.assertIn("steps.seal_capsule.outcome == 'success'", cleanup["if"])
        self.assertIn('rm -f -- "$RUNNER_TEMP/junction-wearable-secret-migration/capsule.json"', cleanup["run"])


if __name__ == "__main__":
    unittest.main()
