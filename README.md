# Exnos

**Live browser-state verification for AI coding agents.**

Your AI says "done." Exnos is how it knows.

One tool call returns the full state of the Chrome tab you're looking at: every field, every button, every console error, network requests, storage, performance—in milliseconds. Read-only. Local. Free and open source.

By [GOL Productions](https://golproductions.com).

---

## The Problem

AI coding agents edit files and hope for the best. When something breaks:

```
You: "The button doesn't work"
AI:  "Can you check the console for errors?"
You: "It says TypeError something something"
AI:  "Can you paste the full error?"
```

Back and forth. Slow. Frustrating.

## The Solution

```
You: "The button doesn't work"
AI:  [calls exnos_verify]
AI:  "Console shows 'TypeError: handleClick is not defined' at line 47.
      The handler was renamed to onClick. Fixing now."
```

Exnos gives your AI eyes. It sees what you see—instantly.

---

## Install

```
npx @golproductions/exnos@latest setup
```

That's it. Detects Claude Code, Cursor, and Windsurf—registers with all of them, opens the extension folder, tells you to load it in Chrome. Takes 30 seconds.

<details>
<summary>Manual install</summary>

**1. Connect your agent**

```json
{ "mcpServers": { "exnos": { "command": "npx", "args": ["@golproductions/exnos"] } } }
```

Or for Claude Code:
```
claude mcp add --scope user exnos -- npx @golproductions/exnos
```

**2. Load the extension**

```
npx @golproductions/exnos@latest path
```

Open `chrome://extensions` → Developer mode → **Load unpacked** → select that folder.

Badge reads **ON** when connected.

</details>

---

## What It Sees

| Category | Data |
|----------|------|
| **Identity** | URL, title, ready state |
| **Forms** | Every visible field with live value (passwords masked) |
| **Buttons** | Text and disabled state |
| **Checkboxes** | Checked state with labels |
| **Alerts** | Visible error/success/warning UI |
| **Console** | Errors and uncaught exceptions since page load |
| **Network** | Every fetch/XHR: URL, status, response body. Failures first. |
| **WebSocket** | Sent and received frames |
| **Storage** | localStorage, sessionStorage, cookies |
| **Performance** | Page load, TTFB, paint timing, long tasks, heap |
| **Focus** | Which element has focus |
| **Shadow DOM** | Pierces web component boundaries |
| **Iframes** | Same-origin content + cross-origin count |
| **App State** | `window.__*` values |
| **Screenshot** | Optional PNG capture |

---

## Tools

| Tool | Purpose |
|------|---------|
| `exnos_verify` | Full live state. The main tool. |
| `exnos_tabs` | List all open tabs. |
| `exnos_screenshot` | PNG screenshot of visible tab. |
| `exnos_fetch_tabs` | Verify multiple tabs at once. |

### exnos_verify parameters

| Parameter | Description |
|-----------|-------------|
| `tab` | Match tab by URL or title substring. Default: active tab. |
| `selector` | CSS selector for deep-dive: text, bounds, computed styles, HTML. |
| `includeHidden` | Include off-screen elements. Default: false. |
| `screenshot` | Also capture PNG. Returns data URL. |

### Selector deep-dive

Pass `selector` to get:
- `selectorText` — inner text content
- `selectorVisible` — actually visible?
- `selectorBounds` — `{top, left, width, height}`
- `selectorHTML` — outer HTML
- `selectorStyles` — computed: color, backgroundColor, fontSize, fontWeight, fontFamily, padding, margin, border, zIndex, overflow, transform, transition

---

## CLI

```
npx @golproductions/exnos@latest setup       # configure everything
npx @golproductions/exnos@latest uninstall   # remove everything Exnos added (run it in each project where you ran init)
npx @golproductions/exnos@latest path        # extension folder path
npx @golproductions/exnos@latest init        # write rules to agent config
npx @golproductions/exnos@latest rules       # print rule text
```

---

## Architecture

```
┌─────────────┐     MCP/stdio      ┌─────────────┐    WebSocket     ┌─────────────┐
│  AI Agent   │ ◄────────────────► │ MCP Server  │ ◄──────────────► │  Extension  │
│             │                    │ :17872      │                  │             │
└─────────────┘                    └─────────────┘                  └──────┬──────┘
                                                                           │
                                                                    Chrome APIs
                                                                           │
                                                                    ┌──────▼──────┐
                                                                    │   Your Tab  │
                                                                    └─────────────┘
```

---

## Smart Features

- **State change detection**: Reports `changed: true/false` on repeated calls
- **Proxy mode**: Multiple agents share one extension connection
- **Auto-reconnect**: Extension reconnects after Chrome/server restart
- **Failures first**: Network errors surface before successful requests
- **Cross-origin awareness**: Reports iframe count even when content isn't readable

---

## Privacy

Exnos sends nothing to GOL Productions. No account, no telemetry, and no GOL server. Traffic goes from the extension to a local server on `127.0.0.1`, which only accepts the Exnos extension and requests from this machine: a web page cannot connect to it.

**However**: What Exnos returns goes to your AI agent, which forwards it to its model provider. Cookies, storage, and response bodies can carry session tokens.

Point it at what you're debugging, not your banking tab.

---

## Notes

- Server: `127.0.0.1:17872`. The Chrome extension always connects on this port, so keep it free.
- `GET /` returns `{"exnos":true,"extension":true|false}`
- Console/network taps run from `document_start`—pages open before extension load need one refresh
- Internal pages (`chrome://`) cannot be inspected

---

## License

Free, under the GOL Open License: use, modify and redistribute it, with attribution to GOL Productions kept in every copy and fork. See [LICENSE](./LICENSE).

"Exnos" and "GOL Productions" are trademarks. Forks must use a different name and state that they are based on software by GOL Productions.

---

## GOL Productions

Exnos is part of the [GOL Productions](https://golproductions.com) toolchain.

- **[Check](https://golproductions.com/check)** — Anti-hallucination layer for Claude Code
- **[Envie](https://golproductions.com/envie)** — AI video rendering with verification

[Product page](https://golproductions.com/exnos) · [GitHub](https://github.com/golproductions/exnos)
