from __future__ import annotations

import argparse
from pathlib import Path

from .pipeline import ingest_file, to_json


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract and sanitize an approved source candidate.")
    parser.add_argument("path", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.write_text(to_json(ingest_file(args.path)), encoding="utf-8")


if __name__ == "__main__":
    main()
