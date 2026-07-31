#!/usr/bin/env python3
"""Delete robot image versions from OCIR to stop storage charges accumulating.

Every deploy pushes a new image version (`:<sha>` plus `:latest`), and OCIR bills
the stored layers even while no Container Instance runs. The stack is rebuilt
from a freshly pushed image on every run, so retaining old versions buys nothing.

Usage:
  python3 deploy/ocir_purge.py                      # delete every version
  python3 deploy/ocir_purge.py --keep 1             # keep the newest version
  python3 deploy/ocir_purge.py --dry-run
  python3 deploy/ocir_purge.py --repository other-repo

Environment:
  OCI_TENANCY_OCID, OCI_USER_OCID, OCI_FINGERPRINT, OCI_API_PRIVATE_KEY_PATH,
  OCI_REGION, OCI_COMPARTMENT_OCID (defaults to tenancy)
  OCIR_REPOSITORY (default robot-shopping-suggestions)
"""

from __future__ import annotations

import argparse
import os
import sys

DEFAULT_REPOSITORY = "robot-shopping-suggestions"


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

    return oci.artifacts.ArtifactsClient(config), config


def list_images(client, compartment_id: str, repository: str):
    """Every image version of `repository`, newest first.

    Searches the compartment subtree because the repository may live in the root
    compartment while the stack itself is deployed elsewhere.
    """
    images = []
    page = None
    while True:
        response = client.list_container_images(
            compartment_id=compartment_id,
            compartment_id_in_subtree=True,
            repository_name=repository,
            limit=100,
            page=page,
        )
        images.extend(response.data.items or [])
        page = response.next_page
        if not page:
            break

    return sorted(images, key=lambda image: image.time_created or "", reverse=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repository",
        default=os.environ.get("OCIR_REPOSITORY", DEFAULT_REPOSITORY),
    )
    parser.add_argument(
        "--keep",
        type=int,
        default=0,
        help="Retain this many of the newest versions (default 0 — delete all)",
    )
    parser.add_argument("--region", default=os.environ.get("OCI_REGION", "").strip())
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.keep < 0:
        raise SystemExit("--keep must be >= 0")
    if not args.region:
        raise SystemExit("Missing --region / OCI_REGION")

    tenancy = os.environ.get("OCI_TENANCY_OCID", "").strip()
    compartment_id = os.environ.get("OCI_COMPARTMENT_OCID", "").strip() or tenancy
    if not compartment_id:
        raise SystemExit("Missing OCI_COMPARTMENT_OCID / OCI_TENANCY_OCID")

    client, _ = load_client(args.region)

    print(f"Listing images for repository={args.repository} in {args.region}")
    try:
        images = list_images(client, compartment_id, args.repository)
    except Exception as err:  # noqa: BLE001 — surface the OCI error verbatim
        raise SystemExit(f"Failed to list container images: {err}") from err

    if not images:
        print("No image versions found — nothing to purge")
        return

    doomed = images[args.keep :]
    print(f"Found {len(images)} version(s); deleting {len(doomed)}, keeping {args.keep}")

    failures = 0
    for image in doomed:
        label = image.display_name or image.id
        if args.dry_run:
            print(f"[dry-run] Would delete {label}")
            continue
        try:
            client.delete_container_image(image.id)
            print(f"Deleted {label}")
        except Exception as err:  # noqa: BLE001 — keep purging the rest
            # `:latest` and `:<sha>` are separate entries over one digest, so
            # deleting either takes the other with it.
            if getattr(err, "status", None) == 404:
                print(f"Already gone: {label}")
                continue
            failures += 1
            print(f"Failed to delete {label}: {err}", file=sys.stderr)

    if failures:
        raise SystemExit(f"{failures} image version(s) could not be deleted")


if __name__ == "__main__":
    main()
