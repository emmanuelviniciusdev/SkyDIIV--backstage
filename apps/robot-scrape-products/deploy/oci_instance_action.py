#!/usr/bin/env python3
"""Start or stop the consumer OCI compute instance.

Uses the same credentials as Terraform (env vars or ~/.oci/config).

Usage:
  python3 deploy/oci_instance_action.py START [--instance-id OCID] [--region REGION]
  python3 deploy/oci_instance_action.py STOP  [--instance-id OCID] [--region REGION]

Environment (optional overrides):
  OCI_INSTANCE_OCID, OCI_REGION, OCI_TENANCY_OCID, OCI_USER_OCID,
  OCI_FINGERPRINT, OCI_API_PRIVATE_KEY_PATH
"""

from __future__ import annotations

import argparse
import os
import sys
import time


def load_client(region: str):
    try:
        import oci  # type: ignore
    except ImportError as err:
        raise SystemExit(
            "Missing Python package `oci`. Install with: pip install oci\n"
            f"Original error: {err}"
        ) from err

    key_path = os.environ.get("OCI_API_PRIVATE_KEY_PATH", "").strip()
    tenancy = os.environ.get("OCI_TENANCY_OCID", "").strip()
    user = os.environ.get("OCI_USER_OCID", "").strip()
    fingerprint = os.environ.get("OCI_FINGERPRINT", "").strip()
    missing = [
        name
        for name, value in (
            ("OCI_TENANCY_OCID", tenancy),
            ("OCI_USER_OCID", user),
            ("OCI_FINGERPRINT", fingerprint),
            ("OCI_API_PRIVATE_KEY_PATH", key_path),
        )
        if not value
    ]

    if not missing:
        config = {
            "user": user,
            "key_file": key_path,
            "fingerprint": fingerprint,
            "tenancy": tenancy,
            "region": region,
        }
    else:
        config_file = os.environ.get("OCI_CONFIG_FILE", "~/.oci/config")
        try:
            config = oci.config.from_file(
                config_file,
                os.environ.get("OCI_CONFIG_PROFILE", "DEFAULT"),
            )
        except Exception as err:
            raise SystemExit(
                "OCI credentials incomplete. Missing env: "
                + ", ".join(missing)
                + f"\nAlso could not load {config_file}: {err}"
            ) from err
        config["region"] = region or config.get("region")

    return oci.core.ComputeClient(config), oci


def wait_until(client, oci_mod, instance_id: str, desired: str, timeout_s: int = 600) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        instance = client.get_instance(instance_id).data
        lifecycle = instance.lifecycle_state
        print(f"Instance lifecycle_state={lifecycle}")
        if lifecycle == desired:
            return
        if lifecycle in ("TERMINATING", "TERMINATED"):
            raise SystemExit(f"Instance entered terminal state {lifecycle}")
        time.sleep(5)
    raise SystemExit(f"Timed out waiting for lifecycle_state={desired}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["START", "STOP", "GET"])
    parser.add_argument("--instance-id", default=os.environ.get("OCI_INSTANCE_OCID", ""))
    parser.add_argument("--region", default=os.environ.get("OCI_REGION", "us-ashburn-1"))
    parser.add_argument("--wait", action="store_true", help="Wait until RUNNING/STOPPED")
    args = parser.parse_args()

    if not args.instance_id:
        raise SystemExit("Missing --instance-id / OCI_INSTANCE_OCID")

    client, oci_mod = load_client(args.region)
    action = args.action.upper()

    if action == "GET":
        instance = client.get_instance(args.instance_id).data
        print(instance.lifecycle_state)
        return

    desired = "RUNNING" if action == "START" else "STOPPED"
    current = client.get_instance(args.instance_id).data.lifecycle_state
    if current == desired:
        print(f"Already {desired}")
        return

    print(f"Sending action {action} to {args.instance_id}")
    client.instance_action(args.instance_id, action)

    if args.wait:
        wait_until(client, oci_mod, args.instance_id, desired)


if __name__ == "__main__":
    main()
