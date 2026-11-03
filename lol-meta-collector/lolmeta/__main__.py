from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from .collector import collect
from .mcp import OPGGMCPClient


def load_config(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def command_inspect(config: dict) -> int:
    with OPGGMCPClient(config["mcp_url"], config.get("request_timeout_seconds", 45), config.get("max_retries", 3)) as client:
        for name, tool in sorted(client.tools.items()):
            if name in {"lol_get_champion_analysis", "lol_list_champions", "lol_list_lane_meta_champions"}:
                print(json.dumps(tool, indent=2, ensure_ascii=False))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect League of Legends champion meta builds from OP.GG.")
    parser.add_argument("command", choices=["collect", "probe", "inspect", "schedule"])
    parser.add_argument("--config", default="config.json")
    parser.add_argument("--champion", help="Only collect one champion, e.g. Ahri")
    parser.add_argument("--position", choices=["top", "jungle", "mid", "adc", "support"])
    parser.add_argument("--limit", type=int, help="Limit the number of champion/position combinations")
    parser.add_argument("--interval-days", type=int, default=7, help="Schedule interval in days")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    config = load_config(args.config)

    if args.command == "inspect":
        return command_inspect(config)
    if args.command == "probe":
        result = collect(config, champion_filter=args.champion or "Ahri", position_filter=args.position or "mid", limit=1, probe=True)
        print(json.dumps(result, indent=2))
        return 0 if result["successful_records"] else 1
    if args.command == "collect":
        result = collect(config, args.champion, args.position, args.limit)
        print(json.dumps(result, indent=2))
        return 0 if result["successful_records"] else 1

    # Long-running scheduler. Default is weekly, at 03:15 Africa/Johannesburg.
    tz = ZoneInfo("Africa/Johannesburg")
    state_file = Path(config.get("output_dir", "data")) / "scheduler-last-run.txt"
    state_file.parent.mkdir(parents=True, exist_ok=True)
    last_run = None
    if state_file.exists():
        try:
            last_run = datetime.fromisoformat(state_file.read_text(encoding="utf-8").strip()).date()
        except ValueError:
            logging.warning("Ignoring invalid scheduler state file: %s", state_file)
    logging.info("Scheduler started; interval=%s days; timezone=%s", args.interval_days, tz)
    while True:
        now = datetime.now(tz)
        due = last_run is None or (now.hour == 3 and now.minute >= 15 and (now.date() - last_run).days >= args.interval_days)
        if due:
            try:
                result = collect(config)
                logging.info("Scheduled collection finished: %s", result)
                last_run = now.date()
                state_file.write_text(last_run.isoformat(), encoding="utf-8")
            except Exception:
                logging.exception("Scheduled collection failed; it will retry on the next scheduler check")
                # Do not advance last_run on failure.
        time.sleep(30)


if __name__ == "__main__":
    sys.exit(main())
