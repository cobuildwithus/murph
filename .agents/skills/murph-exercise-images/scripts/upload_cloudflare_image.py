#!/usr/bin/env python3
"""Upload a generated image to Cloudflare Images without printing secrets."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path
from typing import Any


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def resolve_env_value(name: str, env_file_values: dict[str, str]) -> str | None:
    return os.environ.get(name) or env_file_values.get(name)


def latest_generated_png(generated_root: Path) -> Path | None:
    candidates = [path for path in generated_root.rglob("*.png") if path.is_file()]
    if not candidates:
        return None
    return max(candidates, key=lambda path: path.stat().st_mtime)


def account_id_from_api(token: str) -> str | None:
    cmd = [
        "curl",
        "-sS",
        "-H",
        f"Authorization: Bearer {token}",
        "https://api.cloudflare.com/client/v4/accounts",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if proc.returncode != 0:
        return None
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None

    accounts = payload.get("result") or []
    if not payload.get("success") or not accounts:
        return None
    account_id = accounts[0].get("id")
    return account_id if isinstance(account_id, str) and account_id else None


def sanitized_errors(payload: dict[str, Any]) -> list[dict[str, Any]]:
    errors = payload.get("errors") or []
    safe: list[dict[str, Any]] = []
    for error in errors[:5]:
        if isinstance(error, dict):
            safe.append({"code": error.get("code"), "message": error.get("message")})
    return safe


def upload_image(
    *,
    account_id: str,
    token: str,
    image_path: Path,
    metadata: str,
    require_signed_urls: bool,
) -> dict[str, Any]:
    cmd = [
        "curl",
        "-sS",
        "--request",
        "POST",
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}/images/v1",
        "--header",
        f"Authorization: Bearer {token}",
        "--form",
        f"file=@{image_path};type=image/png",
        "--form",
        f"metadata={metadata}",
        "--form",
        f"requireSignedURLs={str(require_signed_urls).lower()}",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    if proc.returncode != 0:
        return {"success": False, "errors": [{"message": "upload command failed"}]}

    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"success": False, "errors": [{"message": "upload returned non-json response"}]}

    result = payload.get("result") or {}
    return {
        "success": payload.get("success"),
        "id": result.get("id"),
        "filename": result.get("filename"),
        "variants": result.get("variants") or [],
        "error_count": len(payload.get("errors") or []),
        "errors": sanitized_errors(payload),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Upload an image to Cloudflare Images.")
    parser.add_argument("--file", type=Path, help="Image file to upload.")
    parser.add_argument(
        "--latest-generated",
        action="store_true",
        help="Upload the newest PNG under CODEX_HOME/generated_images.",
    )
    parser.add_argument(
        "--generated-root",
        type=Path,
        default=Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")) / "generated_images",
        help="Root to search with --latest-generated.",
    )
    parser.add_argument("--env-file", type=Path, default=Path.cwd() / ".env")
    parser.add_argument("--account-id", help="Cloudflare account ID. Avoids account lookup.")
    parser.add_argument(
        "--metadata",
        default='{"purpose":"exercise-image","source":"generated-image"}',
        help="JSON metadata string stored privately with Cloudflare Images.",
    )
    parser.add_argument("--require-signed-urls", action="store_true")
    args = parser.parse_args()

    env_values = parse_env_file(args.env_file)
    images_token = resolve_env_value("CLOUDFLARE_IMAGES_API_KEY", env_values)
    if not images_token:
        print(
            json.dumps(
                {"success": False, "errors": [{"message": "CLOUDFLARE_IMAGES_API_KEY not found"}]},
                indent=2,
            )
        )
        return 1

    if args.file and args.latest_generated:
        print(
            json.dumps(
                {"success": False, "errors": [{"message": "choose --file or --latest-generated, not both"}]},
                indent=2,
            )
        )
        return 1

    image_path = args.file
    if args.latest_generated:
        image_path = latest_generated_png(args.generated_root)
    if not image_path:
        print(json.dumps({"success": False, "errors": [{"message": "no image file selected"}]}, indent=2))
        return 1

    image_path = image_path.expanduser()
    if not image_path.exists() or not image_path.is_file():
        print(json.dumps({"success": False, "errors": [{"message": "image file not found"}]}, indent=2))
        return 1

    try:
        json.loads(args.metadata)
    except json.JSONDecodeError:
        print(json.dumps({"success": False, "errors": [{"message": "metadata must be valid JSON"}]}, indent=2))
        return 1

    account_id = (
        args.account_id
        or resolve_env_value("CLOUDFLARE_ACCOUNT_ID", env_values)
        or account_id_from_api(resolve_env_value("CLOUDFLARE_API_TOKEN", env_values) or images_token)
    )
    if not account_id:
        print(
            json.dumps(
                {
                    "success": False,
                    "errors": [{"message": "Cloudflare account ID could not be resolved"}],
                },
                indent=2,
            )
        )
        return 1

    result = upload_image(
        account_id=account_id,
        token=images_token,
        image_path=image_path,
        metadata=args.metadata,
        require_signed_urls=args.require_signed_urls,
    )
    print(json.dumps(result, indent=2))
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
