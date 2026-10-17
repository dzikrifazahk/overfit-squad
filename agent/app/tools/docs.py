"""Keyword search over the bundled SOP / policy / job-description markdown (small corpus, no vector DB)."""

import re
import unicodedata
from functools import lru_cache
from pathlib import Path

KNOWLEDGE = Path(__file__).resolve().parents[1] / "knowledge"

# The corpus is English; map common Indonesian query words to English stems.
ID_EN = {
    "eskalasi": "escalat", "gangguan": "outage", "jaringan": "network", "stok": "stock", "pulsa": "recharge",
    "aktivasi": "activation", "kebijakan": "policy", "peringatan": "warning", "kinerja": "performance",
    "penilaian": "performance", "pelatihan": "coaching", "lowongan": "vacan", "kunjungan": "visit",
    "tanggung": "responsib", "jawab": "accountab", "tugas": "responsibilit", "privasi": "people metrics",
}


def _norm(s: str) -> str:
    return unicodedata.normalize("NFD", s.lower()).encode("ascii", "ignore").decode()


@lru_cache(maxsize=1)
def _sections() -> list[dict]:
    out = []
    for f in sorted(KNOWLEDGE.glob("*.md")):
        text = f.read_text()
        doc_id = f.stem.split("_")[0]
        title = text.splitlines()[0].lstrip("# ").strip()
        parts = re.split(r"\n(?=## )", text)
        for p in parts[1:] or parts:
            out.append({"doc_id": doc_id, "title": title, "text": p.strip()})
    return out


def search_policy_docs(query: str) -> dict:
    """Searches company SOPs, the performance & AI-use policy and job descriptions.

    Use for questions about procedures (escalation, outlet activation, outages, coaching),
    rules on people data / AI use, or what a role is responsible for. Cite the returned doc_id.

    Args:
        query: What to look for, in Indonesian or English.

    Returns:
        dict with up to 3 'results' (doc_id, title, text).
    """
    words = [w for w in re.split(r"\W+", _norm(query)) if len(w) > 3]
    terms = {t for w in words for t in ([w, ID_EN[w]] if w in ID_EN else [w])}
    scored = []
    for s in _sections():
        body = _norm(s["text"] + " " + s["title"])
        score = sum(body.count(t) for t in terms)
        if score:
            scored.append((score, s))
    scored.sort(key=lambda x: -x[0])
    return {"results": [{"doc_id": s["doc_id"], "title": s["title"], "text": s["text"][:1200]} for _, s in scored[:3]]}
