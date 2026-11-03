from pathlib import Path

import httpx

from lolmeta.collector import fetch_ddragon


def test_fetch_ddragon_accepts_runes_top_level_list(monkeypatch, tmp_path: Path):
    payloads = {
        "https://ddragon.leagueoflegends.com/api/versions.json": ["16.21.1"],
        "https://ddragon.leagueoflegends.com/cdn/16.21.1/data/en_US/champion.json": {"data": {"Ahri": {"id": "Ahri"}}},
        "https://ddragon.leagueoflegends.com/cdn/16.21.1/data/en_US/item.json": {"data": {"6655": {"name": "Liandry"}}},
        "https://ddragon.leagueoflegends.com/cdn/16.21.1/data/en_US/summoner.json": {"data": {"SummonerFlash": {"key": "4"}}},
        "https://ddragon.leagueoflegends.com/cdn/16.21.1/data/en_US/runesReforged.json": [{"id": 8000, "name": "Precision", "slots": []}],
    }

    class FakeResponse:
        def __init__(self, payload):
            self._payload = payload
        def raise_for_status(self):
            pass
        def json(self):
            return self._payload

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def get(self, url):
            return FakeResponse(payloads[url])

    monkeypatch.setattr(httpx, "Client", FakeClient)
    version, champions, static = fetch_ddragon("en_US", tmp_path)

    assert version == "16.21.1"
    assert "Ahri" in champions
    assert static["runesReforged"][0]["name"] == "Precision"
