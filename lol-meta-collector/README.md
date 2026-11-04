# LoL Meta Collector

A small Python/Docker pipeline that collects League of Legends champion analysis/build data from OP.GG's **published OP.GG MCP server**, resolves game assets against Riot Data Dragon, and writes frontend-ready JSON plus flat CSV exports.

## What is verified, and what is not

The upstream repositories/documentation currently establish:

- `OPGG.py` exposes `get_champion_stats()` / `get_champion_stats_async()`. Its own docstring says this returns aggregate ranked champion statistics (win/pick/ban etc.). Its implementation calls the `/champions/ranked` endpoint and returns the response's `data` object. It does **not** document a champion-build endpoint. See https://github.com/ShoobyDoo/OPGG.py and its `opgg/opgg.py` source.
- OP.GG's official MCP server documents `lol_get_champion_analysis` as returning champion win/pick/ban stats, optimal builds, items, runes, skills and spells. It documents the Streamable HTTP endpoint `https://mcp-api.op.gg/mcp`. See https://github.com/opgginc/opgg-mcp.
- The MCP server's published README does not document a bulk-export API, tier/rank filter, patch parameter, or rate limit. The collector therefore discovers the live tool schema at runtime and only sends arguments accepted by that schema. It does not claim to filter by Emerald+ unless the live schema supports it.

Run inspect and probe on your own server before starting a full collection. The collector saves the live tool schema and raw payloads so unsupported or changed fields are visible rather than silently fabricated.

## Requirements

- Docker (recommended), or Python 3.12+
- Outbound HTTPS access to `mcp-api.op.gg` and `ddragon.leagueoflegends.com`
- No Riot API key is required for the OP.GG MCP data path.

## Quick start with Docker

```bash
docker compose build
# First, inspect the live MCP schema and verify a single champion/role
docker compose run --rm --entrypoint python lol-meta-collector -m lolmeta inspect
docker compose run --rm --entrypoint python lol-meta-collector -m lolmeta probe --champion Ahri --position mid
# If the probe succeeds, run the full collection
docker compose run --rm --entrypoint python lol-meta-collector -m lolmeta collect
```

Start the weekly scheduler:

```bash
docker compose up -d
```

The scheduler runs at approximately 03:15 Africa/Johannesburg every seven days. To run once manually:

```bash
docker compose run --rm lol-meta-collector python -m lolmeta collect
```

## Local Python

```bash
python3.12 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python -m lolmeta inspect
python -m lolmeta probe --champion Ahri --position mid
python -m lolmeta collect --champion Ahri --position mid
python -m lolmeta collect
```

## Configuration

Edit `config.json`:

- `positions`: `top`, `jungle`, `mid`, `adc`, `support`
- `game_mode`: requested mode; the live MCP schema is checked and enum values are matched before calls
- `language`: normally `en_US`
- `request_delay_seconds`: throttle between calls (default 0.5 seconds); increase it if OP.GG starts rate-limiting requests
- `tier`: rank filter sent to the live MCP analysis tool when its schema exposes `tier` (default in this package: `all`)
- `region`: region for the separate OPGG.py aggregate statistics endpoint (default in this package: `EUW`). The verified OPGG.py implementation accepts `EUW` as a region string even though its `StatsRegion` enum only defines `GLOBAL`.
- `include_opggpy_aggregate_stats`: also call OPGG.py's aggregate stats endpoint (separate from the build data)
- `archive_snapshots`: retain timestamped snapshots

The MCP build-analysis tool supports an all-ranks tier request. Its currently inspected schema has no region argument, so build data is not labelled as EUW-specific. The OPGG.py aggregate statistics export is configured separately for EUW + all ranks.

Important: OPGG.py's documented aggregate stats API has tier/queue/version controls but returns champion statistics, not build runes/items/skill order. The complete build payload is requested from OP.GG's official MCP `lol_get_champion_analysis` tool.

## Output

```text
data/
├── cache/                         # Cached Data Dragon champion roster
├── current/
│   ├── champions.json             # Complete raw + projected records
│   ├── champion_builds.csv        # Flat champion/role/statistics export
│   ├── metadata.json              # Patch, collection timestamp, counts, failures
│   ├── failures.json              # Per-champion/role errors
│   ├── mcp-tool-schema.json       # Live input schema for champion analysis
│   ├── opggpy-aggregate-stats.json # Optional aggregate stats from OPGG.py
│   └── champions/<champion>-<role>.json
└── archive/<patch>-<timestamp>/   # Historical snapshots
```

