from lolmeta.collector import write_csvs


def test_provider_payload_exports_build_components(tmp_path):
    record = {
        "patch": None, "data_dragon_patch": "16.21.1", "champion": "Ahri",
        "champion_id": "Ahri", "position": "MID", "source": "OP.GG MCP",
        "source_url": "https://op.gg", "collected_at": "2026-11-02T00:00:00Z",
        "statistics": {"win_rate": 0.51, "pick_rate": 0.11, "ban_rate": 0.03, "games": 238107, "tier": 1},
        "provider_payload": {"data": {
            "summary": {"average_stats": {"win_rate": 0.51}},
            "core_items": {"ids": [3118, 4645], "ids_names": ["Malignance", "Shadowflame"], "pick_rate": 0.13, "win": 8512},
            "boots": {"ids": [3020], "ids_names": ["Sorcerer's Shoes"], "pick_rate": 0.59, "win": 61901},
            "starter_items": {"ids": [1056], "ids_names": ["Doran's Ring"], "pick_rate": 0.99, "win": 105489},
            "runes": {"primary_page_id": 8100, "primary_page_name": "Domination", "primary_rune_ids": [8112], "primary_rune_names": ["Electrocute"], "secondary_page_id": 8200, "secondary_page_name": "Sorcery", "secondary_rune_ids": [8210], "secondary_rune_names": ["Transcendence"], "stat_mod_ids": [5005], "stat_mod_names": ["Attack Speed"], "pick_rate": 0.48, "win": 52329},
            "summoner_spells": {"ids": [4, 14], "ids_names": ["Flash", "Ignite"], "pick_rate": 0.7, "win": 74999},
            "skills": {"order": ["W", "Q", "E", "Q"], "pick_rate": 0.59, "win": 49956},
            "skill_masteries": {"builds": [{"order": ["W", "Q", "E"], "pick_rate": 0.64, "win": 49956}]},
        }},
    }
    write_csvs([record], tmp_path)
    items = (tmp_path / "items.csv").read_text(encoding="utf-8-sig")
    runes = (tmp_path / "runes.csv").read_text(encoding="utf-8-sig")
    spells = (tmp_path / "spells.csv").read_text(encoding="utf-8-sig")
    skills = (tmp_path / "skill_orders.csv").read_text(encoding="utf-8-sig")
    builds = (tmp_path / "champion_builds.csv").read_text(encoding="utf-8-sig")
    assert "Malignance" in items and "Sorcerer's Shoes" in items
    assert "Electrocute" in runes and "Domination" in runes
    assert "Flash" in spells and "Ignite" in spells
    assert "Level 1: W" in skills and "skill_mastery_build_1" in skills
    assert "0.51" in builds and "238107" in builds


def _static_fixture():
    from lolmeta.collector import STAT_SHARDS
    return {
        "item": {
            "1056": {"name": "Doran's Ring", "image": {"full": "1056.png"}},
            "3118": {"name": "Malignance", "image": {"full": "3118.png"}},
            "4645": {"name": "Shadowflame", "image": {"full": "4645.png"}},
            "3157": {"name": "Zhonya's Hourglass", "image": {"full": "3157.png"}},
            "3020": {"name": "Sorcerer's Shoes", "image": {"full": "3020.png"}},
            "3089": {"name": "Rabadon's Deathcap", "image": {"full": "3089.png"}},
        },
        "summoner": {
            "SummonerFlash": {"key": "4", "name": "Flash", "image": {"full": "SummonerFlash.png"}},
            "SummonerDot": {"key": "14", "name": "Ignite", "image": {"full": "SummonerDot.png"}},
        },
        "runesReforged": [{"id": 8100, "name": "Domination", "icon": "perk-images/Styles/7200_Domination.png", "slots": [{"runes": [{"id": 8112, "name": "Electrocute", "icon": "perk-images/Styles/Domination/Electrocute/Electrocute.png"}, {"id": 8139, "name": "Taste of Blood", "icon": "perk-images/Styles/Domination/TasteOfBlood.png"}, {"id": 8140, "name": "Grisly Mementos", "icon": "perk-images/Styles/Domination/GrislyMementos.png"}, {"id": 8106, "name": "Ultimate Hunter", "icon": "perk-images/Styles/Domination/UltimateHunter.png"}]}, {"runes": []}]}, {"id": 8200, "name": "Sorcery", "icon": "perk-images/Styles/7202_Sorcery.png", "slots": [{"runes": [{"id": 8210, "name": "Transcendence", "icon": "perk-images/Styles/Sorcery/Transcendence/Transcendence.png"}, {"id": 8226, "name": "Manaflow Band", "icon": "perk-images/Styles/Sorcery/ManaflowBand/ManaflowBand.png"}]}]}],
        "champion": {},
    }


