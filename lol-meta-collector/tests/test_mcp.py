from lolmeta.mcp import build_tool_arguments, decode_tool_result


def test_build_args_uses_live_schema_and_enums():
    tool = {
        "name": "lol_get_champion_analysis",
        "inputSchema": {
            "type": "object",
            "properties": {
                "champion": {"type": "string"},
                "game_mode": {"type": "string", "enum": ["ranked", "aram"]},
                "lang": {"type": "string"},
                "position": {"type": "string", "enum": ["TOP", "MID"]},
                "desired_output_fields": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["champion", "game_mode", "lang", "position", "desired_output_fields"],
        },
    }
    args = build_tool_arguments(tool, "Ahri", "MID", "ranked", "en_US")
    assert args == {
        "champion": "Ahri",
        "game_mode": "ranked",
        "lang": "en_US",
        "position": "MID",
        "desired_output_fields": [
            "champion",
            "position",
            "data.summary.average_stats.{win_rate,pick_rate,ban_rate,play,tier}",
            "data.boots.{ids[],ids_names[],pick_rate,play,win}",
            "data.starter_items.{ids[],ids_names[],pick_rate,play,win}",
            "data.core_items.{ids[],ids_names[],pick_rate,play,win}",
            "data.fourth_items[].{ids[],ids_names[],pick_rate,play,win}",
            "data.fifth_items[].{ids[],ids_names[],pick_rate,play,win}",
            "data.sixth_items[].{ids[],ids_names[],pick_rate,play,win}",
            "data.last_items[].{ids[],ids_names[],pick_rate,play,win}",
            "data.runes.{id,pick_rate,play,primary_page_id,primary_page_name,primary_rune_ids[],primary_rune_names[],secondary_page_id,secondary_page_name,secondary_rune_ids[],secondary_rune_names[],stat_mod_ids[],stat_mod_names[],win}",
            "data.summoner_spells.{ids[],ids_names[],pick_rate,play,win}",
            "data.skills.{order[],pick_rate,play,win}",
            "data.skill_masteries.builds[].{order[],pick_rate,play,win}",
        ],
    }


def test_decode_json_text_result():
    result = {"content": [{"type": "text", "text": '{"data":{"winRate":52.1}}'}]}
    assert decode_tool_result(result) == {"data": {"winRate": 52.1}}


def test_decode_plain_text_result_is_preserved():
    result = {"content": [{"type": "text", "text": "not json"}]}
    assert decode_tool_result(result) == {"text": "not json"}


def test_decode_opgg_typed_model_repr():
    text = r'''class LolGetChampionAnalysis: champion,position,data
class Data: summary,core_items,boots,starter_items,last_items,fourth_items,fifth_items,sixth_items,summoner_spells,runes,skills,skill_masteries
class Summary: average_stats
class AverageStats: play,win_rate,pick_rate,ban_rate,tier
class CoreItems: ids,ids_names,play,win,pick_rate
class Runes: id,primary_page_id,primary_page_name,primary_rune_ids,primary_rune_names,secondary_page_id,secondary_page_name,secondary_rune_ids,secondary_rune_names,stat_mod_ids,stat_mod_names,play,win,pick_rate
class Skills: order,play,win,pick_rate
class SkillMasteries: builds
LolGetChampionAnalysis("AHRI","MID",Data(Summary(AverageStats(238107,0.51,0.11,0.03,1)),CoreItems([3118],["Malignance"],16172,8512,0.13),CoreItems([3020],["Sorcerer's Shoes"],119192,61901,0.59),CoreItems([1056],["Doran's Ring"],205185,105489,0.99),[],[],[],[],CoreItems([4,14],["Flash","Ignite"],145210,74999,0.7),Runes(8112,8100,"Domination",[8112,8139],["Electrocute","Taste of Blood"],8200,"Sorcery",[8210],["Transcendence"],[5005],["Attack Speed"],103268,52329,0.48),Skills(["W","Q","E"],85930,49956,0.59),SkillMasteries([Skills(["W","Q","E"],85930,49956,0.64)])))'''
    decoded = decode_tool_result({"content": [{"type": "text", "text": text}]})
    stats = decoded["data"]["summary"]["average_stats"]
    assert stats["win_rate"] == 0.51
    assert decoded["data"]["core_items"]["ids"] == [3118]
    assert decoded["data"]["skills"]["order"] == ["W", "Q", "E"]


def test_build_args_passes_configured_all_rank_tier():
    tool = {
        "name": "lol_get_champion_analysis",
        "inputSchema": {"type": "object", "properties": {
            "champion": {"type": "string"}, "tier": {"type": "string"},
            "desired_output_fields": {"type": "array", "items": {"type": "string"}},
        }, "required": ["champion", "tier", "desired_output_fields"]},
    }
    args = build_tool_arguments(tool, "Ahri", "MID", "ranked", "en_US", "all")
    assert args["tier"] == "all"
