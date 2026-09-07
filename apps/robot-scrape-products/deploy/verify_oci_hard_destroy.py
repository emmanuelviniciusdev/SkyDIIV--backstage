#!/usr/bin/env python3
"""Assert robot OCI infra is gone in one region after hard destroy.

Lists Container Instances, VCN networking, and (by default) OCIR images in
`--region` whose display/name matches the robot prefix. Tenancy IAM and
Budgets are home-region APIs — pass `--include-tenancy` to check those too
(they are not “in” São Paulo).

Exit:
  0  nothing left (or only DELETED/TERMINATED)
  2  leftovers
  1  usage / API error

Usage:
  python3 deploy/verify_oci_hard_destroy.py --region sa-saopaulo-1
  python3 deploy/verify_oci_hard_destroy.py --region sa-saopaulo-1 --include-tenancy
  python3 deploy/verify_oci_hard_destroy.py --region sa-saopaulo-1 --skip-ocir

Environment (same as other deploy OCI scripts):
  OCI_TENANCY_OCID, OCI_USER_OCID, OCI_FINGERPRINT, OCI_API_PRIVATE_KEY_PATH,
  OCI_COMPARTMENT_OCID (defaults to tenancy)
"""

from __future__ import annotations

import argparse
import os
import sys

DEFAULT_PREFIX = "skydiiv-robot-scrape-products"
DEFAULT_OCIR_REPO = "robot-scrape-products"
DEFAULT_DNS_LABELS = ("skydiivrss", "skydiivrssstg")
GONE = frozenset({"DELETED", "TERMINATED"})

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_LEFTOVERS = 2


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


def copy_config(config: dict, region: str) -> dict:
    out = dict(config)
    out["region"] = region
    return out


def matches(name: str | None, prefix: str) -> bool:
    if not name:
        return False
    return name.startswith(prefix) or prefix in name


def tags_match(item, prefix: str) -> bool:
    tags = getattr(item, "freeform_tags", None) or {}
    app = tags.get("app")
    return bool(app) and (app == prefix or str(app).startswith(prefix))


def owned(item, prefix: str, *, name_attr: str = "display_name", dns_labels: tuple[str, ...] = ()) -> bool:
    name = getattr(item, name_attr, None) or getattr(item, "name", None)
    if matches(name, prefix) or tags_match(item, prefix):
        return True
    dns = getattr(item, "dns_label", None)
    return bool(dns) and dns in dns_labels


def state_of(item) -> str:
    return str(getattr(item, "lifecycle_state", "") or "").upper()


def is_present(item) -> bool:
    return state_of(item) not in GONE


def fmt(item, name_attr: str = "display_name") -> str:
    name = getattr(item, name_attr, None) or getattr(item, "name", None) or "?"
    ocid = getattr(item, "id", "")
    return f"  {name}  state={state_of(item) or 'n/a'}  {ocid}"


def iterate_pages(fn, **kwargs):
    """Yield items from an OCI list_* call, whether data is a list or a .items collection."""
    page = None
    while True:
        call_kwargs = dict(kwargs)
        if page:
            call_kwargs["page"] = page
        response = fn(**call_kwargs)
        data = response.data
        if data is None:
            items = []
        elif hasattr(data, "items"):
            items = data.items or []
        elif isinstance(data, list):
            items = data
        else:
            items = [data]
        yield from items
        page = getattr(response, "next_page", None)
        if not page:
            break


def collect(
    items,
    prefix: str,
    *,
    name_attr: str = "display_name",
    dns_labels: tuple[str, ...] = (),
    vcn_ids: frozenset[str] | None = None,
) -> list:
    out = []
    seen = set()
    for item in items:
        if not is_present(item):
            continue
        vcn_id = getattr(item, "vcn_id", None)
        if owned(item, prefix, name_attr=name_attr, dns_labels=dns_labels) or (
            vcn_ids and vcn_id in vcn_ids
        ):
            ocid = getattr(item, "id", id(item))
            if ocid in seen:
                continue
            seen.add(ocid)
            out.append(item)
    return out


def check_region(
    oci_mod,
    config: dict,
    compartment_id: str,
    prefix: str,
    dns_labels: tuple[str, ...],
) -> list[str]:
    leftovers: list[str] = []
    ci = oci_mod.container_instances.ContainerInstanceClient(config)
    net = oci_mod.core.VirtualNetworkClient(config)

    vcns = collect(
        iterate_pages(net.list_vcns, compartment_id=compartment_id),
        prefix,
        dns_labels=dns_labels,
    )
    vcn_ids = frozenset(item.id for item in vcns)

    groups: list[tuple[str, list]] = [
        (
            "Container Instances",
            collect(
                iterate_pages(ci.list_container_instances, compartment_id=compartment_id),
                prefix,
            ),
        ),
        ("VCNs", vcns),
        (
            "Subnets",
            collect(
                iterate_pages(net.list_subnets, compartment_id=compartment_id),
                prefix,
                vcn_ids=vcn_ids,
            ),
        ),
        (
            "Internet gateways",
            collect(
                iterate_pages(net.list_internet_gateways, compartment_id=compartment_id),
                prefix,
                vcn_ids=vcn_ids,
            ),
        ),
        (
            "NAT gateways",
            collect(
                iterate_pages(net.list_nat_gateways, compartment_id=compartment_id),
                prefix,
                vcn_ids=vcn_ids,
            ),
        ),
        (
            "Service gateways",
            collect(
                iterate_pages(net.list_service_gateways, compartment_id=compartment_id),
                prefix,
                vcn_ids=vcn_ids,
            ),
        ),
        (
            "Route tables",
            collect(
                iterate_pages(net.list_route_tables, compartment_id=compartment_id),
                prefix,
                vcn_ids=vcn_ids,
            ),
        ),
        (
            "Security lists",
            collect(
                iterate_pages(net.list_security_lists, compartment_id=compartment_id),
                prefix,
                vcn_ids=vcn_ids,
            ),
        ),
        (
            "DHCP options",
            collect(
                iterate_pages(net.list_dhcp_options, compartment_id=compartment_id),
                prefix,
                vcn_ids=vcn_ids,
            ),
        ),
    ]

    for title, items in groups:
        if items:
            print(f"LEFTOVER {title} ({len(items)}):")
            for item in items:
                print(fmt(item))
            leftovers.append(title)
        else:
            print(f"OK {title}: none")

    return leftovers


