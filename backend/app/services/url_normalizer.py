"""URL normalization — same product across sessions / referrers / utm tags
must hash to the same canonical key.

We do platform-aware normalization for the three Turkish marketplaces we
support. For everything else we fall back to a generic strip-query
normalization, which is enough for the demo product page.

Each marketplace embeds a numeric / alphanumeric product ID in the path:

    trendyol.com/marka/urun-adi-p-12345678?...        -> trendyol://12345678
    hepsiburada.com/marka-urun-adi-p-HBV00000XYZ?...  -> hepsiburada://HBV00000XYZ
    n11.com/urun/urun-adi-P12345678?...               -> n11://P12345678

The normalized form is platform-prefixed so two different platforms with
colliding numeric IDs don't bucket together. Falling back to a generic
host+path canonicalization preserves usefulness for the demo page while
keeping the schema simple.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse


@dataclass(frozen=True)
class CanonicalUrl:
    platform: str  # "trendyol" | "hepsiburada" | "n11" | "demo" | "other"
    canonical: str  # e.g. "trendyol://12345678"


_TRENDYOL_HOST = re.compile(r"(^|\.)trendyol\.com$", re.IGNORECASE)
_HEPSIBURADA_HOST = re.compile(r"(^|\.)hepsiburada\.com$", re.IGNORECASE)
_N11_HOST = re.compile(r"(^|\.)n11\.com$", re.IGNORECASE)

_TRENDYOL_ID = re.compile(r"-p-(\d+)(?:[/?#]|$)", re.IGNORECASE)
_HEPSIBURADA_ID = re.compile(r"-p-([A-Za-z0-9]+)(?:[/?#]|$)", re.IGNORECASE)
_N11_ID = re.compile(r"-(P\d+)(?:[/?#]|$)", re.IGNORECASE)


def normalize(url: str) -> CanonicalUrl:
    """Return a `CanonicalUrl` for the given product URL.

    Never raises — falls back to the generic path canonicalization for
    anything unparseable.
    """
    if not url:
        return CanonicalUrl(platform="other", canonical="other://")

    try:
        parsed = urlparse(url.strip())
    except ValueError:
        return CanonicalUrl(platform="other", canonical=f"other://{url[:200]}")

    host = (parsed.hostname or "").lower()
    path = parsed.path or ""

    if _TRENDYOL_HOST.search(host):
        m = _TRENDYOL_ID.search(path)
        if m:
            return CanonicalUrl(platform="trendyol", canonical=f"trendyol://{m.group(1)}")

    if _HEPSIBURADA_HOST.search(host):
        m = _HEPSIBURADA_ID.search(path)
        if m:
            return CanonicalUrl(platform="hepsiburada", canonical=f"hepsiburada://{m.group(1).upper()}")

    if _N11_HOST.search(host):
        m = _N11_ID.search(path)
        if m:
            return CanonicalUrl(platform="n11", canonical=f"n11://{m.group(1).upper()}")

    # Generic fallback: host + path, query/fragment stripped, trailing slash removed.
    # Demo product pages and unknown hosts both land here.
    host_clean = host or "unknown"
    path_clean = path.rstrip("/")
    if not path_clean:
        path_clean = "/"
    platform = "demo" if host_clean.endswith("demo-product.html") or "demo-product" in path_clean else "other"
    return CanonicalUrl(platform=platform, canonical=f"{platform}://{host_clean}{path_clean}")


def detect_platform(url: str) -> str:
    """Cheap host-only platform detection — used by the observation endpoint
    when it just needs a label for storage and doesn't care about the ID."""
    return normalize(url).platform
