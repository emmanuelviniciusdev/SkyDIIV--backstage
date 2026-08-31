#!/usr/bin/env python3
"""Monthly OCI cost ceiling helper for robot-scrape-products.

Modes:
  (default)  If MTD cost >= limit → hard-destroy the full robot stack
             (IAM, budget, VCN, compute — clean slate)
             (fallback: delete Container Instance when OCI_INSTANCE_OCID is set)
  --check-only
             Report MTD cost vs limit and exit:
               0  = under limit (safe to terraform apply)
              10  = at/over limit (do NOT apply)
               1  = error

OCI Budgets only send alerts; this script is the hard gate + kill switch.

Usage:
  python3 deploy/oci_cost_guard.py [--dry-run] [--limit 5.0]
    [--terraform-dir deploy/terraform]
  python3 deploy/oci_cost_guard.py --check-only [--limit 5.0]

Environment:
  OCI_TENANCY_OCID, OCI_USER_OCID, OCI_FINGERPRINT, OCI_API_PRIVATE_KEY_PATH, OCI_REGION
  OCI_COMPARTMENT_OCID (defaults to tenancy)
  COST_LIMIT_USD (default 5)
  OCI_INSTANCE_OCID (optional fallback Container Instance OCID)
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

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_OVER_LIMIT = 10


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
    """Hard-destroy every managed robot resource. Returns True if attempted.

    Cost ceiling enforcement tears down the full stack (IAM, budget, VCN,
    compute) so nothing from this robot remains while spend is over limit.
    """
    if not tf_dir.is_dir():
        print(f"Terraform dir not found: {tf_dir}")
        return False
    if not shutil.which("terraform"):
        print("`terraform` binary not found on PATH")
        return False
    if not terraform_state_has_resources(tf_dir):
        print(f"No Terraform resources in state under {tf_dir}")
        return False

    destroy_script = tf_dir.parent / "tf-destroy.sh"
    if not destroy_script.is_file():
        print(f"Missing destroy helper: {destroy_script}")
        return False

    if dry_run:
        print(f"[dry-run] Would run: {destroy_script} hard (cwd={tf_dir.parent})")
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

    print(f"Hard-destroying full robot stack via {destroy_script} …")
    result = subprocess.run(
        [str(destroy_script), "hard"],
        cwd=tf_dir.parent,
        check=False,
        timeout=1800,
    )
    if result.returncode != 0:
        raise SystemExit(f"terraform hard destroy failed with exit code {result.returncode}")
    print("Hard destroy completed — full robot stack removed")
    return True


def delete_container_instance(
    oci_mod, config: dict, container_instance_id: str, dry_run: bool
) -> None:
    client = oci_mod.container_instances.ContainerInstanceClient(config)
    try:
        state = client.get_container_instance(container_instance_id).data.lifecycle_state
    except Exception as err:  # noqa: BLE001
        print(f"Could not read Container Instance {container_instance_id}: {err}")
        return

    print(f"Container Instance {container_instance_id} lifecycle_state={state}")

    if state in ("DELETED", "DELETING"):
        print("Container Instance already deleted — nothing to do")
        return

    if dry_run:
        print(f"[dry-run] Would DELETE Container Instance {container_instance_id}")
        return

    print(f"Deleting Container Instance {container_instance_id}")
    client.delete_container_instance(container_instance_id)


def resolve_limit(cli_limit: float | None) -> float:
    if cli_limit is not None:
        return cli_limit
    return float(os.environ.get("COST_LIMIT_USD", "5"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=float, default=None, help="USD monthly ceiling")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Only check MTD vs limit (exit 10 if at/over). Never destroy.",
    )
    parser.add_argument("--region", default=os.environ.get("OCI_REGION", "us-ashburn-1"))
    parser.add_argument(
        "--terraform-dir",
        default=os.environ.get("COST_GUARD_TF_DIR", "deploy/terraform"),
        help="Path to the robot Terraform root (relative to cwd or absolute)",
    )
    args = parser.parse_args()

    limit = resolve_limit(args.limit)
    tenant_id = os.environ.get("OCI_TENANCY_OCID", "").strip()
    compartment_id = os.environ.get("OCI_COMPARTMENT_OCID", "").strip() or tenant_id
    instance_id = os.environ.get("OCI_INSTANCE_OCID", "").strip()
    tf_dir = Path(args.terraform_dir).expanduser().resolve()

    if not tenant_id:
        raise SystemExit("Missing OCI_TENANCY_OCID")

    config, oci_mod = load_config(args.region)

    print(f"Checking MTD cost for compartment={compartment_id} limit=${limit:.2f}")
    try:
        cost = fetch_mtd_cost_usd(oci_mod, config, tenant_id, compartment_id)
    except Exception as err:  # noqa: BLE001
        raise SystemExit(f"Usage API query failed: {err}") from err

    print(f"Month-to-date cost (USD): {cost:.4f}")

    if args.check_only:
        if cost < limit:
            print(f"Under limit ({cost:.4f} < {limit:.2f}) — apply is allowed")
            raise SystemExit(EXIT_OK)
        print(
            f"Cost ceiling reached ({cost:.4f} >= {limit:.2f}) — "
            "refusing terraform apply"
        )
        raise SystemExit(EXIT_OVER_LIMIT)

    if cost < limit:
        print(f"Under limit ({cost:.4f} < {limit:.2f}) — no action")
        return

    print(f"Cost ceiling reached ({cost:.4f} >= {limit:.2f})")
    print(
        "Enforcement: destroy full robot Terraform stack "
        "(Container Instance, VCN, budget)"
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

    print("Falling back to Container Instance DELETE only")
    delete_container_instance(oci_mod, config, instance_id, dry_run=args.dry_run)
    if not args.dry_run:
        print(
            "Container Instance delete requested (stack destroy skipped). "
            "Prefer recreating via terraform apply after fixing state."
        )


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as err:  # noqa: BLE001
        print(f"Fatal: {err}", file=sys.stderr)
        raise SystemExit(EXIT_ERROR) from err
