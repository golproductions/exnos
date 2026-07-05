# Exnos

Live browser-state verification for AI coding agents. Free, by GOL Productions.

Your coding AI says "Done." Exnos is how it knows. One tool call returns the
real state of the Chrome tab you are looking at, in milliseconds: URL, title,
every visible field with its live value, every button with its disabled state,
checkboxes, visible alerts, console errors since page load, scroll position,
and the visible text. Read-only by design. Exnos never touches the page.

## How it works

```
coding AI  --MCP(stdio)-->  exnos server  --WebSocket(localhost)-->  Chrome extension  -->  the live page
```

No debug port. No relaunching Chrome. Works with the normal Chrome you
already have open.

## Install (2 minutes)

**1. Connect your coding agent (Claude Code)**

```
claude mcp add --scope user exnos -- npx @golproductions/exnos
```

Any other MCP-capable agent: run `npx @golproductions/exnos` as a stdio MCP
server. No paths to type, nothing to quote.

**2. Load the extension**

Print where the extension lives:

```
npx @golproductions/exnos path
```

Then open `chrome://extensions`, turn on Developer mode (top right), click
"Load unpacked", and pick that folder. The Exnos badge reads ON when it finds
the server, OFF when it is waiting.

## Tools

| Tool | What it returns |
| --- | --- |
| `exnos_verify` | Full live state of the active tab. Optional `tab` (substring of URL/title) targets another tab; optional `selector` also returns that element's text, visibility, and HTML. |
| `exnos_tabs` | All open tabs: title, URL, which is active. |

## Notes

- Server listens on `127.0.0.1:17872` (override with `EXNOS_PORT`).
- `GET http://127.0.0.1:17872/` returns `{"exnos":true,"extension":true|false}` for a quick health check.
- If the server or Chrome restarts, the extension reconnects by itself within seconds.
- Internal pages (`chrome://`, web store) cannot be inspected; Exnos says so instead of guessing.
- Console errors are captured from page load by a tap injected at `document_start`; pages opened before the extension loaded need one reload to start capturing.

## License and trademarks

Exnos is free software under the MIT license. The copyright notice must stay
in all copies, that is the license's own condition. The names "Exnos" and
"GOL Productions" and the Exnos logo are trademarks of GOL Productions and are
not licensed under MIT. Forks must use a different name and must not imply
endorsement by GOL Productions.

Free forever. Made by [GOL Productions](https://golproductions.com).
