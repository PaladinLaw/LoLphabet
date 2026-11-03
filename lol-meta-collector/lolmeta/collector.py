from __future__ import annotations

import asyncio
import csv
import json
import logging
import re
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from .mcp import OPGGMCPClient, build_tool_arguments, decode_tool_result

LOG = logging.getLogger("lolmeta")
POSITIONS = {"top": "TOP", "jungle": "JUNGLE", "mid": "MID", "adc": "ADC", "support": "SUPPORT"}
DD_VERSION_URL = "https://ddragon.leagueoflegends.com/api/versions.json"
DD_CHAMPIONS_URL = "https://ddragon.leagueoflegends.com/cdn/{version}/data/{locale}/champion.json"
STAT_SHARDS = {
    "5001": ("Health Scaling", "StatModsHealthScalingIcon.png"),
    "5002": ("Armor", "StatModsArmorIcon.png"),
    "5003": ("Magic Resistance", "StatModsMagicResIcon.png"),
    "5005": ("Attack Speed", "StatModsAttackSpeedIcon.png"),
    "5007": ("Ability Haste", "StatModsCDRScalingIcon.png"),
    "5008": ("Adaptive Force", "StatModsAdaptiveForceIcon.png"),
    "5010": ("Movement Speed", "StatModsMovementSpeedIcon.png"),
    "5011": ("Health", "StatModsHealthPlusIcon.png"),
    "5013": ("Tenacity and Slow Resist", "StatModsTenacityIcon.png"),
}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def fetch_ddragon(locale: str, cache_dir: Path) -> tuple[str, dict[str, Any], dict[str, Any]]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=30, follow_redirects=True) as client:
        versions_response = client.get(DD_VERSION_URL)
        versions_response.raise_for_status()
        version = versions_response.json()[0]
        static: dict[str, Any] = {}
        for dataset in ("champion", "item", "summoner", "runesReforged"):
            cache_file = cache_dir / f"{dataset}-{version}-{locale}.json"
            if cache_file.exists():
                payload = read_json(cache_file)
            else:
                url = f"https://ddragon.leagueoflegends.com/cdn/{version}/data/{locale}/{dataset}.json"
                response = client.get(url)
                response.raise_for_status()
                payload = response.json()
                write_json(cache_file, payload)
            # Data Dragon champion/item/summoner datasets are objects with a `data`
            # member; runesReforged is already a top-level list.
            static[dataset] = payload.get("data", payload) if isinstance(payload, dict) else payload
    return version, static["champion"], static


def build_asset_manifest(version: str, static: dict[str, Any]) -> dict[str, Any]:
    base = f"https://ddragon.leagueoflegends.com/cdn/{version}"
    items = {}
    for item_id, item in static.get("item", {}).items():
        image = item.get("image", {}).get("full")
        if image:
            items[str(item_id)] = {"name": item.get("name"), "image": f"{base}/img/item/{image}"}
    spells = {}
    for spell_id, spell in static.get("summoner", {}).items():
        image = spell.get("image", {}).get("full")
        if image:
            spells[str(spell.get("key", spell_id))] = {"name": spell.get("name"), "image": f"{base}/img/spell/{image}"}
    runes = {}
    for style in static.get("runesReforged", []):
        for slot in style.get("slots", []):
            for rune in slot.get("runes", []):
                rune_id = rune.get("id")
                icon = rune.get("icon")
                if rune_id is not None and icon:
                    runes[str(rune_id)] = {
                        "name": rune.get("name"),
                        "style": style.get("name"),
                        "image": f"https://ddragon.leagueoflegends.com/cdn/img/{icon}",
                    }
    styles = {}
    for style in static.get("runesReforged", []):
        if style.get("id") is not None and style.get("icon"):
            styles[str(style["id"])] = {
                "name": style.get("name"),
                "image": f"https://ddragon.leagueoflegends.com/cdn/img/{style['icon']}",
            }
    return {
        "patch": version,
        "source": "Riot Data Dragon",
        "champions": {
            str(champ.get("key")): {
                "id": champ.get("id"),
                "name": champ.get("name"),
                "image": f"{base}/img/champion/{champ.get('image', {}).get('full')}" if champ.get("image", {}).get("full") else None,
            }
            for champ in static.get("champion", {}).values()
        },
        "items": items,
        "summoner_spells": spells,
        "runes": runes,
        "rune_styles": styles,
        "stat_shards": {
            shard_id: {
                "name": name,
                "image": f"https://raw.communitydragon.org/latest/game/assets/perks/statmods/{icon.lower()}",
            }
            for shard_id, (name, icon) in STAT_SHARDS.items()
        },
    }


