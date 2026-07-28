# Exnos

**Live browser-state verification for AI coding agents.** Your AI says "done." Exnos is how it knows. One tool call returns the full state of the Chrome tab you are looking at: every field, every button, every console error, network requests, storage, performance, in milliseconds. Read-only. Local. Free, MIT.

**Experimental.** Exnos reads a live Chrome tab through a local bridge. Expect it to break when a site ships a change. MIT licensed, as-is, no warranty.

---

## Install (2 minutes)

**1. Connect your agent**

```
claude mcp add-json --scope user exnos '{"command":"npx","args":["@golproductions/exnos"]}'
```

Any MCP client (.mcp.json):

```json
{ "mcpServers": { "exnos": { "command": "npx", "args": ["@golproductions/exnos"] } } }
```

**2. Load the extension**

```
npx @golproductions/exnos path
```

Open `chrome://extensions`, enable Developer mode, click Load unpacked, pick that folder. Badge reads ON when connected.

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

## CLI

```
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

## License

MIT. The names "Exnos" and "GOL Productions" are trademarks of GOL Productions and are not licensed under MIT. Forks must use a different name.

[Product](https://golproductions.com/exnos) · [GOL Productions](https://golproductions.com) · [GitHub](https://github.com/golproductions/exnos)