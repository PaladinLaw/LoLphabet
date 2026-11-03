from __future__ import annotations

import ast
import json
import re
import time
from typing import Any

import httpx


class MCPError(RuntimeError):
    pass


class OPGGMCPClient:
    """Minimal MCP Streamable HTTP client for OP.GG's published MCP endpoint."""

    def __init__(self, url: str, timeout: float = 45.0, max_retries: int = 3):
        self.url = url
        self.client = httpx.Client(
            timeout=timeout,
            headers={
                "Accept": "application/json, text/event-stream",
                "Content-Type": "application/json",
                "User-Agent": "lol-meta-collector/1.0 (+https://op.gg attribution)",
            },
        )
        self.session_id: str | None = None
        self.max_retries = max(0, max_retries)
        self._id = 0
        self.tools: dict[str, dict[str, Any]] = {}

    def close(self) -> None:
        self.client.close()

    def __enter__(self):
        self.initialize()
        self.discover_tools()
        return self

    def __exit__(self, *_):
        self.close()

    def _next_id(self) -> int:
        self._id += 1
        return self._id

    @staticmethod
    def _parse_response(response: httpx.Response) -> dict[str, Any] | None:
        if response.status_code == 202 or not response.content:
            return None
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        if "text/event-stream" in content_type:
            events = []
            stream_text = response.text.replace("\r\n", "\n")
            for block in stream_text.split("\n\n"):
                data_lines = [line[5:].strip() for line in block.splitlines() if line.startswith("data:")]
                if data_lines:
                    raw = "\n".join(data_lines)
                    if raw and raw != "[DONE]":
                        try:
                            events.append(json.loads(raw))
                        except json.JSONDecodeError:
                            continue
            if not events:
                return None
            # MCP servers may emit progress before the final JSON-RPC response.
            return next((e for e in reversed(events) if "id" in e and ("result" in e or "error" in e)), events[-1])
        try:
            return response.json()
        except ValueError as exc:
            raise MCPError(f"MCP returned an unrecognised response: {response.text[:500]}") from exc

    def _rpc(self, method: str, params: dict[str, Any] | None = None, *, notification: bool = False):
        payload: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if not notification:
            payload["id"] = self._next_id()
        if params is not None:
            payload["params"] = params
        headers = {}
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
            headers["MCP-Protocol-Version"] = "2025-03-26"
        response = None
        for attempt in range(self.max_retries + 1):
            try:
                response = self.client.post(self.url, json=payload, headers=headers)
                if response.status_code == 429 or response.status_code >= 500:
                    if attempt < self.max_retries:
                        retry_after = response.headers.get("Retry-After")
                        try:
                            delay = min(float(retry_after), 60.0) if retry_after else min(2 ** attempt, 30)
                        except ValueError:
                            delay = min(2 ** attempt, 30)
                        time.sleep(delay)
                        continue
                break
            except httpx.TransportError:
                if attempt >= self.max_retries:
                    raise
                time.sleep(min(2 ** attempt, 30))
        assert response is not None
        sid = response.headers.get("Mcp-Session-Id")
        if sid:
            self.session_id = sid
        parsed = self._parse_response(response)
        if notification:
            return None
        if not parsed:
            raise MCPError(f"No JSON-RPC response for {method}")
        if parsed.get("error"):
            raise MCPError(f"MCP {method} error: {parsed['error']}")
        return parsed.get("result", parsed)

    def initialize(self) -> None:
        result = self._rpc(
            "initialize",
            {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "lol-meta-collector", "version": "1.0.0"},
            },
        )
        self._rpc("notifications/initialized", notification=True)

    def discover_tools(self) -> dict[str, dict[str, Any]]:
        result = self._rpc("tools/list", {})
        self.tools = {tool["name"]: tool for tool in result.get("tools", [])}
        return self.tools

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if name not in self.tools:
            self.discover_tools()
        if name not in self.tools:
            raise MCPError(f"Tool {name!r} is not exposed by the OP.GG MCP server")
        result = self._rpc("tools/call", {"name": name, "arguments": arguments})
        if result.get("isError"):
            raise MCPError(f"Tool {name} failed: {result.get('content', result)}")
        return result


def _enum_default(schema: dict[str, Any], preferred: list[str]) -> str | None:
    values = schema.get("enum")
    if not values:
        return None
    lower = {str(v).lower(): v for v in values}
    for item in preferred:
        if item.lower() in lower:
            return lower[item.lower()]
    raise MCPError(f"None of the requested values {preferred!r} are supported by the live schema enum {values!r}")


