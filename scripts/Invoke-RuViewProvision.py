#!/usr/bin/env python3
"""Run upstream provision.py without placing the Wi-Fi password in argv."""

import os
import runpy
import sys


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: Invoke-RuViewProvision.py PROVISION_SCRIPT [ARGS...]")
    password = os.environ.pop("RUVIEW_PROVISION_PASSWORD", None)
    ssid = os.environ.pop("RUVIEW_PROVISION_SSID", None)
    if password is None or ssid is None:
        raise SystemExit("provisioning credentials are not set")
    provision_script, *arguments = sys.argv[1:]
    sys.argv = [
        provision_script,
        *arguments,
        "--ssid",
        ssid,
        "--password",
        password,
    ]
    runpy.run_path(provision_script, run_name="__main__")


if __name__ == "__main__":
    main()