def discover_champion_tool(client: OPGGMCPClient) -> dict[str, Any]:
    tool = client.tools.get("lol_get_champion_analysis")
    if not tool:
        names = ", ".join(sorted(client.tools))
        raise RuntimeError(f"OP.GG MCP does not expose lol_get_champion_analysis. Tools found: {names}")
    return tool


def discover_champion_roster(client: OPGGMCPClient, language: str) -> list[dict[str, Any]]:
    tool = client.tools.get("lol_list_champions")
    if not tool:
        return []
    args = {}
    schema = tool.get("inputSchema", {})
    props = schema.get("properties", {})
    for key in ("lang", "language", "locale"):
        if key in props:
            args[key] = language
            break
    if "desired_output_fields" in props:
        args["desired_output_fields"] = ["data"]
    missing = set(schema.get("required", [])) - set(args)
    if missing:
        LOG.warning("Skipping MCP champion roster: unsupported required arguments %s", sorted(missing))
        return []
    result = client.call_tool("lol_list_champions", args)
    return decode_tool_result(result)


def _walk(obj: Any):
    if isinstance(obj, dict):
        for key, value in obj.items():
            yield key, value
            yield from _walk(value)
    elif isinstance(obj, list):
        for value in obj:
            yield from _walk(value)


def first_value(obj: Any, keys: set[str]) -> Any:
    for key, value in _walk(obj):
        if key.lower() in keys and value is not None:
            return value
    return None


def _as_rate(value: Any) -> float | None:
    if value is None:
        return None
    try:
        rate = float(value)
    except (TypeError, ValueError):
        return None
    # OP.GG returns rates as fractions (0.51); retain percentage-style values if supplied.
    return rate * 100 if 0 <= rate <= 1 else rate


def _ratio(win_count: Any, play_count: Any) -> float | None:
    try:
        wins, games = float(win_count), float(play_count)
    except (TypeError, ValueError):
        return None
    if games <= 0 or wins < 0 or wins > games:
        return None
    return round((wins / games) * 100, 4)


def _pick_popular(groups: Any) -> dict[str, Any] | None:
    if isinstance(groups, dict):
        return groups
    if not isinstance(groups, list) or not groups:
        return None
    def popularity(group: Any):
        if not isinstance(group, dict):
            return -1
        try:
            return float(group.get("play", 0) or 0)
        except (TypeError, ValueError):
            return -1
    candidates = [g for g in groups if isinstance(g, dict)]
    return max(candidates, key=popularity) if candidates else None


