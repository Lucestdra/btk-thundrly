"""Write the FastAPI OpenAPI spec to `shared/openapi.json`.

This is the input to the TypeScript codegen step. Pydantic schemas are
the single source of truth; running this script + `npm run types:gen`
in the extension regenerates every TS type the frontend consumes.

Usage:

    .venv/Scripts/python.exe -m scripts.dump_openapi

Writes to `<repo>/shared/openapi.json` (deterministic key order so diffs
are reviewable; FastAPI doesn't guarantee key order out of the box).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Make `app.*` importable when this script is invoked from the backend root.
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from app.main import app  # noqa: E402

_REPO_ROOT = _BACKEND_ROOT.parent
_OUTPUT = _REPO_ROOT / "shared" / "openapi.json"


def main() -> None:
    spec = app.openapi()
    _OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    _OUTPUT.write_text(
        json.dumps(spec, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {_OUTPUT.relative_to(_REPO_ROOT)} ({_OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
