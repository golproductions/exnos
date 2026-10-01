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

### Updating

`npx` fetches the newest server on its own; the Chrome extension does not update itself. After an update, open `chrome://extensions` and click reload on Exnos. If it still shows the old version, remove it and load the folder printed by `npx @golproductions/exnos@latest path`.

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
| **Page text** | The page's rendered text, first 3,000 characters (`maxText` up to 20,000), marked when cut |
| **Forms** | Every field in view with its live value and a selector (passwords, API keys, tokens, CSRF tokens, card numbers and seed phrases masked) |
| **Buttons** | Text, disabled state and a selector |
| **Checkboxes** | Checked state with labels |
| **Alerts** | Visible error/success/warning UI |
| **Console** | Errors (with message and stack), warnings, and failed resource loads since page load, counted separately |
| **Network** | This site's fetch/XHR: URL, status, short response body; the last 30 failed and 20 successful. Other sites' requests only on request. |
| **WebSocket** | The last 30 sent and received frames |
| **Performance** | Page load, TTFB, paint timing |
| **Focus** | Which element has focus |
| **Shadow DOM** | Pierces web component boundaries |
| **Iframes** | Same-origin content + cross-origin count |
| **Screenshot** | Optional PNG, returned as an image |

Only when asked: `localStorage`, `sessionStorage` and cookies (`includeStorage`, with tokens, keys and session values redacted), requests to other sites (`thirdParty`), and `window.__*` app state (`appGlobals`).

---

## Tools

| Tool | Purpose |
|------|---------|
| `exnos_verify` | Full live state. The main tool. |
| `exnos_tabs` | List the tabs Exnos can read. |
| `exnos_screenshot` | PNG screenshot of visible tab. |
| `exnos_fetch_tabs` | Verify multiple tabs at once. |
| `exnos_record_start` | Record a tab over time: saves what changed every few seconds. |
| `exnos_record_status` | List recordings, including ones from earlier sessions. |
| `exnos_record_read` | Read back a recording: a time range, latest or earliest first. |
| `exnos_record_stop` | Stop one recording, or all of them. |

### exnos_verify parameters

| Parameter | Description |
|-----------|-------------|
| `tab` | Match tab by URL or title substring. Default: active tab. |
| `selector` | CSS selector for deep-dive: text, bounds, computed styles, HTML. |
| `maxText` | Characters of page text, and of selector text and HTML. Default 3,000 / 2,000, maximum 20,000. |
| `includeHidden` | Also list fields, buttons and checkboxes outside the viewport or hidden, including `type=hidden` inputs. Default: false. Page text always covers the whole page; text hidden with `display:none` is never included. |
| `thirdParty` | Include requests to other sites. Default: false. |
| `includeStorage` | Include storage and cookies, credentials redacted. Default: false. |
| `appGlobals` | Include `window.__*` app state. Default: false. |
| `screenshot` | Also capture a PNG of the visible tab, returned as an image. |

### Selector deep-dive

Pass `selector` to get the following for the first match. If nothing matches, `selectorFound` is `false` and the rest of the state (errors included) still comes back.
- `selectorText` — inner text content
- `selectorVisible` — actually visible?
- `selectorBounds` — `{top, left, width, height}`
- `selectorHTML` — outer HTML
- `selectorStyles` — computed: color, backgroundColor, fontSize, fontWeight, fontFamily, padding, margin, border, zIndex, overflow, transform, transition

### Record mode

`exnos_verify` is a snapshot. A recording keeps watching: every few seconds Exnos samples the tab and saves what changed, so a bug that comes and goes, or a list that changes all day, can be read back later.

```
AI:  [calls exnos_record_start { tab: "localhost:3000", selector: "#orders", items: "tr", every: 2, duration: 120 }]
     ... two hours later, from any session ...
AI:  [calls exnos_record_read { lastMinutes: 15 }]
```

Each saved sample holds the URL, title, whether the tab was visible, and what is new since the last sample: console errors and warnings, failed resource loads, this site's requests and failed requests to other sites. With a `selector` it also holds the text of that part of the page and its items (`[text, link, top, left, visible]`). Unchanged samples are not saved; a heartbeat every 30 seconds shows the recording went on.

| Parameter | Description |
|-----------|-------------|
| `tab` | Match tab by URL or title substring. Default: active tab. Fixed when recording starts. |
| `selector` | Part of the page to watch: up to 20 matching elements, each with up to 1,000 characters of text and 100 items. Without it: URL, title, visibility, errors and requests only. |
| `items` | Repeated items inside the selector (rows, cards). Default: links. |
| `every` | Seconds between samples. Default 2, minimum 1. |
| `duration` | Minutes to record. Default 60, maximum 1440 (24 h). |
| `includeHidden` | Also save items scrolled out of view. Default: false. |
| `maxMB` | Stop at this file size. Default 200. |
| `name` | Short label added to the recording id. |

`exnos_record_read` parameters:

| Parameter | Description |
|-----------|-------------|
| `id` | Recording id. Default: the newest recording. |
| `lastMinutes` | Only samples from the last N minutes. |
| `from` / `to` | Only samples inside this time range (ISO time). |
| `limit` | How many samples to return. Default 10, maximum 200. |
| `oldestFirst` | Earliest matching samples instead of the latest. Default: false. |
| `changesOnly` | Skip heartbeat lines. Default: true. |
| `full` | Untrimmed text and items. Default: false (300 characters, 40 items per region). |

- Recordings are saved on this machine in `~/.exnos/recordings/` (`<id>.jsonl`, one line per saved sample). The AI cannot choose the file path.
- A recording keeps running after the AI session ends, until its duration is up, the tab closes, it reaches `maxMB`, or `exnos_record_stop` is called. A later session can list, read and stop it. Up to 3 recordings run at a time per session.
- Chrome must stay open. A sample that fails (Chrome closed, page loading) is saved as an error line, at most one every 30 seconds.
- The same scope as `exnos_verify`, checked on every sample: if the tab moves to a site Exnos may not read, the recording stops. Form field values are never recorded, but text typed into editable parts of the page can appear in the watched text. URL parameters with sensitive-looking names are masked.
- Chrome slows hidden tabs. For pages that update live, keep the recorded tab visible.

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

- **State change detection**: Reports `changed: true/false` on repeated calls, over the whole page text, form values, button and checkbox states, alerts and error counts
- **Proxy mode**: Multiple agents share one extension connection; when the connected one closes, another takes over
- **Auto-reconnect**: Extension reconnects after Chrome/server restart
- **Failures first**: Network errors surface before successful requests
- **Cross-origin awareness**: Reports iframe count even when content isn't readable
- **Out of the page's reach**: what Exnos captures is kept where the page's own scripts cannot read or change it
- **Untrusted content label**: replies tell the AI that page text is data, not instructions

---

## Privacy

Exnos sends nothing to GOL Productions. No account, no telemetry, and no GOL server. Traffic goes from the extension to a local server on `127.0.0.1`, which only accepts the Exnos extension and requests from this machine: a web page cannot connect to it.

**However**: what Exnos returns goes to your AI agent, which forwards it to its model provider. That is why Exnos reads only local pages and the sites you allow, masks passwords and similar fields, and returns storage and cookies only when asked, with credentials redacted. Redaction works by pattern, so it can miss a secret in an unusual place.

Recordings are saved only on this machine, in `~/.exnos/recordings/`; they reach the AI only when it reads them back. Delete the folder to delete them.

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
