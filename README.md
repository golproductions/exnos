# Exnos

**Live browser-state verification for AI coding agents.** Your AI says "done." Exnos is how it knows. One tool call returns the full state of the Chrome tab you're looking at: every field, every button, every console error, network requests, storage, performance -- in milliseconds. Read-only. Local. Free and open source. By [GOL Productions](https://golproductions.com).

---

## Install

```
npx @golproductions/exnos setup
```

That's it. It registers the MCP server, opens the extension folder, and tells you the one manual step (load it in Chrome). Takes 30 seconds.

<details>
<summary>Manual install</summary>

**1. Connect your agent**

Claude Code:
```
claude mcp add-json --scope user exnos '{"command":"npx","args":["@golproductions/exnos"]}'
```

Any MCP client:
```json
{ "mcpServers": { "exnos": { "command": "npx", "args": ["@golproductions/exnos"] } } }
```

**2. Load the extension**

```
npx @golproductions/exnos path
```

Open `chrome://extensions`, enable Developer mode, click Load unpacked, pick that folder. Badge reads ON when connected.
</details>

---

## What it sees

A single `exnos_verify` call returns:

- **URL, title, ready state** -- navigation facts, not assumptions
- **Every visible field** with its live value
- **Every button** with its disabled state
- **Checkboxes and radios** with checked state
- **Visible alerts** and UI warnings
- **Console errors and uncaught exceptions** captured from page load
- **Network requests** -- every fetch and XHR: URL, method, status, response body, timing. Failures surfaced first.
- **WebSocket frames** -- sent and received, last 30
- **localStorage, sessionStorage, cookies** -- live storage state
- **Performance** -- page load, TTFB, DOM ready, paint timing, long tasks, JS heap
- **Focus** -- which element has focus right now
- **Shadow DOM** -- pierces component library boundaries
- **Same-origin iframes** -- text and errors inside frames
- **App globals** -- any `window.__*` values the app sets

## Tools

| Tool | What it returns |
|------|----------------|
| `exnos_verify` | Full live state. Optional `tab` (URL/title substring) targets another tab. Optional `selector` deep-dives one element: text, visibility, computed styles, HTML. Optional `includeHidden` includes off-screen elements. |
| `exnos_tabs` | All open tabs: title, URL, active state. |
| `exnos_fetch_tabs` | Full live state from several tabs in one call. Pass `tabs` as an array of URL/title substrings; optional `selector` applies to each. |

## CLI

```
npx @golproductions/exnos setup    # configure agent + extension in one step
npx @golproductions/exnos path     # print extension folder path
npx @golproductions/exnos init     # write Exnos rule into agent rules files
npx @golproductions/exnos rules    # print the rule text
```

## Notes

- Server on `127.0.0.1:17872` (override: `EXNOS_PORT`). `GET /` returns `{"exnos":true,"extension":true|false}`.
- Extension reconnects automatically after Chrome or server restart.
- Internal pages (`chrome://`) cannot be inspected.
- Console errors are captured from `document_start`. Pages open before the extension loaded need one reload.
- Network tap intercepts fetch and XHR at `document_start`. Requests made before the extension loaded are not captured.
- Two agents can share one Chrome: if port 17872 is already taken by another Exnos instance, a second instance proxies through the first automatically.

## Privacy

Exnos sends nothing to GOL Productions. There is no account, no telemetry, no licence check, no server of ours involved. Traffic goes from the extension to `127.0.0.1` and no further.

Worth knowing where it goes next, though: Exnos hands browser state to your MCP client, and that client is usually an AI agent that forwards what it receives to its model provider. Cookies, storage, and network response bodies are in scope for `exnos_verify`, and those can carry session tokens. So while nothing reaches us, **what you expose to Exnos can leave your machine through your AI tool**, under that provider's terms.

Point it at what you're debugging, not at your banking tab.

## License

Free and open source. See [LICENSE](./LICENSE). The names "Exnos" and "GOL Productions" are trademarks of GOL Productions. Forks must use a different name.

## GOL Productions

Exnos is part of the [GOL Productions](https://golproductions.com) toolchain. See also [Check](https://golproductions.com/check), the anti-hallucination layer for Claude Code, and [Envie](https://golproductions.com/envie), verified AI video.

[Product page](https://golproductions.com/exnos) · [GOL Productions](https://golproductions.com) · [GitHub](https://github.com/golproductions/exnos)
