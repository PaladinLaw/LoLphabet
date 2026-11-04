import json
from pathlib import Path

from lolmeta.collector import _load_existing_records, _build_projection
from test_provider_export import _static_fixture


def test_load_existing_records_recovers_same_patch_record_from_archive(tmp_path: Path):
    current = tmp_path / "current"
    archive = tmp_path / "archive" / "ddragon-16.22.1-old"
    current.mkdir(parents=True)
    archive.mkdir(parents=True)
    previous = {
        "champion": "Aatrox", "champion_id": "Aatrox",
        "position": "JUNGLE", "patch": "16.22.1",
    }
    (archive / "champions.json").write_text(json.dumps([previous]), encoding="utf-8")

    recovered = _load_existing_records(current, tmp_path / "archive", "16.22.1")

    assert recovered[("aatrox", "jungle")]["champion"] == "Aatrox"


def test_load_existing_records_does_not_mix_patches(tmp_path: Path):
    current = tmp_path / "current"
    archive = tmp_path / "archive" / "old"
    current.mkdir(parents=True)
    archive.mkdir(parents=True)
    previous = {
        "champion": "Aatrox", "champion_id": "Aatrox",
        "position": "JUNGLE", "patch": "16.21.1",
    }
    (archive / "champions.json").write_text(json.dumps([previous]), encoding="utf-8")

    recovered = _load_existing_records(current, tmp_path / "archive", "16.22.1")

    assert ("aatrox", "jungle") not in recovered


def test_unresolved_optional_item_does_not_abort_projection():
    static = _static_fixture()
    data = {
        "fourth_items": [{"ids": [4], "play": 10, "win": 5}],
    }
    projection = _build_projection(data, "16.21.1", static)
    assert projection["situational_items"] == {}