def build_tool_arguments(
    tool: dict[str, Any], champion: str, position: str, game_mode: str, language: str
) -> dict[str, Any]:
    """Build arguments from the live tool schema; do not assume undocumented keys."""
    schema = tool.get("inputSchema", {})
    properties = schema.get("properties", {})
    required = set(schema.get("required", []))
    args: dict[str, Any] = {}
    values = {
        "champion": [champion],
        "position": [position, "BOTTOM" if position.upper() == "ADC" else position, "BOT" if position.upper() == "ADC" else position, "UTILITY" if position.upper() == "SUPPORT" else position],
        "game_mode": [game_mode, "RANKED", "RANKED_SOLO_5X5", "RANKED_SOLO", "SOLO_RANKED", "ranked_solo_5x5"],
        "lang": [language, language.replace("_", "-"), "en"],
        "language": [language, language.replace("_", "-"), "en"],
        "locale": [language, language.replace("_", "-"), "en"],
        "tier": ["emerald_plus", "EMERALD_PLUS", "emerald+"],
        "rank": ["emerald_plus", "EMERALD_PLUS", "emerald+"],
        "rank_tier": ["emerald_plus", "EMERALD_PLUS", "emerald+"],
    }
    for key, candidates in values.items():
        if key in properties:
            prop = properties[key]
            args[key] = _enum_default(prop, candidates) if prop.get("enum") else candidates[0]
    if "desired_output_fields" in properties:
        # These are exact selectable paths from the live OP.GG tool schema.
        # Avoid the former ["data"] value, which is not a valid field in its
        # closed output-field set.
        args["desired_output_fields"] = [
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
        ]
    missing = required - set(args)
    if missing:
        raise MCPError(
            f"Cannot call {tool.get('name')}: required schema fields not understood: {sorted(missing)}. "
            f"Live schema: {json.dumps(schema, ensure_ascii=False)}"
        )
    return args


_MODEL_FIELDS = {
    "LolGetChampionAnalysis": ("champion", "position", "data"),
    "Data": ("summary", "core_items", "boots", "starter_items", "last_items", "fourth_items", "fifth_items", "sixth_items", "summoner_spells", "runes", "skills", "skill_masteries"),
    "Summary": ("average_stats",),
    "AverageStats": ("play", "win_rate", "pick_rate", "ban_rate", "tier"),
    "CoreItems": ("ids", "ids_names", "play", "win", "pick_rate"),
    "Runes": ("id", "primary_page_id", "primary_page_name", "primary_rune_ids", "primary_rune_names", "secondary_page_id", "secondary_page_name", "secondary_rune_ids", "secondary_rune_names", "stat_mod_ids", "stat_mod_names", "play", "win", "pick_rate"),
    "Skills": ("order", "play", "win", "pick_rate"),
    "SkillMasteries": ("builds",),
}


def _ast_value(node: ast.AST) -> Any:
    """Safely decode OP.GG's typed-model repr without evaluating provider text."""
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, (ast.List, ast.Tuple)):
        return [_ast_value(item) for item in node.elts]
    if isinstance(node, ast.Dict):
        return {_ast_value(k): _ast_value(v) for k, v in zip(node.keys, node.values)}
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        name = node.func.id
        fields = _MODEL_FIELDS.get(name)
        values = [_ast_value(arg) for arg in node.args]
        if fields:
            result = dict(zip(fields, values))
            result["_model"] = name
            return result
        # Unknown typed models are preserved as named positional values.
        return {"_model": name, "_args": values}
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -_ast_value(node.operand)
    raise ValueError(f"Unsupported value in OP.GG model response: {type(node).__name__}")


def _decode_opgg_model_repr(text: str) -> Any | None:
    marker = "LolGetChampionAnalysis("
    start = text.find(marker)
    if start < 0:
        return None
    try:
        expression = ast.parse(text[start:], mode="eval").body
        value = _ast_value(expression)
        return value if isinstance(value, dict) else None
    except (SyntaxError, ValueError, TypeError):
        return None


def decode_tool_result(result: dict[str, Any]) -> Any:
    """Decode JSON or OP.GG's typed-model text response; retain unknown text."""
    content = result.get("content", [])
    parsed: list[Any] = []
    for block in content:
        if block.get("type") == "text":
            text = block.get("text", "")
            candidates = [text]
            match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.S)
            if match:
                candidates.insert(0, match.group(1))
            decoded = None
            for candidate in candidates:
                try:
                    decoded = json.loads(candidate)
                    break
                except json.JSONDecodeError:
                    continue
            if decoded is None:
                decoded = _decode_opgg_model_repr(text)
            parsed.append(decoded if decoded is not None else {"text": text})
        else:
            parsed.append(block)
    if len(parsed) == 1:
        return parsed[0]
    return parsed