def test_normalise_record_resolves_build_and_calculates_rates():
    from lolmeta.collector import normalise_record
    raw = {"data": {
        "summary": {"average_stats": {"play": 238107, "win_rate": 0.51, "pick_rate": 0.11, "ban_rate": 0.03, "tier": 1}},
        "starter_items": {"ids": [1056], "ids_names": ["Doran's Ring"], "play": 205185, "win": 105489, "pick_rate": 0.99},
        "boots": {"ids": [3020], "ids_names": ["Sorcerer's Shoes"], "play": 119192, "win": 61901, "pick_rate": 0.59},
        "core_items": {"ids": [3118, 4645, 3157], "ids_names": ["Malignance", "Shadowflame", "Zhonya's Hourglass"], "play": 16172, "win": 8512, "pick_rate": 0.13},
        "fourth_items": [{"ids": [3089], "ids_names": ["Rabadon's Deathcap"], "play": 16966, "win": 9953, "pick_rate": 0.32}, {"ids": [3157], "ids_names": ["Zhonya's Hourglass"], "play": 13222, "win": 7874, "pick_rate": 0.25}],
        "summoner_spells": {"ids": [4, 14], "ids_names": [4, 14], "play": 145210, "win": 74999, "pick_rate": 0.70},
        "runes": {"primary_page_id": 8100, "secondary_page_id": 8200, "primary_rune_ids": [8112, 8139, 8140, 8106], "primary_rune_names": ["Electrocute", "Taste of Blood", "Grisly Mementos", "Ultimate Hunter"], "secondary_rune_ids": [8210, 8226], "secondary_rune_names": ["Transcendence", "Manaflow Band"], "stat_mod_ids": [5005, 5008, 5001], "stat_mod_names": [5005, 5008, 5001], "play": 103268, "win": 52329, "pick_rate": 0.48},
        "skills": {"order": ["W", "Q", "E", "Q", "Q", "R", "Q", "W", "Q", "W", "R", "W", "W", "E", "E"], "play": 85930, "win": 49956, "pick_rate": 0.59},
    }}
    champ = {"name": "Ahri", "id": "Ahri", "key": "103", "image": {"full": "Ahri.png"}}
    record = normalise_record(champ, "mid", "16.21.1", raw, _static_fixture())
    assert record["patch"] == "16.21.1"
    assert record["statistics"] == {"win_rate": 51.0, "pick_rate": 11.0, "ban_rate": 3.0, "games": 238107, "tier": 1}
    assert record["build"]["summoner_spells"][0]["name"] == "Flash"
    assert record["build"]["summoner_spells"][1]["image"].endswith("SummonerDot.png")
    assert record["build"]["runes"]["stat_shards"][0]["name"] == "Attack Speed"
    assert record["build"]["runes"]["stat_shards"][0]["image"].endswith("/statmodsattackspeedicon.png")
    assert record["build"]["situational_items"]["fourth"][0]["name"] == "Rabadon's Deathcap"
    assert record["build"]["situational_items"]["fourth"][0]["win_rate"] == 58.6644


def test_normalise_rejects_missing_stats_or_build():
    import pytest
    from lolmeta.collector import normalise_record
    champ = {"name": "Ahri", "id": "Ahri", "key": "103", "image": {"full": "Ahri.png"}}
    with pytest.raises(ValueError, match="Incomplete champion record"):
        normalise_record(champ, "mid", "16.21.1", {"data": {}}, _static_fixture())


def test_skill_max_priority_uses_full_order_not_first_three_levels():
    from lolmeta.collector import _skill_max_order
    order = ["Q", "W", "E", "Q", "Q", "R", "Q", "E", "Q", "E", "R", "E", "E", "W", "W"]
    assert _skill_max_order(order) == ["Q", "E", "W"]


def test_projection_uses_most_played_skill_mastery_build_and_exports_max_order():
    from lolmeta.collector import _build_projection
    static = _static_fixture()
    order_qew = ["Q", "W", "E", "Q", "Q", "R", "Q", "E", "Q", "E", "R", "E", "E", "W", "W"]
    order_qwe = ["Q", "W", "E", "Q", "Q", "R", "Q", "W", "Q", "W", "R", "W", "W", "E", "E"]
    data = {
        "skill_masteries": {"builds": [
            {"order": order_qwe, "play": 100, "win": 55, "pick_rate": 0.2},
            {"order": order_qew, "play": 500, "win": 280, "pick_rate": 0.6},
        ]}
    }
    projection = _build_projection(data, "16.21.1", static)
    assert projection["skill_order"] == order_qew
    assert projection["skill_max_order"] == ["Q", "E", "W"]
    assert projection["skill_order_sample_size"] == 500