def _build_projection(data: dict[str, Any], patch: str, static: dict[str, Any]) -> dict[str, Any]:
    manifest = build_asset_manifest(patch, static)
    def item_group(field: str):
        group = _pick_popular(data.get(field))
        if not group:
            return []
        ids = group.get("ids", [])
        names = group.get("ids_names", [])
        ids = ids if isinstance(ids, list) else [ids]
        names = names if isinstance(names, list) else [names]
        output = []
        for index, item_id in enumerate(ids):
            key = str(item_id)
            metadata = manifest["items"].get(key, {})
            name = names[index] if index < len(names) and names[index] not in (None, item_id, str(item_id)) else metadata.get("name")
            if not name:
                raise ValueError(f"Unknown Data Dragon item id {item_id}")
            output.append({
                "id": int(item_id), "name": name, "image": metadata.get("image"),
                "pick_rate": _as_rate(group.get("pick_rate")),
                "win_rate": _ratio(group.get("win"), group.get("play")),
                "sample_size": group.get("play"),
            })
        return output

    starters = item_group("starter_items")
    boots = item_group("boots")
    core = item_group("core_items")
    situational = {}
    for field in ("fourth_items", "fifth_items", "sixth_items", "last_items"):
        selected = item_group(field)
        if selected:
            situational[field.replace("_items", "")] = selected

    spells_group = data.get("summoner_spells") or {}
    spell_ids = spells_group.get("ids", []) if isinstance(spells_group, dict) else []
    spell_ids = spell_ids if isinstance(spell_ids, list) else [spell_ids]
    spells = []
    for spell_id in spell_ids:
        spell = manifest["summoner_spells"].get(str(spell_id))
        if not spell:
            raise ValueError(f"Unknown Data Dragon summoner spell id {spell_id}")
        spells.append({
            "id": int(spell_id), **spell,
            "pick_rate": _as_rate(spells_group.get("pick_rate")),
            "win_rate": _ratio(spells_group.get("win"), spells_group.get("play")),
            "sample_size": spells_group.get("play"),
        })

    rune_group = data.get("runes") or {}
    runes = {
        "primary_style": None, "secondary_style": None, "primary": [], "secondary": [], "stat_shards": [],
        "pick_rate": _as_rate(rune_group.get("pick_rate")) if isinstance(rune_group, dict) else None,
        "win_rate": _ratio(rune_group.get("win"), rune_group.get("play")) if isinstance(rune_group, dict) else None,
        "sample_size": rune_group.get("play") if isinstance(rune_group, dict) else None,
    }
    if isinstance(rune_group, dict):
        for target, id_key, name_key in (("primary", "primary_rune_ids", "primary_rune_names"), ("secondary", "secondary_rune_ids", "secondary_rune_names")):
            ids = rune_group.get(id_key, []) or []
            names = rune_group.get(name_key, []) or []
            for index, rune_id in enumerate(ids):
                rune = manifest["runes"].get(str(rune_id))
                if not rune:
                    raise ValueError(f"Unknown Data Dragon rune id {rune_id}")
                runes[target].append({"id": int(rune_id), **rune})
        for target, id_key in (("primary_style", "primary_page_id"), ("secondary_style", "secondary_page_id")):
            style_id = rune_group.get(id_key)
            if style_id is not None:
                style = manifest["rune_styles"].get(str(style_id))
                if not style:
                    raise ValueError(f"Unknown Data Dragon rune style id {style_id}")
                runes[target] = {"id": int(style_id), **style}
        for shard_id in rune_group.get("stat_mod_ids", []) or []:
            shard = manifest["stat_shards"].get(str(shard_id))
            if not shard:
                raise ValueError(f"Unknown stat shard id {shard_id}")
            runes["stat_shards"].append({"id": int(shard_id), **shard})

    skills = data.get("skills") or {}
    skill_order = skills.get("order", []) if isinstance(skills, dict) else []
    return {
        "starting_items": starters,
        "core_items": {"boots": boots, "items": core},
        "situational_items": situational,
        "summoner_spells": spells,
        "runes": runes,
        "skill_order": skill_order,
    }


def validate_record(record: dict[str, Any]) -> None:
    errors = []
    stats = record.get("statistics", {})
    for field in ("win_rate", "pick_rate", "ban_rate", "games", "tier"):
        if stats.get(field) is None:
            errors.append(f"statistics.{field}")
    if not record.get("patch"):
        errors.append("patch")
    build = record.get("build", {})
    for field in ("starting_items", "core_items", "summoner_spells", "runes", "skill_order"):
        if not build.get(field):
            errors.append(f"build.{field}")
    if len(build.get("summoner_spells", [])) != 2:
        errors.append("build.summoner_spells (expected 2 spells)")
    rune_build = build.get("runes", {})
    if not rune_build.get("primary_style") or len(rune_build.get("primary", [])) != 4:
        errors.append("build.runes.primary (expected a style and 4 runes)")
    if not rune_build.get("secondary_style") or len(rune_build.get("secondary", [])) != 2:
        errors.append("build.runes.secondary (expected a style and 2 runes)")
    if len(rune_build.get("stat_shards", [])) != 3:
        errors.append("build.runes.stat_shards (expected 3 shards)")
    if not build.get("core_items", {}).get("items"):
        errors.append("build.core_items.items")
    if len(build.get("skill_order", [])) != 15:
        errors.append("build.skill_order (expected 15 levels)")
    if stats.get("games") is not None and stats["games"] <= 0:
        errors.append("statistics.games (must be positive)")
    for field in ("win_rate", "pick_rate", "ban_rate"):
        value = stats.get(field)
        if value is not None and not 0 <= float(value) <= 100:
            errors.append(f"statistics.{field} (must be between 0 and 100)")
    if errors:
        raise ValueError("Incomplete champion record: " + ", ".join(errors))


