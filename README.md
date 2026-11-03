# LoLphabet

**The League of Legends A–Z Challenge tracker.** Work through the champion roster alphabetically, win a game with every champion, and keep track of it all in one place.

Live site: **https://lolphabet.app**

![LoLphabet Next Up banner](docs/next-up.png)

## What it does

- **Role lists and custom lists.** Top, Jungle, Mid, Bot and Support lists, plus your own custom champion lists.
- **Six challenge modes.**
  - **Classic**: alphabetical, any order.
  - **Random**: a fixed shuffled order.
  - **Hard**: only the next champion can be played, and a loss sends you back **one** champion.
  - **Random + Hard**: the same rule on a shuffled order.
  - **Insanity**: a loss sends you back to the start of the run.
  - **Random + Insanity**: shuffled order, restart on loss.
- **Next Up banner** with pick rate, win rate and sample size, plus a suggested build:
  - summoner spells (Flash on the right by default, with a swap button),
  - skill order,
  - items in a single row (starting, boots, core, situational),
  - a collapsible rune page that highlights the recommended runes and shards.
- **Picked / Banned** button to set a champion aside without counting a loss.
- Progress stats, editable win dates and notes, search and filters, and a share-image button.
- Google sign-in so progress syncs between devices. No ads.

## How it's built

There are two small parts:

| Folder | What it is |
| --- | --- |
| [`lol-az-tracker/`](lol-az-tracker) | The web app: a dependency-free Node server (`server.js`) and a single-file front end (`index.html`). |
| [`lol-meta-collector/`](lol-meta-collector) | A Python/Docker job that collects suggested builds from OP.GG and rune/item data from Riot's Data Dragon on a weekly schedule. No Riot API key needed. |

The collector writes JSON/CSV files, and the tracker reads them from a read-only mounted folder. The tracker works without the collector. You just won't get builds in the Next Up banner.

## Running it yourself

You need Docker with Compose. (Or just Node 18+ for the tracker on its own.)

### 1. The tracker

```bash
cd lol-az-tracker
cp docker-compose.example.yml docker-compose.yml
# edit docker-compose.yml: set GOOGLE_CLIENT_ID, SITE_URL and CONTACT_EMAIL
docker compose up -d
```

It listens on `127.0.0.1:3081`, so put a reverse proxy (Caddy, Nginx, Cloudflare Tunnel and so on) in front of it for public access. Without Docker:

```bash
cd lol-az-tracker/app
GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com node server.js
```

The server has no npm dependencies. Without a `GOOGLE_CLIENT_ID` it still runs, but sign-in is disabled and progress stays in the browser.

#### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3081` | Port to listen on. |
| `GOOGLE_CLIENT_ID` | none | OAuth client ID for Google sign-in. |
| `DATA_FILE` | `data.json` next to `server.js` | Where accounts and progress are stored. Keep it on a volume and back it up. |
| `SITE_URL` | derived from the request | Public URL, used for canonical links and metadata. |
| `CONTACT_EMAIL` | none | Contact address shown on the privacy and terms pages. |
| `COLLECTOR_DIR` | `/collector` | Folder the collector writes to (contains `current/` and `archive/`). Mount it read-only. |
| `COLLECTOR_DATA_DIR` | `../lol-meta-collector/data` | Compose-only: the host folder that is shared between the collector and the tracker. |
| `BUILD_STALE_DAYS` | `14` | After this many days, build data is flagged as stale. |
| `ROLES_URL` | Meraki Analytics champion data | Source for the role lists. |

To get a Google client ID, create an OAuth client in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) and add your site's URL as an authorised JavaScript origin.

### 2. The build collector (optional)

The collector fetches suggested builds and writes them to a shared folder that the tracker reads. It's only needed for the builds in the Next Up banner.

```bash
cd lol-meta-collector
cp docker-compose.example.yml docker-compose.yml
docker compose build
# Check the live OP.GG schema and test a single champion first
docker compose run --rm --entrypoint python lol-meta-collector -m lolmeta inspect
docker compose run --rm --entrypoint python lol-meta-collector -m lolmeta probe --champion Ahri --position mid
# Then start the weekly scheduler (it runs one collection immediately)
docker compose up -d
```

Both compose files point at the same data folder by default, so the tracker picks up the results automatically. The collector's own [README](lol-meta-collector/README.md) covers configuration, output files and the OP.GG attribution notes.

## Data and privacy

User data (Google account ID, name, progress) is stored in a single JSON file on the server you run. Nothing is sent anywhere else. The hosted version at lolphabet.app has its own privacy policy, which is served by the app at `/privacy`.

## Contributing

Issues and pull requests are welcome. Bug reports are especially useful if they include the champion, role and challenge mode involved. Feature ideas are welcome too, since most of the features here started as someone saying "wouldn't it be cool if...".

## Credits and disclaimers

- Built by [PaladinLaw](https://github.com/PaladinLaw), with a lot of help from [Claude](https://claude.ai) writing the code.
- Champion data and icons come from [Riot Games' Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon) and [CommunityDragon](https://communitydragon.org). Suggested builds and statistics come from [OP.GG](https://op.gg).
- LoLphabet isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc. LoLphabet isn't affiliated with OP.GG.

## License

MIT. See [LICENSE](LICENSE).
