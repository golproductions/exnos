# Chrome Web Store listing copy (paste into dashboard)

**Name:** Exnos

**Summary (132 chars max):**
Live browser-state verification for AI coding agents. One call, milliseconds, truth. Free, by GOL Productions.

**Description:**

Your coding AI says "Done." Exnos is how it knows.

Exnos connects your Chrome to your coding agent (Claude Code or any MCP-capable agent) through a local server. One tool call returns the real state of the tab you are looking at, in milliseconds: URL, title, every visible field with its live value, every button with its disabled state, checkboxes, visible alerts, console errors since page load, scroll position, and the visible text.

Read-only by design. Exnos never touches the page, never clicks, never types. It only looks.

Everything stays on your machine. The extension talks to a local server on 127.0.0.1 and nowhere else. No accounts, no tracking, no data leaves your computer. Free forever.

Setup (2 minutes):
1. Install this extension.
2. Connect your agent: claude mcp add --scope user exnos -- npx @golproductions/exnos
3. The badge reads ON when connected.

Made by GOL Productions. golproductions.com/exnos

**Category:** Developer Tools
**Language:** English

**Privacy practices (dashboard questions):**
- Single purpose: report live browser tab state to a local MCP server for AI coding agents.
- Permissions justification: scripting + host_permissions (read page state on request), tabs (list tabs, find the active one), alarms (reconnect to the local server).
- Data usage: no user data collected, sold, or transferred. All traffic is device-local (127.0.0.1).

**Assets still needed for submission (Adam's dashboard session):**
- Screenshots: at least one 1280x800 screenshot (dashboard requires it).
- The ZIP: exnos/exnos-extension-0.1.0.zip
