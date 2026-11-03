from pathlib import Path

from lolmeta.collector import write_csvs


def test_component_csvs_are_emitted_from_source_fields(tmp_path: Path):
    records = [{
        "patch": "16.21.1", "champion": "Ahri", "champion_id": "Ahri",
        "champion_key": "103", "position": "MID", "source": "OP.GG MCP",
        "source_url": "https://op.gg", "collected_at": "2026-11-02T00:00:00Z",
        "statistics": {"win_rate": 52.0},
        "provider_payload": {"data": {"items": [{"id": 6655, "name": "Liandry"}], "runes": [{"id": 8112}], "spells": [4, 12], "skill_order": ["Q", "W", "E"]}},
    }]
    write_csvs(records, tmp_path)
    for filename in ("champion_builds.csv", "items.csv", "runes.csv", "spells.csv", "skill_orders.csv"):
        assert (tmp_path / filename).exists()
    assert "Liandry" in (tmp_path / "items.csv").read_text(encoding="utf-8-sig")
