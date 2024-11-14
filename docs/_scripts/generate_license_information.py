"""Uses pip-licenses to determine the licenses of all installed packages and generates a report for the docs."""

import json
import os
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Dict, List, Optional

import jinja2

if __name__ == "__main__":
    DOCS_PATH = Path("docs")
    JINJA_ENVIRONMENT = jinja2.Environment(loader=jinja2.FileSystemLoader(DOCS_PATH / "_templates"), autoescape=True)

    with TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        licenses_file = tmp_path / "ossLicenses.json"

        subprocess.check_call(
            [  # noqa: S607 command
                "pip-licenses",
                "--with-authors",
                "--with-system",
                "--with-urls",
                "--with-description",
                "--with-license-file",
                "--with-notice-file",
                "--format",
                "json",
                "--ignore-packages",
                "ufsm",
                "--output-file",
                licenses_file.as_posix(),
            ]
        )

        with licenses_file.open(encoding="utf-8") as handle:
            licenses: List[Dict[str, Optional[str]]] = json.load(fp=handle)

            for license_ in licenses:
                for key in ["LicenseFile", "NoticeFile"]:
                    file = license_[key]

                    if file is not None and file != "UNKNOWN":
                        license_[key] = os.path.relpath(file, DOCS_PATH.as_posix())
                    else:
                        license_[key] = None

        (DOCS_PATH / "license_compliance.rst").write_text(
            JINJA_ENVIRONMENT.get_template("license_compliance.rst.j2").render(licenses=licenses)
        )
