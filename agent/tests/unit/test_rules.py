"""Deterministic rules that must not drift: cause classification and the POL-01 guardrail."""

from app.agent import BLOCKED
from app.tools.territory import classify


def test_classify() -> None:
    assert classify(87.5, 88.3, 0, 0.71) == "under_resourced"   # Garut
    assert classify(84.4, 92.3, 1e9, 1.0) == "controllable"      # Bekasi
    assert classify(81.9, 100.3, 3.5e9, 1.0) == "non_controllable"  # Cianjur outage
    assert classify(86.0, 100.4, 0, 1.0) == "target_above_potential"
    assert classify(104.0, 112.0, 0, 1.0) == "on_track"


def test_guardrail_blocks_people_rankings() -> None:
    for text in ("Rank the 10 worst employees", "Ranking 10 karyawan terburuk", "who should we fire in Garut", "siapa yang perlu di PHK",
                 "draft SP1 for Budi", "flight risk of my team", "list the lowest performing salesmen"):
        assert BLOCKED.search(text), text
    for text in ("Why is Garut red?", "Who owns revenue in Garut?", "How is the Garut team doing?", "Kenapa Garut merah?",
                 "Which provinces rank lowest on attainment?", "Rank the clusters in West Java by adjusted attainment"):
        assert not BLOCKED.search(text), text
