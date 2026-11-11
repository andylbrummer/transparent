"""
Download one large file into the pipeline cache with parallel HTTP Range
requests: a single connection to Zenodo runs at under 1 MB/s, sixteen at
once fill the line. Each piece is checked for its length; the file is only
moved into place when every piece has arrived, so an interrupted run
leaves no half file behind under the final name.
"""

from __future__ import annotations

import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fetch_cache import CACHE_DIR, USER_AGENT

PIECE = 64 * 1024 * 1024


def content_length(url: str) -> int:
    request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return int(response.headers["Content-Length"])


def ranged_fetch(url: str, name: str, *, workers: int = 16, size: int | None = None) -> Path:
    path = CACHE_DIR / name
    if path.exists():
        return path
    total = size if size is not None else content_length(url)
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_name(path.name + ".part")
    with open(part, "wb") as out:
        out.truncate(total)

    def piece(start: int) -> int:
        end = min(start + PIECE, total) - 1
        for attempt in range(4):
            try:
                request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Range": f"bytes={start}-{end}"})
                with urllib.request.urlopen(request, timeout=300) as response:
                    if response.status != 206:
                        raise OSError(f"expected 206, got {response.status}")
                    data = response.read()
                if len(data) != end - start + 1:
                    raise OSError(f"short piece at {start}: {len(data)} bytes")
                with open(part, "r+b") as out:
                    out.seek(start)
                    out.write(data)
                return len(data)
            except OSError as error:
                if attempt == 3:
                    raise
                print(f"  retrying piece at {start}: {error}", file=sys.stderr)
        return 0

    print(f"fetching {url} ({total / 1e9:.2f} GB in {workers} streams)", file=sys.stderr)
    with ThreadPoolExecutor(workers) as pool:
        got = sum(pool.map(piece, range(0, total, PIECE)))
    if got != total:
        raise OSError(f"{got} of {total} bytes")
    os.replace(part, path)
    return path