def normalise_record(champion: dict[str, Any], position: str, patch: str, raw: Any, static: dict[str, Any] | None = None) -> dict[str, Any]:
    """Project the live OP.GG analysis model into a validated, frontend-ready record."""
    if not isinstance(raw, dict):
        raise ValueError("OP.GG response is not a structured object")
    data = raw.get("data") if isinstance(raw.get("data"), dict) else None
    if data is None and isinstance(raw.get("text"), str):
        raise ValueError("OP.GG returned undecoded text rather than champion analysis data")
    if data is None:
        data = raw
    average = data.get("summary", {}).get("average_stats", {}) if isinstance(data.get("summary"), dict) else {}
    if not isinstance(average, dict):
        average = {}
    games = average.get("play")
    stats = {
        "win_rate": _as_rate(average.get("win_rate")),
        "pick_rate": _as_rate(average.get("pick_rate")),
        "ban_rate": _as_rate(average.get("ban_rate")),
        "games": int(games) if isinstance(games, (int, float)) and games > 0 else None,
        "tier": average.get("tier"),
    }
    record = {
        "champion": champion["name"], "champion_id": champion["id"], "champion_key": champion["key"],
        "position": position.upper(), "patch": patch, "data_dragon_patch": patch,
        "source": "OP.GG MCP", "source_url": "https://op.gg",
        "collected_at": datetime.now(timezone.utc).isoformat(), "statistics": stats,
        "assets": {
            "champion_icon": f"https://ddragon.leagueoflegends.com/cdn/{patch}/img/champion/{champion['image']['full']}",
            "item_base_url": f"https://ddragon.leagueoflegends.com/cdn/{patch}/img/item/",
            "spell_base_url": f"https://ddragon.leagueoflegends.com/cdn/{patch}/img/spell/",
            "rune_base_url": "https://ddragon.leagueoflegends.com/cdn/img/",
        },
        "provider_payload": raw,
    }
    if static is None:
        raise ValueError("Data Dragon metadata is required to resolve build assets")
    record["build"] = _build_projection(data, patch, static)
    # Component win rates use each component's own sample denominator, not champion-wide games.
    for field in ("boots", "starter_items", "core_items", "fourth_items", "fifth_items", "sixth_items", "last_items", "summoner_spells", "runes", "skills"):
        group = _pick_popular(data.get(field))
        if group:
            group["win_rate"] = _ratio(group.get("win"), group.get("play"))
    validate_record(record)
    return record


def _candidate_entries(payload: Any, aliases: set[str]):
    """Yield list/dict values whose source key identifies a build component."""
    for key, value in _walk(payload):
        if key.lower() in aliases and isinstance(value, (list, dict)):
            entries = value if isinstance(value, list) else [value]
            for rank, entry in enumerate(entries, 1):
                yield key, rank, entry


def _entry_field(entry: Any, names: set[str]) -> Any:
    if isinstance(entry, dict):
        for key, value in entry.items():
            if key.lower() in names and isinstance(value, (str, int, float, bool)):
                return value
    if isinstance(entry, (str, int, float, bool)):
        return entry
    return None


