"""Download cache shared by the pipeline scripts.

Raw downloads live in tools/pipeline/.cache/ (gitignored), so a re-run
does not hammer the source and large archives never reach git. Delete a
file there, or pass refresh=True, to fetch it again.
"""

import sys
import urllib.error
import urllib.request
from pathlib import Path

CACHE_DIR = Path(__file__).resolve().parent / ".cache"
USER_AGENT = "transparent-earth-pipeline/1.0"


def cached_fetch(urls: str | list[str], name: str, *, refresh: bool = False, timeout: float = 300) -> Path:
    """Return the cached file `name`, downloading it from the first URL that answers.

    `urls` may list mirrors, tried in order. Raises the last error if none works.
    """
    path = CACHE_DIR / name
    if path.exists() and path.stat().st_size > 0 and not refresh:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    for url in [urls] if isinstance(urls, str) else urls:
        print(f"fetching {url}", file=sys.stderr)
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                data = response.read()
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            print(f"  failed: {error}", file=sys.stderr)
            last_error = error
            continue
        partial = path.with_name(path.name + ".part")
        partial.write_bytes(data)
        partial.replace(path)
        return path
    assert last_error is not None
    raise last_error
