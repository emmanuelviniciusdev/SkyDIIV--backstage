#!/usr/bin/env python3
"""Enforce a monthly OCI cost ceiling by destroying the consumer Terraform stack.

OCI Budgets only send alerts. This script:
  1. Reads month-to-date COST from the Usage API (compartment filter)
  2. If cost >= COST_LIMIT_USD (default 5.00), runs `terraform destroy`
     on the consumer-shopping-suggestions stack (VM, VCN, IPv6, schedules,
     budget, scheduler policy — everything managed by deploy/terraform)

Fallback: if Terraform state/dir is unavailable, TERMINATEs the compute
instance when OCI_INSTANCE_OCID is set.

Usage:
  python3 deploy/oci_cost_guard.py [--dry-run] [--limit 5.0]
    [--terraform-dir deploy/terraform]

Environment:
  OCI_TENANCY_OCID, OCI_USER_OCID, OCI_FINGERPRINT, OCI_API_PRIVATE_KEY_PATH, OCI_REGION
  OCI_COMPARTMENT_OCID (defaults to tenancy)
  COST_LIMIT_USD (default 5)
  OCI_INSTANCE_OCID (optional fallback if terraform destroy cannot run)
  TF_VAR_* (same vars used by terraform apply — required for destroy)
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


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

    return config, oci


def month_bounds_utc(now: datetime) -> tuple[datetime, datetime]:
    start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    # Usage API end is exclusive and must align to DAILY boundaries.
    end = datetime(now.year, now.month, now.day, tzinfo=timezone.utc) + timedelta(days=1)
    if end <= start:
        end = start + timedelta(days=1)
    return start, end


def fetch_mtd_cost_usd(oci_mod, config: dict, tenant_id: str, compartment_id: str) -> float:
    client = oci_mod.usage_api.UsageapiClient(config)
    start, end = month_bounds_utc(datetime.now(timezone.utc))

    details = oci_mod.usage_api.models.RequestSummarizedUsagesDetails(
        tenant_id=tenant_id,
        time_usage_started=start,
        time_usage_ended=end,
        granularity="DAILY",
        query_type="COST",
        compartment_depth=1,
        is_aggregate_by_time=True,
        filter=oci_mod.usage_api.models.Filter(
            operator="AND",
            dimensions=[
                oci_mod.usage_api.models.Dimension(
                    key="compartmentId",
                    value=compartment_id,
                )
            ],
        ),
    )

    response = client.request_summarized_usages(details)
    items = response.data.items or []
    total = 0.0
    for item in items:
        amount = getattr(item, "computed_amount", None)
        if amount is not None:
            total += float(amount)
    return total


def terraform_state_has_resources(tf_dir: Path) -> bool:
    state_file = tf_dir / "terraform.tfstate"
    if state_file.is_file() and state_file.stat().st_size > 2:
        return True
    # Remote backend: ask terraform.
    if not shutil.which("terraform"):
        return False
    try:
        result = subprocess.run(
            ["terraform", "state", "list"],
            cwd=tf_dir,
            check=False,
            capture_output=True,
            text=True,
            timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0 and bool(result.stdout.strip())


def destroy_terraform_stack(tf_dir: Path, dry_run: bool) -> bool:
    """Destroy the consumer Terraform stack. Returns True if destroy was attempted."""
    if not tf_dir.is_dir():
        print(f"Terraform dir not found: {tf_dir}")
        return False
    if not shutil.which("terraform"):
        print("`terraform` binary not found on PATH")
        return False
    if not terraform_state_has_resources(tf_dir):
        print(f"No Terraform resources in state under {tf_dir}")
        return False

    if dry_run:
        print(f"[dry-run] Would run: terraform destroy -auto-approve -input=false (cwd={tf_dir})")
        plan = subprocess.run(
            ["terraform", "plan", "-destroy", "-input=false", "-no-color"],
            cwd=tf_dir,
            check=False,
            capture_output=True,
            text=True,
            timeout=300,
        )
        if plan.stdout:
            print(plan.stdout[-8000:])
        if plan.returncode != 0 and plan.stderr:
            print(plan.stderr[-2000:], file=sys.stderr)
        return True

    print(f"Destroying consumer Terraform stack in {tf_dir} …")
    result = subprocess.run(
        ["terraform", "destroy", "-auto-approve", "-input=false", "-no-color"],
        cwd=tf_dir,
        check=False,
        timeout=1800,
    )
    if result.returncode != 0:
        raise SystemExit(f"terraform destroy failed with exit code {result.returncode}")
    print("Terraform destroy completed — consumer infrastructure removed")
    return True


def terminate_instance(oci_mod, config: dict, instance_id: str, dry_run: bool) -> None:
    compute = oci_mod.core.ComputeClient(config)
    try:
        state = compute.get_instance(instance_id).data.lifecycle_state
    except Exception as err:  # noqa: BLE001
        print(f"Could not read instance {instance_id}: {err}")
        return

    print(f"Instance {instance_id} lifecycle_state={state}")

    if state in ("TERMINATED", "TERMINATING"):
        print("Instance already terminated — nothing to do")
        return

    if dry_run:
        print(f"[dry-run] Would TERMINATE instance {instance_id}")
        return

    print(f"TERMINATING instance {instance_id} (preserve_boot_volume=False)")
    compute.terminate_instance(
        instance_id,
        preserve_boot_volume=False,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=float, default=None, help="USD monthly ceiling")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--region", default=os.environ.get("OCI_REGION", "us-ashburn-1"))
    parser.add_argument(
        "--terraform-dir",
        default=os.environ.get("COST_GUARD_TF_DIR", "deploy/terraform"),
        help="Path to the consumer Terraform root (relative to cwd or absolute)",
    )
    args = parser.parse_args()

    limit = args.limit
    if limit is None:
        limit = float(os.environ.get("COST_LIMIT_USD", "5"))

    tenant_id = os.environ.get("OCI_TENANCY_OCID", "").strip()
    compartment_id = (
        os.environ.get("OCI_COMPARTMENT_OCID", "").strip() or tenant_id
    )
    instance_id = os.environ.get("OCI_INSTANCE_OCID", "").strip()
    tf_dir = Path(args.terraform_dir).expanduser().resolve()

    if not tenant_id:
        raise SystemExit("Missing OCI_TENANCY_OCID")

    config, oci_mod = load_config(args.region)

    print(f"Checking MTD cost for compartment={compartment_id} limit=${limit:.2f}")
    try:
        cost = fetch_mtd_cost_usd(oci_mod, config, tenant_id, compartment_id)
    except Exception as err:  # noqa: BLE001 — surface Usage API failures clearly
        raise SystemExit(f"Usage API query failed: {err}") from err

    print(f"Month-to-date cost (USD): {cost:.4f}")

    if cost < limit:
        print(f"Under limit ({cost:.4f} < {limit:.2f}) — no action")
        return

    print(f"Cost ceiling reached ({cost:.4f} >= {limit:.2f})")
    print(
        "Enforcement: destroy full consumer Terraform stack "
        "(VM, network, IPv6, schedules, budget, scheduler policy)"
    )

    destroyed = destroy_terraform_stack(tf_dir, dry_run=args.dry_run)
    if destroyed:
        if not args.dry_run:
            print(
                "Stack destroyed. Recreate later with: "
                "cd deploy/terraform && terraform apply"
            )
        return

    if not instance_id:
        raise SystemExit(
            "Terraform destroy unavailable and OCI_INSTANCE_OCID is unset — "
            "cannot enforce cost ceiling"
        )

    print("Falling back to instance TERMINATE only")
    terminate_instance(oci_mod, config, instance_id, dry_run=args.dry_run)
    if not args.dry_run:
        print(
            "Instance terminate requested (stack destroy skipped). "
            "Prefer recreating via terraform apply after fixing state."
        )


if __name__ == "__main__":
    main()