def _component_rows(record: dict[str, Any], component: str):
    payload = record.get("provider_payload")
    if not isinstance(payload, dict):
        return
    data = payload.get("data", {}) if isinstance(payload.get("data"), dict) else {}

    def emit(source_field: str, rank: int, item_id: Any, name: Any, pick_rate: Any = None, win_rate: Any = None, extra: Any = None):
        return {
            "patch": record.get("patch") or record.get("data_dragon_patch"),
            "champion": record["champion"], "position": record["position"],
            "source_field": source_field, "rank": rank, "id": item_id, "name": name,
            "pick_rate": pick_rate, "win_rate": win_rate,
            "raw_entry_json": json.dumps(extra if extra is not None else {"id": item_id, "name": name}, ensure_ascii=False, separators=(",", ":")),
        }

    # Compatibility for older/generic records created before the structured `build` projection.
    if not isinstance(record.get("build"), dict):
        legacy_aliases = {
            "items": {"items", "item_build", "item_builds", "core_items", "starting_items", "starter_items", "boots", "situational_items", "recommended_items"},
            "runes": {"runes", "rune", "rune_page", "rune_pages", "rune_build", "rune_builds", "rune_selection"},
            "spells": {"spells", "summoner_spells", "summonerspells", "spell_combination", "summoner_spell"},
            "skill_orders": {"skill_order", "skillorder", "skill_priority", "skillpriority", "max_order", "ability_order", "ability_priority"},
        }
        for source_field, rank, entry in _candidate_entries(data, legacy_aliases.get(component, set())):
            item_id = _entry_field(entry, {"id", "item_id", "rune_id", "spell_id", "key"})
            name = _entry_field(entry, {"name", "title", "display_name", "label"})
            yield emit(source_field, rank, item_id, name,
                       _as_rate(_entry_field(entry, {"pick_rate", "pickrate"})),
                       _as_rate(_entry_field(entry, {"win_rate", "winrate"})), entry)
        if component == "skill_orders":
            skills = data.get("skills", {})
            if isinstance(skills, dict):
                for level, skill in enumerate(skills.get("order", []), 1):
                    yield emit("skills", level, skill, f"Level {level}: {skill}", _as_rate(skills.get("pick_rate")), _as_rate(skills.get("win_rate")), skills)
            mastery = data.get("skill_masteries", {})
            if isinstance(mastery, dict):
                for build_rank, build in enumerate(mastery.get("builds", []), 1):
                    for level, skill in enumerate(build.get("order", []), 1):
                        yield emit(f"skill_mastery_build_{build_rank}", level, skill, f"Level {level}: {skill}", _as_rate(build.get("pick_rate")), _as_rate(build.get("win_rate")), build)
        return

    if component == "items":
        build = record.get("build", {})
        for category, groups in (
            ("starter_items", build.get("starting_items", [])),
            ("boots", build.get("core_items", {}).get("boots", [])),
            ("core_items", build.get("core_items", {}).get("items", [])),
        ):
            for idx, item in enumerate(groups, 1):
                yield emit(category, idx, item.get("id"), item.get("name"), item.get("pick_rate"), item.get("win_rate"), item)
        for category, groups in build.get("situational_items", {}).items():
            for idx, item in enumerate(groups, 1):
                yield emit(category, idx, item.get("id"), item.get("name"), item.get("pick_rate"), item.get("win_rate"), item)
    elif component == "runes":
        build_runes = record.get("build", {}).get("runes", {})
        for field in ("primary_style", "secondary_style", "primary", "secondary", "stat_shards"):
            value = build_runes.get(field)
            values = value if isinstance(value, list) else ([value] if value else [])
            for idx, rune in enumerate(values, 1):
                yield emit(field, idx, rune.get("id"), rune.get("name"), build_runes.get("pick_rate"), build_runes.get("win_rate"), rune)
    elif component == "spells":
        for idx, spell in enumerate(record.get("build", {}).get("summoner_spells", []), 1):
            yield emit("summoner_spells", idx, spell.get("id"), spell.get("name"), spell.get("pick_rate"), spell.get("win_rate"), spell)
    elif component == "skill_orders":
        skills = data.get("skills", {})
        if isinstance(skills, dict):
            for level, skill in enumerate(skills.get("order", []), 1):
                yield emit("skills", level, skill, f"Level {level}: {skill}", _as_rate(skills.get("pick_rate")), _ratio(skills.get("win"), skills.get("play")), skills)
        mastery = data.get("skill_masteries", {})
        if isinstance(mastery, dict):
            for build_rank, build in enumerate(mastery.get("builds", []), 1):
                if isinstance(build, dict):
                    for level, skill in enumerate(build.get("order", []), 1):
                        yield emit(f"skill_mastery_build_{build_rank}", level, skill, f"Level {level}: {skill}", _as_rate(build.get("pick_rate")), _ratio(build.get("win"), build.get("play")), build)

    # Backwards-compatible support for generic JSON-shaped provider payloads.
    legacy_aliases = {
        "items": {"items", "item_build", "item_builds", "core_items", "starting_items", "boots", "situational_items", "recommended_items"},
        "runes": {"runes", "rune", "rune_page", "rune_pages", "rune_build", "rune_builds", "rune_selection"},
        "spells": {"spells", "summoner_spells", "summonerspells", "spell_combination", "summoner_spell"},
        "skill_orders": {"skill_order", "skillorder", "skill_priority", "skillpriority", "max_order", "ability_order", "ability_priority"},
    }
    specific_present = {
        "items": any(isinstance(data.get(key), (dict, list)) for key in ("starter_items", "boots", "core_items", "fourth_items", "fifth_items", "sixth_items", "last_items")),
        "runes": isinstance(data.get("runes"), dict),
        "spells": isinstance(data.get("summoner_spells"), dict),
        "skill_orders": isinstance(data.get("skills"), dict) or isinstance(data.get("skill_masteries"), dict),
    }.get(component, False)
    if component in legacy_aliases and not specific_present:
        for source_field, rank, entry in _candidate_entries(data, legacy_aliases[component]):
            yield emit(source_field, rank,
                       _entry_field(entry, {"id", "item_id", "rune_id", "spell_id", "key"}),
                       _entry_field(entry, {"name", "title", "display_name", "label"}),
                       _entry_field(entry, {"pick_rate", "pickrate"}),
                       _entry_field(entry, {"win_rate", "winrate"}), entry)


