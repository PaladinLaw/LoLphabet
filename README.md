# LoLphabet

**The League of Legends A-Z Challenge tracker.** Win a game with every champion on a list, by role, class, region, race or your own custom list, and keep track of it all in one place.

Live site: **[https://lolphabet.app](https://lolphabet.app)**

![LoLphabet Next Up banner](docs/next-up.png)

## What it does

- **Lists.** In this order: **All champs**, **Roles** (Top, Jungle, Mid, Bot / ADC, Support), **Classes**, **Regions**, **Races**, and your own **Custom lists**, which can be shared. Pick a list type, then a list within it.
- **Four challenge modes.** Every list can be played in any mode, and each mode keeps its own progress.
  - **Classic:** alphabetical order. Skip a banned or taken champion with the picked / banned button
  - **Hard:** only the next champion can be played, and a loss sends you back **one** champion.
  - **Insanity:** only the next champion can be played, and a loss sends you back to the **start of the run**.
  - **Nuzlocke:** play any champion on the list, any number of times. Each **Victory** is counted but never completes a champion. A loss (**Fallen**, with a confirmation) kills that champion permanently: it is greyed out and can't be selected or edited. The list is complete when the last champion has fallen. Progress shows champions fallen, filters are All / Alive / Fallen, and it has its own stats and share image.
  - The old Random, Random + Hard and Random + Insanity modes have been removed.
- **Dice Roll.** Sits between the mode menu and Stats. It picks a random role, then a random champion from that role, with a short shuffle animation. Closing the popup opens a **Roll page** showing only that champion and position in the Next Up banner with its pick rate, win rate, summoners, level-up order, items and runes. It never touches any list or progress.
- **Next Up banner** with pick rate, win rate and sample size, plus a suggested build:
  - summoner spells (Flash on the right by default, with a swap button),
  - skill order,
  - two item rows: **Starting Items** (starting items followed by a labelled **Boots:** group) and **Items** (core items, then situational),
  - a larger rune panel that highlights the recommended runes and shards. It sizes itself to its content (the banner grows if needed) and is shown on screens 760px wide and up.
- **Stats page** with a summary across all lists, a "By list" table and a detailed single-list view. A **mode toggle** (Classic, Hard, Insanity, Nuzlocke) lets you view any mode's stats without changing the mode you're playing, and a two-step list picker (list type, then list) follows the same order as the main page.
- **How it works panel** that explains the selected mode. It opens by itself the first time you see each mode, then remembers your open or closed choice per mode. It can be turned off under **Settings > Preferences > Help**.
- **Settings** in three tabs: **Account** (profile, sign-in methods, sharing, delete account), **Preferences** (theme, custom lists, help) and **Data** (export, import, reset all progress).
- **Several ways to sign in** so progress syncs between devices: Google, Discord, username and password, or an emailed magic link. Choose which ones to offer with `LOGIN_TYPES`. Accounts can be linked to each other from Settings.
- Editable win dates and notes, search and filters, read-only share links with a preview image, and a share-image button. No ads, no third-party analytics.

> The How it works state and the theme are stored per browser in local storage, so they do not sync between devices.

## How it's built

LoLphabet consists of two components:

| Folder | Purpose |
| --- | --- |
| [`lol-az-tracker/`](lol-az-tracker) | The web app: a dependency-free Node server (`server.js`, plus `auth-server.js` for the login methods) and a front end (`index.html` with its JS and CSS under `assets/`). |
| [`lol-meta-collector/`](lol-meta-collector) | An optional Python/Docker pipeline that collects champion analysis and suggested builds from OP.GG and resolves game assets against Riot Data Dragon. |

The collector writes JSON and CSV files to a shared data directory. The tracker mounts that directory read-only and uses the generated data for the Next Up build display. The tracker works without the collector; builds simply won't be available in the Next Up banner.

## Deployment with Docker Compose

Both services have a `docker-compose.yml` that can be deployed independently. The Compose files are suitable for a public Git repository: host-specific paths and deployment settings are configurable through environment variables rather than being hard-coded into the files.

### 1. LoLphabet tracker

The tracker listens on `127.0.0.1:3081` by default. Put a reverse proxy (Caddy, Nginx, Cloudflare Tunnel, etc.) in front of it for public access.

For a manual deployment:

```bash
cd lol-az-tracker
docker compose up -d
```

The supplied Compose file needs a local `.env` file (copy `.env.example`). The variables marked required in the table below must be set, plus the settings for each login method you turn on (see [Login methods](#login-methods)). Do not commit a `.env` file containing private deployment settings.

Without Docker, the server can be run directly with Node 18+:

```bash
cd lol-az-tracker/app
LOGIN_TYPES=Google GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com node server.js
```

The server has no npm dependencies. It refuses to start, with a clear message, if an enabled login method is missing its settings. If `LOGIN_TYPES` is unset and there is no `GOOGLE_CLIENT_ID`, no login is offered and progress stays in the browser. (The supplied Compose file defaults `LOGIN_TYPES` to `Google`.)

#### Upgrading from the single-login version

- `LOGIN_TYPES` defaults to `Google`, so existing setups keep working and existing Google accounts migrate automatically.
- Deploy the whole `app/` folder: `auth-server.js` is new and the front end now loads many files from `assets/`.
- Progress from the removed Random modes is no longer shown.

### 2. LoL Meta Collector (optional)

The collector fetches suggested builds and writes them to the shared data directory. It is only needed for the builds shown in the Next Up banner.

Before starting the collector, ensure that its private `config.json` exists at the configured host path. The default is `/opt/docker/lol-meta-collector/config.json`.

Build the image and verify the live OP.GG MCP schema and a single champion/role before starting the scheduler:

```bash
cd lol-meta-collector
docker compose build
docker compose run --rm --entrypoint python lol-meta-collector -m lolmeta inspect
docker compose run --rm --entrypoint python lol-meta-collector -m lolmeta probe --champion Ahri --position mid
```

If the probe succeeds, start the weekly scheduler:

```bash
docker compose up -d
```

The scheduler performs one collection immediately on first startup, then runs approximately every seven days at 03:15 Africa/Johannesburg time. Its last-run date is persisted in `data/scheduler-last-run.txt`, so container restarts do not normally trigger duplicate weekly runs.

To run a collection manually:

```bash
docker compose run --rm lol-meta-collector python -m lolmeta collect
```

To collect only one champion/role:

```bash
docker compose run --rm lol-meta-collector python -m lolmeta collect --champion Ahri --position mid
```

### 3. Dockhand deployment

For Dockhand Git stacks:

1. Create a Git stack pointing to the LoLphabet repository.
2. Set its Compose file path to `lol-az-tracker/docker-compose.yml`.
3. Configure the tracker variables listed below in that stack's environment settings, including the settings for every login method in `LOGIN_TYPES`.
4. Create a second Git stack using `lol-meta-collector/docker-compose.yml`.
5. Configure the collector variables listed below in that stack's environment settings.
6. Ensure `COLLECTOR_DATA_DIR` has exactly the same value in both stacks.
7. Deploy the collector and tracker.

The collector's `build: .` expects the Compose file to be in the same directory as its `Dockerfile`, as it is in this repository.

#### Tracker environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `CONTAINER_NAME` | **Yes** | Docker container name. |
| `APP_PORT` | **Yes** | Port the Node application listens on inside the container. |
| `BIND_IP` | **Yes** | Host IP on which the tracker port is published. Keep this at loopback when a reverse proxy runs on the same host. |
| `HOST_PORT` | **Yes** | Host-side published port. |
| `SITE_URL` | **Yes** | Public site URL used for canonical links, metadata, share links and the Discord redirect. |
| `TRACKER_APP_DIR` | **Yes** | Host directory containing `index.html`, `server.js`, `auth-server.js` and `assets/`. |
| `TRACKER_DATA_DIR` | **Yes** | Persistent host directory for accounts and progress. Back this directory up. |
| `COLLECTOR_DATA_DIR` | **Yes** | Shared host directory containing collector output. Must match the collector stack's value. |
| `LOGIN_TYPES` | No | Which login methods to offer (see below). Default `Google`. |
| `GOOGLE_CLIENT_ID` | When Google is enabled | Google OAuth client ID used for sign-in. |
| `DISCORD_CLIENT_ID` | When Discord is enabled | Discord application client ID. |
| `DISCORD_CLIENT_SECRET` | When Discord is enabled | Discord application client secret. |
| `RESEND_API_KEY` | When Password or Magic link is enabled | Resend API key used to send email. |
| `MAIL_FROM` | When Password or Magic link is enabled | Sender, e.g. `LoLphabet <login@lolphabet.app>`. Must be on a domain verified in Resend. |
| `MAIL_DAILY_LIMIT` | No | Emails per day before sending stops. Default `90`, to stay under Resend's free 100 a day. |
| `CONTACT_EMAIL` | No | Contact address shown on the privacy and terms pages, and the default reply-to for email. |

The Compose file sets these application environment variables internally:

| Variable | Value | Purpose |
| --- | --- | --- |
| `DATA_FILE` | `/data/data.json` | Location of account and progress data inside the container. |
| `PORT` | `APP_PORT` | Port the server listens on. |
| `COLLECTOR_DIR` | `/collector` | Read-only collector output mount inside the container. |

Other application settings read by the tracker (not passed through by the supplied Compose file; add them under `environment:` if you need them):

| Variable | Default | Purpose |
| --- | --- | --- |
| `BUILD_STALE_DAYS` | `14` | After this many days, build data is flagged as stale. |
| `ROLES_URL` | Meraki Analytics champion data | Source for the role lists. |
| `MAIL_REPLY_TO` | `CONTACT_EMAIL` | Reply-to address on emails. |

#### Login methods

`LOGIN_TYPES` is a comma-separated list of any of `Google`, `Discord`, `Password` (also written `Username and password` or `Email`) and `Magic link`, for example `LOGIN_TYPES="Google, Magic link, Password, Discord"`. The order sets the button order within each group. In the login window, Google and Discord sit above an "or use your email" divider, with the magic link and password options below it. The default is Google only. If an enabled method is missing its settings, the server refuses to start and says which ones.

- **Google:** needs `GOOGLE_CLIENT_ID`.
- **Discord:** standard OAuth. Needs `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `SITE_URL`. In the Discord developer portal, register the redirect `<SITE_URL>/auth/discord/callback`.
- **Email (Resend):** used for magic links, signup confirmation and password resets. Needs `RESEND_API_KEY`, `MAIL_FROM` and a domain verified in Resend. The app stops sending once `MAIL_DAILY_LIMIT` is reached for the day.
- **Username and password:** signup needs a username, email and password. The email is confirmed by a link before the account exists. The username doubles as the display name, and login accepts the username or the email. Passwords are stored only as salted scrypt hashes.
- **Magic link:** takes an email plus a username and creates an account on first use.

Safety features: email links carry their token after a `#` so scanners can't use them up, and each works once; logins and emails are rate limited; unknown emails get the same response as known ones; a password reset signs out other devices.

**Account linking.** From Settings you can link any other enabled login method to your account. Signing in with a provider whose verified email matches an existing account joins that account instead of creating a duplicate. If a login already belongs to another account, you choose which progress to keep, and the other account is merged in and deleted.

To get a Google client ID, create an OAuth client in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) and add your site's URL as an authorised JavaScript origin.

#### Collector environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `COLLECTOR_CONTAINER_NAME` | No | - | Docker container name. |
| `COLLECTOR_DATA_DIR` | No | - | Host directory where the collector writes output. Must match the tracker stack's value. |
| `COLLECTOR_LOG_DIR` | No | - | Host directory mounted for collector logs. |
| `COLLECTOR_CONFIG_FILE` | No | - | Host path to the private, read-only collector configuration file. |
| `COLLECTION_INTERVAL_DAYS` | No | `7` | Scheduler interval in days. |
| `TZ` | No | `Africa/Johannesburg` | Time zone used by the scheduler. |

Dockhand supplies these variables to Compose when deploying each stack. Variables are configured per stack, so add `COLLECTOR_DATA_DIR` to both stacks and keep the values identical. The tracker's Compose file requires the variables marked **Yes** above; the collector's variables all have defaults.

Do not commit private `.env` files, collector `config.json`, account/progress data, logs, or generated collector output to the public repository. The collector's Compose file contains defaults for a typical deployment, but you can override them in Dockhand for your host.

### Running without Dockhand

For a local/manual Compose deployment, create a local `.env` file in the relevant Compose directory or export the variables in your shell. Keep that file out of Git. For example, a tracker `.env` for Google plus magic-link and password sign-in:

```dotenv
CONTAINER_NAME=lol-tracker
APP_PORT=3081
BIND_IP=127.0.0.1
HOST_PORT=3081
SITE_URL=https://lolphabet.app
TRACKER_APP_DIR=/path/to/app
TRACKER_DATA_DIR=/path/to/data
COLLECTOR_DATA_DIR=/path/to/collector-data

LOGIN_TYPES="Google, Magic link, Password"
GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com
RESEND_API_KEY=re_xxxxxxxxxxxxxxxx
MAIL_FROM="LoLphabet <login@lolphabet.app>"
```

`.env.example` in `lol-az-tracker/` documents every setting.

## LoL Meta Collector

### Data source and API behaviour

The collector is a Python/Docker pipeline that collects League of Legends champion analysis/build data from OP.GG's **published OP.GG MCP server**, resolves game assets against Riot Data Dragon, and writes frontend-ready JSON plus flat CSV exports.

What is verified:

- [`OPGG.py`](https://github.com/ShoobyDoo/OPGG.py) exposes `get_champion_stats()` / `get_champion_stats_async()`. Its docstring says this returns aggregate ranked champion statistics (win/pick/ban etc.). Its implementation calls the `/champions/ranked` endpoint and returns the response's `data` object. It does **not** document a champion-build endpoint. See its [`opgg/opgg.py` source](https://github.com/ShoobyDoo/OPGG.py).
- OP.GG's official [MCP server](https://github.com/opgginc/opgg-mcp) documents `lol_get_champion_analysis` as returning champion win/pick/ban stats, optimal builds, items, runes, skills and spells. It documents the Streamable HTTP endpoint `https://mcp-api.op.gg/mcp`.
- The MCP server's published README does not document a bulk-export API, tier/rank filter, patch parameter, or rate limit. The collector therefore discovers the live tool schema at runtime and only sends arguments accepted by that schema. It does not claim to filter by Emerald+ unless the live schema supports it.

Run `inspect` and `probe` on your own server before starting a full collection. The collector saves the live tool schema and raw payloads so unsupported or changed fields are visible rather than silently fabricated.

### Requirements

- Docker (recommended), or Python 3.12+.
- Outbound HTTPS access to `mcp-api.op.gg` and `ddragon.leagueoflegends.com`.
- No Riot API key is required for the OP.GG MCP data path.

### Local Python setup

```bash
python3.12 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python -m lolmeta inspect
python -m lolmeta probe --champion Ahri --position mid
python -m lolmeta collect --champion Ahri --position mid
python -m lolmeta collect
```

### Collector configuration

The collector reads `config.json`. Keep this file on the host and do not commit it if it contains deployment-specific settings.

| Setting | Purpose |
| --- | --- |
| `positions` | Positions to collect: `top`, `jungle`, `mid`, `adc`, `support`. |
| `game_mode` | Requested game mode. The live MCP schema is checked and enum values are matched before calls. |
| `language` | Language, normally `en_US`. |
| `request_delay_seconds` | Delay between calls (default `0.5` seconds); increase it if OP.GG starts rate-limiting requests. |
| `tier` | Rank filter sent to the live MCP analysis tool when its schema exposes `tier` (default in this package: `all`). |
| `region` | Region for the separate OPGG.py aggregate statistics endpoint (default in this package: `EUW`). The verified OPGG.py implementation accepts `EUW` as a region string even though its `StatsRegion` enum only defines `GLOBAL`. |
| `include_opggpy_aggregate_stats` | Also call OPGG.py's aggregate stats endpoint, separately from the build data. |
| `archive_snapshots` | Retain timestamped snapshots. |

The MCP build-analysis tool supports an all-ranks tier request. Its currently inspected schema has no region argument, so build data is not labelled as EUW-specific. The OPGG.py aggregate statistics export is configured separately for EUW + all ranks.

Important: OPGG.py's documented aggregate stats API has tier/queue/version controls but returns champion statistics, not build runes/items/skill order. The complete build payload is requested from OP.GG's official MCP `lol_get_champion_analysis` tool.

### Collector output

```text
data/
├── cache/                          # Cached Data Dragon champion roster
├── current/
│   ├── champions.json              # Complete raw + projected records
│   ├── champion_builds.csv         # Flat champion/role/statistics export
│   ├── metadata.json               # Patch, collection timestamp, counts, failures
│   ├── failures.json               # Per-champion/role errors
│   ├── mcp-tool-schema.json        # Live input schema for champion analysis
│   ├── opggpy-aggregate-stats.json # Optional aggregate stats from OPGG.py
│   └── champions/<champion>-<role>.json
└── archive/<patch>-<timestamp>/    # Historical snapshots
```

Each per-champion JSON record contains:

- Champion name, Data Dragon ID/key, position and the same patch value in `patch` and `data_dragon_patch`. The tested OP.GG response did not include its analytics patch, so this is explicitly the Data Dragon asset patch, not a claim about OP.GG's independent data window.
- Normalized champion statistics (`win_rate`, `pick_rate`, `ban_rate` as percentages; `games` from OP.GG `summary.average_stats.play`; tier).
- A structured `build` object with `starting_items`, `core_items` (boots and core items), `situational_items`, `summoner_spells`, `runes`, and the 15-level `skill_order`.
- `skill_max_order` and `skill_max_order_label`, calculated from the full 15-level order by counting Q/W/E allocations (ultimate R excluded). This is distinct from the first three starting points. For example, Q5/E5/W3 produces `Q → E → W`.
- `skill_order_sample_size`, `skill_order_pick_rate`, and `skill_order_win_rate` from the most-played `skill_masteries.builds[]` entry when available; otherwise the collector falls back to `skills.order`.
- Data Dragon item, spell, rune, style and champion image URLs; stat-shard labels are mapped by ID and their icons use CommunityDragon's stat-mod assets.
- `provider_payload`, containing the complete decoded OP.GG response for traceability.

The collector selects one build only: for item alternatives in a slot it chooses the group with the largest `play` sample count. For skill order, it selects the `skill_masteries.builds[]` sequence with the largest `play` count when available, then derives the Q/W/E max priority from the full sequence. It does not export alternative skill-maxing builds. Situational item slots are represented as the most-played choice for each available slot (`fourth`, `fifth`, `sixth`, `last`).

Win rates for item, spell, rune and skill components are calculated as `win / play * 100`, using that component's own sample denominator. They are not calculated against the champion-wide games count. CSV component exports use the same percentage convention for records produced by the current normalizer.

Validation is strict. A champion/position record is rejected if required aggregate stats, resolved items/spells/runes, three stat shards, or a complete 15-level skill order are missing or unresolved. Failed records are listed in `failures.json`; the current aggregate JSON/CSV files are rewritten on every run (including empty outputs) so a failed run cannot leave yesterday's data masquerading as current. Partial successful collections publish only validated records.

### Additional CSV and static asset exports

The collector also emits `items.csv`, `runes.csv`, `spells.csv`, and `skill_orders.csv`. These are generated only when the MCP response contains recognisable component fields. Each row includes `source_field` and `raw_entry_json` so you can inspect the exact upstream object. If one of these CSVs contains only a header, the live response did not expose a matching field name; inspect that champion's JSON and the saved tool schema before changing the field mapper.

The static asset manifest includes champion, item, summoner-spell, rune/style and stat-shard ID-to-name/image maps. A frontend can load `static-assets.json` once per patch. Summoner spell and rune/shard IDs are also resolved into display-ready names and image URLs inside each champion's `build` object.

### MCP protocol notes

The client uses MCP Streamable HTTP (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`) and discovers the current input schema. It does not scrape rendered HTML. The tool schema is written to `data/mcp-tool-schema.json`.

If OP.GG changes or removes the public endpoint/tool, `inspect` will show that and collection will fail clearly. There is no attempt to bypass authentication, bot protection, or rate limits.

### Attribution and usage

OP.GG is the source of build/statistics data. Keep a visible OP.GG attribution/link anywhere the exported data is displayed. This project is not affiliated with OP.GG or Riot Games. The public MCP endpoint's existence and repository licence do not by themselves grant blanket rights to redistribute OP.GG data; confirm your intended public/commercial use with OP.GG. Respect any usage instructions and rate limits they provide.

Data Dragon assets are patch-versioned. Cache assets/data locally or on your own CDN rather than hotlinking every request indefinitely. Follow Riot's current third-party product policies and include the required Riot disclaimer if your app is player-facing.

## Data and privacy

User data (login identifiers, name, email, password hashes if password login is enabled, and progress) is stored in a single JSON file on the server you run. The only outside services involved are the ones you enable: Google or Discord for sign-in, and Resend for sending login emails (which receives the recipient's email address). There are no ads and no third-party analytics. How it works, the theme and similar preferences are kept in the browser's local storage and do not sync between devices. The hosted version at `lolphabet.app` has its own privacy policy, served by the app at `/privacy`.

Keep the tracker's persistent data directory backed up. The collector's `config.json`, logs, generated data and archive snapshots are deployment/runtime files and should not be committed to the public repository.

## Contributing

Issues and pull requests are welcome. Bug reports are especially useful if they include the champion, role and challenge mode involved. Feature ideas are welcome too, since most of the features here started as someone saying "wouldn't it be cool if...".

## Credits and disclaimers

- Built by [PaladinLaw](https://github.com/PaladinLaw), with a lot of help from [Claude](https://claude.ai) writing the code.
- Champion data and icons come from [Riot Games' Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon) and [CommunityDragon](https://communitydragon.org). Suggested builds and statistics come from [OP.GG](https://op.gg).
- LoLphabet isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc. LoLphabet isn't affiliated with OP.GG.

## License

MIT. See [LICENSE](LICENSE).
