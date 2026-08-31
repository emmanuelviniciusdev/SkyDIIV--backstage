#!/usr/bin/env python3
"""Print shell export lines for OCI cost-gate env vars read from terraform.tfvars."""
from __future__ import annotations

import os
import pathlib
import re
import sys

TF_TO_ENV = {
    "tenancy_ocid": "OCI_TENANCY_OCID",
    "user_ocid": "OCI_USER_OCID",
    "fingerprint": "OCI_FINGERPRINT",
    "region": "OCI_REGION",
    "compartment_ocid": "OCI_COMPARTMENT_OCID",
}


def shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\"'\"'") + "'"


def resolve_private_key_path(tfvars_path: pathlib.Path, raw: str) -> str:
    path = pathlib.Path(raw).expanduser()
    if not path.is_absolute():
        path = (tfvars_path.parent / path).resolve()
    return str(path)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: export-tfvars-oci-env.py <terraform.tfvars>", file=sys.stderr)
        return 1

    tfvars_path = pathlib.Path(sys.argv[1])
    text = tfvars_path.read_text()
    for tf_key, env_key in TF_TO_ENV.items():
        if os.environ.get(env_key):
            continue
        match = re.search(rf'^\s*{re.escape(tf_key)}\s*=\s*"([^"]*)"', text, re.MULTILINE)
        if match:
            print(f"export {env_key}={shell_quote(match.group(1))}")

    if not os.environ.get("OCI_API_PRIVATE_KEY_PATH"):
        match = re.search(r'^\s*private_key_path\s*=\s*"([^"]*)"', text, re.MULTILINE)
        if match:
            resolved = resolve_private_key_path(tfvars_path, match.group(1))
            print(f"export OCI_API_PRIVATE_KEY_PATH={shell_quote(resolved)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
