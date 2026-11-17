#!/usr/bin/env bash
# Usage: import-signing-key-to-kms.sh KMS_KEY_RESOURCE ALGORITHM PEM_PATH
# ALGORITHM: rsa-sign-pkcs1-2048-sha256 | ec-sign-p256-sha256
# Owner-only import. Requires gcloud, openssl, and pyca/cryptography in gcloud's
# Python (CLOUDSDK_PYTHON_SITEPACKAGES=1 enables it for --target-key-file).
# Stdout: created version name and state. The original PEM is never removed.
set +x
set -euo pipefail
umask 077

fail() { printf '%s\n' "$1" >&2; exit 1; }
[[ $# == 3 ]] || fail 'Usage: import-signing-key-to-kms.sh KMS_KEY_RESOURCE ALGORITHM PEM_PATH'
[[ $1 =~ ^projects/([a-z0-9-]+)/locations/([a-z0-9-]+)/keyRings/([A-Za-z0-9_-]+)/cryptoKeys/([A-Za-z0-9_-]+)$ ]] || fail 'Invalid KMS key resource (omit the version).'
project=${BASH_REMATCH[1]}
location=${BASH_REMATCH[2]}
keyring=${BASH_REMATCH[3]}
key=${BASH_REMATCH[4]}
algorithm=$2
[[ $algorithm == rsa-sign-pkcs1-2048-sha256 || $algorithm == ec-sign-p256-sha256 ]] || fail 'Unsupported signing algorithm.'
[[ -f $3 && -r $3 ]] || fail 'PEM file must be a readable regular file.'
command -v gcloud >/dev/null || fail 'gcloud is required.'
command -v openssl >/dev/null || fail 'openssl is required.'
export CLOUDSDK_PYTHON_SITEPACKAGES=1
sdk_python=${CLOUDSDK_PYTHON:-$(gcloud info --format='value(basic.python_location)' 2>/dev/null)}
[[ -n $sdk_python ]] || fail 'Cannot determine gcloud Python; set CLOUDSDK_PYTHON.'
"$sdk_python" -c 'from cryptography.hazmat.primitives.keywrap import aes_key_wrap_with_padding' >/dev/null 2>&1 || fail 'Install pyca/cryptography >=2.2.0 into gcloud Python. --target-key-file needs it and CLOUDSDK_PYTHON_SITEPACKAGES=1.'

import_tmp=$(mktemp -d)
cleanup() {
  # Best-effort overwrite before unlink; use encrypted storage because SSD/COW
  # filesystems cannot guarantee physical erasure of old blocks.
  if [[ -f $import_tmp/key.der ]]; then
    "$sdk_python" - "$import_tmp/key.der" <<'PY' >/dev/null 2>&1 || true
import os, sys
with open(sys.argv[1], 'r+b') as key_file:
    size = os.fstat(key_file.fileno()).st_size
    key_file.write(b'\0' * size)
    key_file.flush()
    os.fsync(key_file.fileno())
PY
  fi
  rm -rf -- "$import_tmp"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
openssl pkcs8 -topk8 -nocrypt -inform PEM -outform DER -passin pass: -in "$3" -out "$import_tmp/key.der" 2>/dev/null || fail 'PEM to PKCS#8 DER conversion failed.'

kms=(--project="$project" --location="$location" --keyring="$keyring" --quiet --verbosity=error)
protection=$(gcloud kms keys describe "$key" "${kms[@]}" --format='value(versionTemplate.protectionLevel)' 2>/dev/null) || fail 'Cannot read target key protection level.'
[[ $protection == SOFTWARE || $protection == HSM ]] || fail 'Target key must use SOFTWARE or HSM protection.'
job=$(gcloud kms import-jobs list "${kms[@]}" --filter="state=ACTIVE AND importMethod=RSA_OAEP_3072_SHA1_AES_256 AND protectionLevel=$protection" --limit=1 --format='value(name)' 2>/dev/null) || fail 'Cannot list import jobs.'
if [[ -z $job ]]; then
  job="signing-import-$(openssl rand -hex 8)"
  gcloud kms import-jobs create "$job" "${kms[@]}" --import-method=rsa-oaep-3072-sha1-aes-256 --protection-level="$(printf '%s' "$protection" | tr '[:upper:]' '[:lower:]')" >/dev/null 2>&1 || fail 'Cannot create import job.'
fi
job=${job##*/}
state=''
for ((attempt=0; attempt<60; attempt++)); do
  state=$(gcloud kms import-jobs describe "$job" "${kms[@]}" --format='value(state)' 2>/dev/null) || fail 'Cannot read import job state.'
  [[ $state == ACTIVE ]] && break
  [[ $state == PENDING_GENERATION ]] || fail 'Import job is not usable.'
  sleep 5
done
[[ $state == ACTIVE ]] || fail 'Import job did not become active within five minutes.'
gcloud kms keys versions import "${kms[@]}" --key="$key" --algorithm="$algorithm" --import-job="$job" --target-key-file="$import_tmp/key.der" --format='value(name,state)' 2>/dev/null || fail 'Key version import failed.'
