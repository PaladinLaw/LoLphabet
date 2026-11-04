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
    """Write JSON atomically so an interrupted collection cannot truncate a published file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def _record_key(record: dict[str, Any]) -> tuple[str, str]:
    return (str(record.get("champion_id") or record.get("champion") or "").casefold(),
            str(record.get("position") or "").casefold())


def _load_existing_records(current_dir: Path, archive_dir: Path, patch: str) -> dict[tuple[str, str], dict[str, Any]]:
    """Load current records and same-patch archived records, preferring current over archives."""
    existing: dict[tuple[str, str], dict[str, Any]] = {}

    def add_records(payload: Any, source: str) -> None:
        if not isinstance(payload, list):
            return
        for record in payload:
            if not isinstance(record, dict) or not record.get("champion") or not record.get("position"):
                continue
            key = _record_key(record)
            if key[0] and key[1] and record.get("patch") == patch and key not in existing:
                existing[key] = record

    # The aggregate is useful when per-champion files were removed by an older collector.
    aggregate = current_dir / "champions.json"
    if aggregate.exists():
        try:
            add_records(read_json(aggregate), "current aggregate")
        except Exception as exc:
            LOG.warning("Could not read existing aggregate %s: %s", aggregate, exc)

    champions_dir = current_dir / "champions"
    if champions_dir.exists():
        for path in champions_dir.glob("*.json"):
            try:
                record = read_json(path)
                if isinstance(record, dict):
                    key = _record_key(record)
                    if key[0] and key[1] and record.get("patch") == patch:
                        existing[key] = record
            except Exception as exc:
                LOG.warning("Could not read existing champion record %s: %s", path, exc)

    # Older collector versions archived champions.json at the archive root.
    if archive_dir.exists():
        for path in sorted(archive_dir.glob("*/champions.json"), reverse=True):
            try:
                add_records(read_json(path), str(path))
            except Exception as exc:
                LOG.warning("Could not read archived champion records %s: %s", path, exc)

    return existing


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


def _normalise_skill_sequence(value: Any) -> list[str]:
    """Normalise OP.GG skill orders represented as strings or level mappings."""
    if isinstance(value, str):
        return [part.strip().upper() for part in re.split(r"[>,\s]+", value) if part.strip()]
    if not isinstance(value, list):
        return []
    result = []
    for entry in value:
        if isinstance(entry, dict):
            entry = entry.get("skill") or entry.get("ability") or entry.get("name") or entry.get("key")
        if entry is not None:
            token = str(entry).strip().upper()
            if token:
                result.append(token)
    return result


def _skill_max_order(skill_order: list[str]) -> list[str]:
    """Infer max priority from the 15-level order, excluding ultimate R.

    Sort by total ranks allocated to Q/W/E, then by the level at which each
    ability reaches its final observed rank. This handles cases such as
    Q5/E5/W3 => Q, E, W rather than assuming the initial three points are max order.
    """
    basic = ("Q", "W", "E")
    counts = {skill: 0 for skill in basic}
    reach_level = {skill: 99 for skill in basic}
    for level, skill in enumerate(skill_order, 1):
        if skill in counts:
            counts[skill] += 1
            reach_level[skill] = level
    return sorted(basic, key=lambda skill: (-counts[skill], reach_level[skill], basic.index(skill)))


def _select_skill_build(data: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    """Choose the most-played full skill mastery sequence when available."""
    mastery = data.get("skill_masteries")
    builds = mastery.get("builds", []) if isinstance(mastery, dict) else []
    candidates = [b for b in builds if isinstance(b, dict) and _normalise_skill_sequence(b.get("order"))]
    if candidates:
        selected = max(candidates, key=lambda b: _safe_play_count(b.get("play")))
        return _normalise_skill_sequence(selected.get("order")), selected
    skills = data.get("skills") if isinstance(data.get("skills"), dict) else {}
    return _normalise_skill_sequence(skills.get("order")), skills


def _safe_play_count(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


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
            supplied_name = names[index] if index < len(names) else None
            name = supplied_name if supplied_name not in (None, item_id, str(item_id), "") else metadata.get("name")
            if not name:
                # OP.GG occasionally emits IDs that are not present in the current
                # Data Dragon item manifest (e.g. 3/4). Do not fabricate an item or
                # reject an otherwise usable champion build because of one entry.
                LOG.warning(
                    "Skipping unresolved OP.GG item: champion=%s position=%s field=%s id=%r ids_names=%r patch=%s",
                    data.get("champion", "unknown"), data.get("position", "unknown"),
                    field, item_id, names, patch,
                )
                continue
            try:
                numeric_id = int(item_id)
            except (TypeError, ValueError):
                LOG.warning("Skipping non-numeric OP.GG item id %r in %s", item_id, field)
                continue
            output.append({
                "id": numeric_id, "name": str(name), "image": metadata.get("image"),
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

    skill_order, selected_skill_build = _select_skill_build(data)
    skill_max_order = _skill_max_order(skill_order) if len(skill_order) >= 15 else []
    return {
        "starting_items": starters,
        "core_items": {"boots": boots, "items": core},
        "situational_items": situational,
        "summoner_spells": spells,
        "runes": runes,
        "skill_order": skill_order,
        "skill_max_order": skill_max_order,
        "skill_max_order_label": " → ".join(skill_max_order) if skill_max_order else None,
        "skill_order_sample_size": selected_skill_build.get("play"),
        "skill_order_pick_rate": _as_rate(selected_skill_build.get("pick_rate")),
        "skill_order_win_rate": _ratio(selected_skill_build.get("win"), selected_skill_build.get("play")),
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
        build = record.get("build", {})
        selected_order = build.get("skill_order", [])
        sample_size = build.get("skill_order_sample_size")
        pick_rate = build.get("skill_order_pick_rate")
        win_rate = build.get("skill_order_win_rate")
        for level, skill in enumerate(selected_order, 1):
            yield emit("selected_skill_order", level, skill, f"Level {level}: {skill}", pick_rate, win_rate,
                       {"skill": skill, "play": sample_size, "pick_rate": pick_rate, "win_rate": win_rate})
        max_order = build.get("skill_max_order", [])
        if max_order:
            yield emit("skill_max_order", 1, " -> ".join(max_order), "Max: " + " → ".join(max_order), pick_rate, win_rate,
                       {"max_order": max_order, "play": sample_size})

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
    champions_dir = current_dir / "champions"
    champions_dir.mkdir(parents=True, exist_ok=True)
    # Preserve the last good dataset. Filtered runs update only requested records;
    # failed records remain available instead of disappearing from the frontend.
    existing_records = _load_existing_records(current_dir, root / "archive", patch)
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
            raw = None
            try:
                opgg_champion = re.sub(r"(?<!^)(?=[A-Z])", "_", champ["id"]).upper()
                args = build_tool_arguments(
                    tool, opgg_champion, POSITIONS[pos],
                    config.get("game_mode", "ranked"), config.get("language", "en_US"),
                    str(config.get("tier", "all")),
                )
                result = mcp.call_tool("lol_get_champion_analysis", args)
                raw = decode_tool_result(result)
                record = normalise_record(champ, pos, patch, raw, static)
                filename = re.sub(r"[^a-z0-9_-]+", "-", champ["id"].lower())
                write_json(current_dir / "champions" / f"{filename}-{pos}.json", record)
                records.append(record)
            except Exception as exc:  # keep collecting other champions
                LOG.exception("Failed %s %s", champ["name"], pos)
                failure = {"champion": champ["name"], "position": pos.upper(), "error": str(exc)}
                failures.append(failure)
                if raw is not None:
                    debug_name = re.sub(r"[^a-z0-9_-]+", "-", champ["id"].lower())
                    debug_path = root / "debug-failures" / f"{debug_name}-{pos}.json"
                    write_json(debug_path, {
                        "champion": champ["name"], "position": pos.upper(),
                        "error": str(exc), "provider_payload": raw,
                    })
                    LOG.error("Saved failed raw provider payload to %s", debug_path)
            delay = float(config.get("request_delay_seconds", 0.5))
            if delay > 0 and index < len(tasks):
                time.sleep(delay)

    # Merge newly successful records over the last good same-patch records.
    # This also makes --champion/--position safe for targeted refreshes.
    merged = dict(existing_records)
    for record in records:
        merged[_record_key(record)] = record
    published_records = sorted(
        merged.values(),
        key=lambda r: (str(r.get("champion", "")).casefold(), str(r.get("position", "")).casefold()),
    )
    # Rebuild per-champion files from the merged dataset; no failed record is deleted.
    for record in published_records:
        filename = re.sub(r"[^a-z0-9_-]+", "-", str(record.get("champion_id", record["champion"])).lower())
        write_json(champions_dir / f"{filename}-{str(record['position']).lower()}.json", record)
    write_json(current_dir / "champions.json", published_records)
    write_csvs(published_records, current_dir)
    metadata = {
        "data_dragon_patch": patch,
        "asset_manifest": "static-assets.json",
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "requested_records": len(tasks),
        "successful_records": len(records),
        "published_records": len(published_records),
        "retained_previous_records": max(0, len(published_records) - len(records)),
        "failed_records": len(failures),
        "positions": [p.upper() for p in positions],
        "build_rank_filter": (
            config.get("tier", "all")
            if any(k in tool.get("inputSchema", {}).get("properties", {}) for k in ("tier", "rank", "rank_tier"))
            else "provider default (live tool schema exposes no rank filter)"
        ),
        "build_region": "provider default (OP.GG MCP schema exposes no region parameter)",
        "aggregate_stats_tier": config.get("tier", "all"),
        "aggregate_stats_region": config.get("region", "EUW"),
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
        shutil.copytree(current_dir, archive, dirs_exist_ok=True)
    return metadata


def collect_opggpy_stats(config: dict[str, Any], root: Path, patch: str) -> None:
    """Optional OPGG.py aggregate stats export; this endpoint is not a build endpoint."""
    from opgg.opgg import OPGG
    from opgg.params import Queue, Tier

    tier_name = str(config.get("tier", "all")).upper()
    if not hasattr(Tier, tier_name):
        raise ValueError(f"Unsupported OPGG.py tier {tier_name!r}; valid values: {[item.name.lower() for item in Tier]}")
    tier = getattr(Tier, tier_name)
    region = str(config.get("region", "EUW")).upper()
    if not region:
        raise ValueError("OPGG.py region must not be empty")
    async def fetch_stats():
        async with OPGG() as client:
            # The installed OPGG.py implementation interpolates this value into
            # its endpoint URL; EUW is verified to work although StatsRegion
            # currently only defines GLOBAL.
            return await client.get_champion_stats_async(tier=tier, region=region, queue_type=Queue.SOLO)

    stats = asyncio.run(fetch_stats())
    write_json(root / "current" / "opggpy-aggregate-stats.json", {
        "patch_requested": patch,
        "tier": tier.value,
        "region": region,
        "queue": "solo ranked",
        "source": "OPGG.py / OP.GG Champion API",
        "source_url": "https://op.gg",
        "data": stats,
    })