def check_ocir(
    oci_mod, config: dict, compartment_id: str, repository: str
) -> list[str]:
    client = oci_mod.artifacts.ArtifactsClient(config)
    images = list(
        iterate_pages(
            client.list_container_images,
            compartment_id=compartment_id,
            compartment_id_in_subtree=True,
            repository_name=repository,
            limit=100,
        )
    )
    present = [img for img in images if is_present(img)]
    if present:
        print(f"LEFTOVER OCIR images in {config['region']} repo={repository} ({len(present)}):")
        for img in present[:20]:
            print(fmt(img))
        if len(present) > 20:
            print(f"  … {len(present) - 20} more")
        return ["OCIR images"]
    print(f"OK OCIR images ({repository}): none")
    return []


def check_tenancy(oci_mod, home_config: dict, tenancy_id: str, prefix: str) -> list[str]:
    leftovers: list[str] = []
    identity = oci_mod.identity.IdentityClient(home_config)

    groups = collect(
        iterate_pages(identity.list_dynamic_groups, compartment_id=tenancy_id),
        prefix,
        name_attr="name",
    )
    if groups:
        print(f"LEFTOVER dynamic groups ({len(groups)}) — tenancy, not regional:")
        for item in groups:
            print(fmt(item, "name"))
        leftovers.append("dynamic groups")
    else:
        print("OK dynamic groups: none")

    policies = collect(
        iterate_pages(identity.list_policies, compartment_id=tenancy_id),
        prefix,
        name_attr="name",
    )
    if policies:
        print(f"LEFTOVER policies ({len(policies)}) — tenancy, not regional:")
        for item in policies:
            print(fmt(item, "name"))
        leftovers.append("policies")
    else:
        print("OK policies: none")

    try:
        budget_client = oci_mod.budget.BudgetClient(home_config)
        budgets = collect(
            iterate_pages(budget_client.list_budgets, compartment_id=tenancy_id),
            prefix,
        )
        if budgets:
            print(f"LEFTOVER budgets ({len(budgets)}) — tenancy home region:")
            for item in budgets:
                print(fmt(item))
            leftovers.append("budgets")
        else:
            print("OK budgets: none")
    except Exception as err:  # noqa: BLE001
        print(f"SKIP budgets ({err})")

    return leftovers


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", required=True, help="OCI region to inspect (e.g. sa-saopaulo-1)")
    parser.add_argument(
        "--compartment-id",
        default=os.environ.get("OCI_COMPARTMENT_OCID")
        or os.environ.get("TF_VAR_compartment_ocid", ""),
    )
    parser.add_argument("--prefix", default=os.environ.get("ROBOT_DISPLAY_NAME_PREFIX", DEFAULT_PREFIX))
    parser.add_argument("--ocir-repository", default=DEFAULT_OCIR_REPO)
    parser.add_argument("--skip-ocir", action="store_true")
    parser.add_argument(
        "--include-tenancy",
        action="store_true",
        help="Also list tenancy IAM + budgets (home-region APIs, not in --region)",
    )
    parser.add_argument(
        "--home-region",
        default=os.environ.get("OCI_HOME_REGION", "us-ashburn-1"),
        help="Tenancy home region for --include-tenancy (default us-ashburn-1)",
    )
    args = parser.parse_args()

    tenancy = os.environ.get("OCI_TENANCY_OCID", "").strip()
    compartment = args.compartment_id.strip() or tenancy
    if not compartment:
        raise SystemExit("Missing --compartment-id / OCI_COMPARTMENT_OCID")

    oci_mod, config = load_config(args.region)
    print(f"Checking region={args.region} compartment={compartment} prefix={args.prefix!r}")

    leftovers: list[str] = []
    leftovers.extend(
        check_region(oci_mod, config, compartment, args.prefix, DEFAULT_DNS_LABELS)
    )
    if not args.skip_ocir:
        leftovers.extend(check_ocir(oci_mod, config, compartment, args.ocir_repository))

    if args.include_tenancy:
        if not tenancy:
            raise SystemExit("--include-tenancy needs OCI_TENANCY_OCID")
        print(f"--- tenancy IAM/budgets (home={args.home_region}, not {args.region}) ---")
        leftovers.extend(
            check_tenancy(oci_mod, copy_config(config, args.home_region), tenancy, args.prefix)
        )

    if leftovers:
        print(f"NOT clean: {', '.join(leftovers)}")
        raise SystemExit(EXIT_LEFTOVERS)

    print(f"Hard-destroy verified: no robot resources in {args.region}")
    raise SystemExit(EXIT_OK)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit(130) from None
    except SystemExit:
        raise
    except Exception as err:  # noqa: BLE001
        print(f"Fatal: {err}", file=sys.stderr)
        raise SystemExit(EXIT_ERROR) from err
