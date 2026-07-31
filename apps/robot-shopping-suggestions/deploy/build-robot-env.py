#!/usr/bin/env python3
"""Build TF_VAR_robot_env JSON from .env + OCI API key PEM (for local terraform apply)."""
from __future__ import annotations

import json
import os
import pathlib
import sys


def parse_dotenv(path: pathlib.Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.is_file():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def normalize_pem(text: str) -> str:
    """Return just the PEM block.

    Key files exported by hand often carry a trailing label line after the END
    marker. Node's crypto rejects that, so the robot would fail to sign OCI
    requests (self-delete) with an opaque error long after deployment.
    """
    lines = text.strip().splitlines()
    for index, line in enumerate(lines):
        if line.strip().startswith("-----END "):
            return "\n".join(lines[: index + 1])
    return "\n".join(lines)


def main() -> int:
    root = pathlib.Path(__file__).resolve().parents[1]
    env_path = pathlib.Path(os.environ.get("ROBOT_ENV_FILE", root / ".env"))
    pem_path = pathlib.Path(
        os.environ.get("OCI_API_PRIVATE_KEY_PATH", root / "deploy/terraform/oci_api_key.pem"),
    )

    env = parse_dotenv(env_path)
    if not env:
        print(f"Missing or empty env file: {env_path}", file=sys.stderr)
        return 1

    env.setdefault("COMPUTE_PROVIDER", "oci")
    if pem_path.is_file():
        pem = normalize_pem(pem_path.read_text())
        if pem:
            env["OCI_API_PRIVATE_KEY"] = pem

    json.dump(env, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