def _write_component_csv(records: list[dict[str, Any]], output_dir: Path, filename: str, component: str) -> None:
    rows = [row for record in records for row in _component_rows(record, component)]
    path = output_dir / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = ["patch", "champion", "position", "source_field", "rank", "id", "name", "pick_rate", "win_rate", "raw_entry_json"]
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def write_csvs(records: list[dict[str, Any]], output_dir: Path) -> None:
    flat_rows = []
    for record in records:
        stats = record.get("statistics", {})
        flat_rows.append({
            "patch": record.get("patch") or record.get("data_dragon_patch"), "champion": record["champion"],
            "champion_id": record["champion_id"], "position": record["position"],
            "win_rate": stats.get("win_rate"), "pick_rate": stats.get("pick_rate"),
            "ban_rate": stats.get("ban_rate"), "games": stats.get("games"),
            "tier": stats.get("tier"), "source": record["source"],
            "source_url": record["source_url"], "collected_at": record["collected_at"],
        })
    path = output_dir / "champion_builds.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = list(flat_rows[0]) if flat_rows else ["patch", "champion", "champion_id", "position", "win_rate", "pick_rate", "ban_rate", "games", "tier", "source", "source_url", "collected_at"]
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(flat_rows)

    # Component CSVs are generated from actual provider fields, not invented build values.
    _write_component_csv(records, output_dir, "items.csv", "items")
    _write_component_csv(records, output_dir, "runes.csv", "runes")
    _write_component_csv(records, output_dir, "spells.csv", "spells")
    _write_component_csv(records, output_dir, "skill_orders.csv", "skill_orders")