Each per-champion JSON record contains:

- champion name, Data Dragon ID/key, position and the same patch value in `patch` and `data_dragon_patch` (OP.GG's response in the tested payload did not include its analytics patch, so this is explicitly the Data Dragon asset patch, not a claim about OP.GG's independent data window)
- normalized champion statistics (`win_rate`, `pick_rate`, `ban_rate` as percentages; `games` from OP.GG `summary.average_stats.play`; tier)
- a structured `build` object with `starting_items`, `core_items` (boots and core items), `situational_items`, `summoner_spells`, `runes`, and the 15-level `skill_order`
- `skill_max_order` and `skill_max_order_label`, calculated from the full 15-level order by counting Q/W/E allocations (ultimate R excluded). This is distinct from the first three starting points. For example, Q5/E5/W3 produces `Q → E → W`.
- `skill_order_sample_size`, `skill_order_pick_rate`, and `skill_order_win_rate` from the most-played `skill_masteries.builds[]` entry when available; otherwise the collector falls back to `skills.order`
- Data Dragon item, spell, rune, style and champion image URLs; stat-shard labels are mapped by ID and their icons use CommunityDragon's stat-mod assets
- `provider_payload`, containing the complete decoded OP.GG response for traceability

The collector selects one build only: for item alternatives in a slot it chooses the group with the largest `play` sample count. For skill order, it selects the `skill_masteries.builds[]` sequence with the largest `play` count when available, then derives the Q/W/E max priority from the full sequence. It does not export alternative skill-maxing builds. Situational item slots are represented as the most-played choice for each available slot (`fourth`, `fifth`, `sixth`, `last`).

Win rates for item, spell, rune and skill components are calculated as `win / play * 100`, using that component's own sample denominator. They are not calculated against the champion-wide games count. CSV component exports use the same percentage convention for records produced by the current normalizer.

Validation is strict. A champion/position record is rejected if required aggregate stats, resolved items/spells/runes, three stat shards, or a complete 15-level skill order are missing or unresolved. Failed records are listed in `failures.json`; the current aggregate JSON/CSV files are rewritten on every run (including empty outputs) so a failed run cannot leave yesterday's data masquerading as current. Partial successful collections publish only validated records.

## MCP protocol notes

The client uses MCP Streamable HTTP (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`) and discovers the current input schema. It does not scrape rendered HTML. The tool schema is written to `data/mcp-tool-schema.json`.

If OP.GG changes or removes the public endpoint/tool, `inspect` will show that and collection will fail clearly. There is no attempt to bypass authentication, bot protection, or rate limits.

## Attribution and usage

OP.GG is the source of build/statistics data. Keep a visible OP.GG attribution/link anywhere the exported data is displayed. This project is not affiliated with OP.GG or Riot Games. The public MCP endpoint's existence and repository licence do not by themselves grant blanket rights to redistribute OP.GG data; confirm your intended public/commercial use with OP.GG. Respect any usage instructions and rate limits they provide.

Data Dragon assets are patch-versioned. Cache assets/data locally or on your own CDN rather than hotlinking every request indefinitely. Follow Riot's current third-party product policies and include the required Riot disclaimer if your app is player-facing.

### Component CSVs

The collector also emits `items.csv`, `runes.csv`, `spells.csv`, and `skill_orders.csv`. These are generated only when the MCP response contains recognisable component fields. Each row includes `source_field` and `raw_entry_json` so you can inspect the exact upstream object. If one of these CSVs contains only a header, the live response did not expose a matching field name; inspect that champion's JSON and the saved tool schema before changing the field mapper.

The static asset manifest includes champion, item, summoner-spell, rune/style and stat-shard ID-to-name/image maps. Your React app can load `static-assets.json` once per patch. Summoner spell and rune/shard IDs are also resolved into display-ready names and image URLs inside each champion's `build` object.

The scheduler performs one collection immediately on first startup, then every configured interval (default seven days) after 03:15 South African time. Its last-run date is persisted in `data/scheduler-last-run.txt`, so container restarts do not normally trigger duplicate weekly runs.
