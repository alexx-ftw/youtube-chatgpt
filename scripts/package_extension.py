#!/usr/bin/env python3
"""Build the loadable repo manifest and a ZIP with the extension at its root."""

import copy
import json
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "extension"
FILES = (
    "manifest.json", "background.mjs", "groups.mjs", "bridge.js",
    "playback.js", "playback-session.mjs", "startup.js",
)


def main():
    manifest = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    if not re.fullmatch(r"\d+(?:\.\d+){0,3}", version):
        raise ValueError("Invalid extension version")

    references = [manifest["background"]["service_worker"]]
    for script in manifest.get("content_scripts", []):
        references.extend(script.get("js", []))
        references.extend(script.get("css", []))
    if any(name not in FILES for name in references):
        raise ValueError("Update FILES to include every manifest resource")
    contents = {name: (SOURCE / name).read_bytes() for name in FILES}

    # The complete GitHub source archive is also loadable from its root folder.
    repo_manifest = copy.deepcopy(manifest)
    repo_manifest["background"]["service_worker"] = "extension/" + references[0]
    for script in repo_manifest.get("content_scripts", []):
        for kind in ("js", "css"):
            if kind in script:
                script[kind] = ["extension/" + name for name in script[kind]]
    (ROOT / "manifest.json").write_text(
        json.dumps(repo_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    destination = ROOT / "dist" / f"youtube-chatgpt-grupos-{version}.zip"
    destination.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(destination, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in contents.items():
            entry = ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, data, compress_type=ZIP_DEFLATED, compresslevel=9)

    with ZipFile(destination) as archive:
        if archive.testzip() or set(archive.namelist()) != set(FILES):
            raise ValueError("Invalid ZIP contents")
        for name, expected in contents.items():
            if archive.read(name) != expected:
                raise ValueError(f"Packaged file mismatch: {name}")
    print(destination)


if __name__ == "__main__":
    main()
