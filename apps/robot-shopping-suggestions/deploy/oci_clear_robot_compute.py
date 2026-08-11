#!/usr/bin/env python3
"""Clear robot Container Instances so a hard destroy can delete the subnet.

OCI refuses `DeleteSubnet` with 409 while any VNIC still references the subnet.
The robot CI owns that VNIC; Terraform can drop the CI from state (or finish
CI destroy) before OCI finishes reclaiming the VNIC — especially when destroy
retries do `terraform state rm` without an API delete.

This script:
  1. Deletes a known CI OCID (from Terraform state / CLI arg), if given
  2. Deletes any leftover CIs in the compartment whose display name matches
     the robot prefix
  3. Waits until the subnet has no private IPs (VNIC holders gone), or until
     the timeout

Usage:
  python3 deploy/oci_clear_robot_compute.py \\
    --compartment-id ocid1.compartment... \\
    --subnet-id ocid1.subnet... \\
    [--container-instance-id ocid1.containerinstance...] \\
    [--display-name-prefix skydiiv-robot-shopping-suggestions] \\
    [--timeout-seconds 600]

Environment (same as other deploy OCI scripts):
  OCI_TENANCY_OCID, OCI_USER_OCID, OCI_FINGERPRINT, OCI_API_PRIVATE_KEY_PATH,
  OCI_REGION, OCI_COMPARTMENT_OCID
"""

from __future__ import annotations

import argparse
import os
import sys
import time

DEFAULT_NAME_PREFIX = "skydiiv-robot-shopping-suggestions"


def load_config(region: str):
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

    if tenancy and user and fingerprint and key_path:
        if not os.path.isfile(key_path):
            raise SystemExit(f"OCI_API_PRIVATE_KEY_PATH not found: {key_path}")
        config = {
            "user": user,
            "key_file": key_path,
            "fingerprint": fingerprint,
            "tenancy": tenancy,
            "region": region,
        }
    else:
        config = oci.config.from_file(
            os.environ.get("OCI_CONFIG_FILE", "~/.oci/config"),
            os.environ.get("OCI_CONFIG_PROFILE", "DEFAULT"),
        )
        config["region"] = region or config.get("region")

    return oci, config


def delete_ci(oci_mod, client, ocid: str, dry_run: bool) -> None:
    try:
        state = client.get_container_instance(ocid).data.lifecycle_state
    except Exception as err:  # noqa: BLE001
        message = str(err)
        if "404" in message or "NotAuthorizedOrNotFound" in message:
            print(f"Container Instance {ocid} already gone")
            return
        print(f"Could not read Container Instance {ocid}: {err}")
        return

    print(f"Container Instance {ocid} lifecycle_state={state}")
    if state in ("DELETED", "DELETING"):
        return
    if dry_run:
        print(f"[dry-run] Would DELETE Container Instance {ocid}")
        return
    try:
        client.delete_container_instance(ocid)
        print(f"Delete requested for {ocid}")
    except Exception as err:  # noqa: BLE001
        print(f"Delete request failed for {ocid}: {err}")


def list_matching_cis(client, compartment_id: str, name_prefix: str) -> list[str]:
    found: list[str] = []
    page = None
    while True:
        response = client.list_container_instances(
            compartment_id=compartment_id,
            limit=100,
            page=page,
        )
        for item in response.data.items or []:
            name = getattr(item, "display_name", "") or ""
            state = getattr(item, "lifecycle_state", "") or ""
            if not name.startswith(name_prefix):
                continue
            if state in ("DELETED", "DELETING"):
                continue
            found.append(item.id)
        page = response.next_page
        if not page:
            break
    return found


def wait_ci_gone(client, ocid: str, deadline: float) -> None:
    while time.time() < deadline:
        try:
            state = client.get_container_instance(ocid).data.lifecycle_state
        except Exception as err:  # noqa: BLE001
            message = str(err)
            if "404" in message or "NotAuthorizedOrNotFound" in message:
                print(f"Container Instance {ocid} is gone")
                return
            print(f"Waiting on {ocid}: {err}")
            time.sleep(5)
            continue
        print(f"Waiting on {ocid}: lifecycle_state={state}")
        if state == "DELETED":
            return
        time.sleep(5)
    print(f"Timed out waiting for Container Instance {ocid} to finish deleting", file=sys.stderr)


def count_private_ips(network_client, subnet_id: str) -> int:
    total = 0
    page = None
    while True:
        response = network_client.list_private_ips(subnet_id=subnet_id, page=page)
        total += len(response.data or [])
        page = response.next_page
        if not page:
            break
    return total


def wait_subnet_clear(network_client, subnet_id: str, deadline: float) -> bool:
    while time.time() < deadline:
        try:
            count = count_private_ips(network_client, subnet_id)
        except Exception as err:  # noqa: BLE001
            message = str(err)
            # Subnet already destroyed (common on hard-destroy retry) → nothing left.
            if "404" in message or "NotAuthorizedOrNotFound" in message:
                print(f"Subnet {subnet_id} already gone — treating VNIC holders as cleared")
                return True
            print(f"Could not list private IPs in subnet: {err}")
            return False
        if count == 0:
            print(f"Subnet {subnet_id} has no private IPs — VNIC holders cleared")
            return True
        print(f"Subnet still has {count} private IP(s); waiting for VNIC release…")
        time.sleep(10)
    print(
        f"Timed out waiting for subnet {subnet_id} private IPs to clear",
        file=sys.stderr,
    )
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--compartment-id",
        default=os.environ.get("OCI_COMPARTMENT_OCID")
        or os.environ.get("TF_VAR_compartment_ocid", ""),
    )
    parser.add_argument("--subnet-id", default="")
    parser.add_argument("--container-instance-id", default="")
    parser.add_argument(
        "--display-name-prefix",
        default=os.environ.get("ROBOT_DISPLAY_NAME_PREFIX", DEFAULT_NAME_PREFIX),
    )
    parser.add_argument("--timeout-seconds", type=int, default=600)
    parser.add_argument("--region", default=os.environ.get("OCI_REGION", "us-ashburn-1"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.compartment_id:
        raise SystemExit("Missing --compartment-id / OCI_COMPARTMENT_OCID")

    oci_mod, config = load_config(args.region)
    ci_client = oci_mod.container_instances.ContainerInstanceClient(config)
    network_client = oci_mod.core.VirtualNetworkClient(config)

    deadline = time.time() + max(30, args.timeout_seconds)
    targets: list[str] = []

    if args.container_instance_id:
        targets.append(args.container_instance_id)

    for ocid in list_matching_cis(ci_client, args.compartment_id, args.display_name_prefix):
        if ocid not in targets:
            targets.append(ocid)

    if not targets:
        print(
            f"No Container Instances matching prefix "
            f"{args.display_name_prefix!r} in compartment"
        )
    else:
        print(f"Clearing {len(targets)} Container Instance(s)")
        for ocid in targets:
            delete_ci(oci_mod, ci_client, ocid, dry_run=args.dry_run)
        if not args.dry_run:
            for ocid in targets:
                wait_ci_gone(ci_client, ocid, deadline)

    if args.subnet_id and not args.dry_run:
        if not wait_subnet_clear(network_client, args.subnet_id, deadline):
            raise SystemExit(2)

    print("Robot compute clear complete")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit(130) from None
