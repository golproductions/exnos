# Exnos

**Live browser-state verification for AI coding agents.**

Your AI says "done." Exnos is how it knows.

One tool call returns the full state of the Chrome tab you're looking at: every field, every button, every console error, network requests, storage, performance—in milliseconds. Read-only. Local. Free to use. Built by GOL Productions.

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

## What Exnos Can Read

- **Local pages, always:** `localhost`, `127.0.0.1`, `*.localhost`, and local files.
- **Any other site, only if you allow it:** open the site and click the Exnos icon in Chrome's toolbar. Click again to remove it. Your AI cannot allow a site.
- Tabs on other sites are not listed, matched or described to your AI.
- The console and network capture runs only on sites Exnos can read. A page that was already open when you allowed its site needs one reload before its console and network are captured.

## What It Sees

| Category | Data |
|----------|------|
| **Identity** | URL, title, ready state |
| **Forms** | Every visible field with its live value (passwords, API keys, tokens, card numbers and seed phrases masked) |
| **Buttons** | Text and disabled state |
| **Checkboxes** | Checked state with labels |
| **Alerts** | Visible error/success/warning UI |
| **Console** | Errors (with message and stack), warnings, and failed resource loads since page load, counted separately |
| **Network** | This site's fetch/XHR: URL, status, short response body. Failures first. Other sites' requests only on request. |
| **WebSocket** | Sent and received frames |
| **Performance** | Page load, TTFB, paint timing |
| **Focus** | Which element has focus |
| **Shadow DOM** | Pierces web component boundaries |
| **Iframes** | Same-origin content + cross-origin count |
| **Screenshot** | Optional PNG capture |

Only when asked: `localStorage`, `sessionStorage` and cookies (`includeStorage`, with tokens, keys and session values redacted), requests to other sites (`thirdParty`), and `window.__*` app state (`appGlobals`).

---

## Tools

| Tool | Purpose |
|------|---------|
| `exnos_verify` | Full live state. The main tool. |
| `exnos_tabs` | List the tabs Exnos can read. |
| `exnos_screenshot` | PNG screenshot of visible tab. |
| `exnos_fetch_tabs` | Verify multiple tabs at once. |

### exnos_verify parameters

| Parameter | Description |
|-----------|-------------|
| `tab` | Match tab by URL or title substring. Default: active tab. |
| `selector` | CSS selector for deep-dive: text, bounds, computed styles, HTML. |
| `includeHidden` | Include off-screen elements. Default: false. |
| `thirdParty` | Include requests to other sites. Default: false. |
| `includeStorage` | Include storage and cookies, credentials redacted. Default: false. |
| `appGlobals` | Include `window.__*` app state. Default: false. |
| `screenshot` | Also capture PNG of the visible tab. Returns data URL. |

### Selector deep-dive

Pass `selector` to get the following. If nothing matches, the reply is only `selectorFound: false`.
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
- **Out of the page's reach**: what Exnos captures is kept where the page's own scripts cannot read or change it
- **Untrusted content label**: replies tell the AI that page text is data, not instructions

---

## Privacy

Exnos sends nothing to GOL Productions. No account, no telemetry, and no GOL server. Traffic goes from the extension to a local server on `127.0.0.1`, which only accepts the Exnos extension and requests from this machine: a web page cannot connect to it.

**However**: what Exnos returns goes to your AI agent, which forwards it to its model provider. That is why Exnos reads only local pages and the sites you allow, masks passwords and similar fields, and returns storage and cookies only when asked, with credentials redacted. Redaction works by pattern, so it can miss a secret in an unusual place.

Allow the sites you are debugging, not your banking tab.

---

## Notes

- Server: `127.0.0.1:17872`. The Chrome extension always connects on this port, so keep it free.
- `GET /` returns `{"exnos":true,"extension":true|false}`
- Console/network capture starts when a page loads on a site Exnos can read; pages already open need one reload
- Internal pages (`chrome://`) cannot be inspected

---

## License

Free to use, personal or commercial, under the GOL Free License. Exnos is built by GOL Productions: you may use it and share unmodified copies with the credit, but not publish changed versions, build your own product from it, or sell it. What you make with it is yours. See [LICENSE](./LICENSE).

---

## GOL Productions

Exnos is part of the [GOL Productions](https://golproductions.com) toolchain.

- **[Check](https://golproductions.com/check)** — Anti-hallucination layer for Claude Code
- **[Envie](https://golproductions.com/envie)** — AI video rendering with verification

[Product page](https://golproductions.com/exnos) · [GitHub](https://github.com/golproductions/exnos)