def collect(config: dict[str, Any], champion_filter: str | None = None, position_filter: str | None = None, limit: int | None = None, probe: bool = False) -> dict[str, Any]:
    root = Path(config.get("output_dir", "data"))
    current_dir = root / "current"
    cache_dir = root / "cache"
    patch, champions, static = fetch_ddragon(config.get("ddragon_locale", "en_US"), cache_dir)
    asset_manifest = build_asset_manifest(patch, static)
    current_dir.mkdir(parents=True, exist_ok=True)
    # Never leave stale champion JSON files from a previous run appearing current.
    shutil.rmtree(current_dir / "champions", ignore_errors=True)
    (current_dir / "champions").mkdir(parents=True, exist_ok=True)
    write_json(current_dir / "static-assets.json", asset_manifest)
    selected = sorted(champions.values(), key=lambda c: c["name"].lower())
    if champion_filter:
        selected = [c for c in selected if c["name"].casefold() == champion_filter.casefold() or c["id"].casefold() == champion_filter.casefold()]
        if not selected:
            raise ValueError(f"Champion {champion_filter!r} not found in Data Dragon patch {patch}")
    positions = [position_filter.lower()] if position_filter else [p.lower() for p in config.get("positions", POSITIONS)]
    invalid = set(positions) - set(POSITIONS)
    if invalid:
        raise ValueError(f"Invalid position(s): {sorted(invalid)}. Valid: {sorted(POSITIONS)}")
    if probe:
        selected = selected[:1]
        positions = positions[:1]
    tasks = [(champ, pos) for champ in selected for pos in positions]
    if limit:
        tasks = tasks[:limit]

    records: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    with OPGGMCPClient(config["mcp_url"], config.get("request_timeout_seconds", 45), config.get("max_retries", 3)) as mcp:
        tool = discover_champion_tool(mcp)
        write_json(root / "mcp-tool-schema.json", tool)
        for index, (champ, pos) in enumerate(tasks, 1):
            LOG.info("[%s/%s] %s %s", index, len(tasks), champ["name"], pos.upper())
            try:
                opgg_champion = re.sub(r"(?<!^)(?=[A-Z])", "_", champ["id"]).upper()
                args = build_tool_arguments(tool, opgg_champion, POSITIONS[pos], config.get("game_mode", "ranked"), config.get("language", "en_US"))
                result = mcp.call_tool("lol_get_champion_analysis", args)
                raw = decode_tool_result(result)
                record = normalise_record(champ, pos, patch, raw, static)
                filename = re.sub(r"[^a-z0-9_-]+", "-", champ["id"].lower())
                write_json(current_dir / "champions" / f"{filename}-{pos}.json", record)
                records.append(record)
            except Exception as exc:  # keep collecting other champions
                LOG.exception("Failed %s %s", champ["name"], pos)
                failures.append({"champion": champ["name"], "position": pos.upper(), "error": str(exc)})
            delay = float(config.get("request_delay_seconds", 1.0))
            if delay > 0 and index < len(tasks):
                time.sleep(delay)

    # Write empty aggregates too: failed/incomplete runs must not leave old data published as current.
    write_json(current_dir / "champions.json", records)
    write_csvs(records, current_dir)
    metadata = {
        "data_dragon_patch": patch,
        "asset_manifest": "static-assets.json",
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "requested_records": len(tasks),
        "successful_records": len(records),
        "failed_records": len(failures),
        "positions": [p.upper() for p in positions],
        "build_rank_filter": (
            config.get("tier", "emerald_plus")
            if any(k in tool.get("inputSchema", {}).get("properties", {}) for k in ("tier", "rank", "rank_tier"))
            else "provider default (live tool schema exposes no rank filter)"
        ),
        "source": "OP.GG MCP",
        "source_url": "https://op.gg",
        "failures": failures,
    }
    write_json(current_dir / "metadata.json", metadata)
    write_json(current_dir / "failures.json", failures)

    if config.get("include_opggpy_aggregate_stats", True):
        try:
            collect_opggpy_stats(config, root, patch)
            metadata["opggpy_aggregate_stats"] = "collected"
        except Exception as exc:
            LOG.warning("OPGG.py aggregate stats not collected: %s", exc)
            metadata["opggpy_aggregate_stats"] = f"unavailable: {exc}"
        write_json(current_dir / "metadata.json", metadata)

    if config.get("archive_snapshots", True) and records:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        archive = root / "archive" / f"ddragon-{patch}-{stamp}"
        archive.mkdir(parents=True, exist_ok=True)
        for snapshot_file in current_dir.iterdir():
            if snapshot_file.is_file():
                shutil.copy2(snapshot_file, archive / snapshot_file.name)
    return metadata


def collect_opggpy_stats(config: dict[str, Any], root: Path, patch: str) -> None:
    """Optional OPGG.py aggregate stats export; this endpoint is not a build endpoint."""
    from opgg.opgg import OPGG
    from opgg.params import Queue, StatsRegion, Tier

    tier_name = str(config.get("tier", "emerald_plus")).upper()
    tier = getattr(Tier, tier_name, Tier.EMERALD_PLUS)
    async def fetch_stats():
        async with OPGG() as client:
            return await client.get_champion_stats_async(tier=tier, region=StatsRegion.GLOBAL, queue_type=Queue.SOLO)

    stats = asyncio.run(fetch_stats())
    write_json(root / "current" / "opggpy-aggregate-stats.json", {
        "patch_requested": patch,
        "tier": tier.value,
        "region": "global",
        "queue": "solo ranked",
        "source": "OPGG.py / OP.GG Champion API",
        "source_url": "https://op.gg",
        "data": stats,
    })
