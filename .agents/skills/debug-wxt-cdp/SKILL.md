---
name: debug-wxt-cdp
description: Probe WXT Chrome extensions through raw CDP. Use when Codex needs to inspect this project's real New Tab DOM, layout, storage, or console; interrogate its MV3 service worker; observe extension reload targets; or debug WXT without Playwright.
---

# Debug WXT through raw CDP

Use a tight two-process loop: the launcher owns an isolated WXT Chrome, and the probe owns the browser-level CDP connection. Keep the launch session alive until every requested observation is complete.

## Guardrails

- Use a dedicated `.wxt/cdp-profile` or an explicitly supplied temporary profile.
- Bind the debugging server to `127.0.0.1` and treat a non-loopback endpoint as a stop condition.
- Report extension-storage key names by default. Read values only when the user explicitly places them in scope, and redact credentials.
- Use Bun's `fetch` and `WebSocket` as the CDP client. The bundled scripts contain the protocol plumbing.

## 1. Preflight

From the repository root, locate the package whose `package.json` contains `wxt`, then choose a free loopback port:

```bash
rtk rg -n '"wxt"' apps/extension/package.json
rtk lsof -nP -iTCP:9333 -sTCP:LISTEN
rtk lsof -nP -iTCP:3001 -sTCP:LISTEN
rtk git status --short
```

Use the discovered package path for `--root`. Complete this step when the WXT package exists, dependencies are installed, the selected port has no listener, and the pre-existing worktree state is recorded.

## 2. Launch isolated WXT Chrome

Run the launcher in a PTY or long-lived exec session and retain its session identifier:

```bash
rtk bun .agents/skills/debug-wxt-cdp/scripts/launch.ts \
  --root apps/extension \
  --port 9333 \
  --dev-port 3001
```

The launcher uses `webExt.chromiumArgs` for the TCP port because this repository's WXT 0.20.x / `web-ext-run` dependency chain silently drops `webExt.chromiumPort`. WXT's internal `--remote-debugging-pipe` remains active alongside the external port.

Poll the endpoint from a second command:

```bash
rtk curl -fsS http://127.0.0.1:9333/json/version
```

Complete this step when the response contains `Browser`, `Protocol-Version`, and `webSocketDebuggerUrl`.

## 3. Probe the real extension page

Run the read-focused probe:

```bash
rtk bun .agents/skills/debug-wxt-cdp/scripts/probe.ts \
  --root apps/extension \
  --port 9333
```

Treat the runtime result as authoritative when `/json/list` labels an override target `chrome://newtab/`; Chrome can expose that alias while `location.href` inside the target is `chrome-extension://<id>/newtab.html`.

Complete this step only when the report proves all of the following:

- page, manifest, and worker extension IDs agree;
- `readyState` is `complete` and `#root` has rendered content;
- DOM-domain extraction and screenshot capture succeed;
- IndexedDB and extension-storage key discovery succeed;
- the Tabstow `settings:get` background message returns successfully;
- no `Runtime.exceptionThrown` or `Log.entryAdded` error is reported during the probe window.

## 4. Exercise extension reload

When the task includes extension loading, reload, startup, or worker restart behavior, first read [references/lifecycle.md](references/lifecycle.md), then run:

```bash
rtk bun .agents/skills/debug-wxt-cdp/scripts/probe.ts \
  --root apps/extension \
  --port 9333 \
  --reload
```

Complete this step when `Extensions.loadUnpacked` returns the same extension ID, the old page and worker targets are destroyed, replacement targets are created, and the replacement page renders successfully.

## 5. Clean up

Send `Ctrl-C` to the retained launcher session. Then verify:

```bash
rtk lsof -nP -iTCP:9333 -sTCP:LISTEN
rtk lsof -nP -iTCP:3001 -sTCP:LISTEN
rtk git status --short
```

Preserve the isolated profile unless the user requested an ephemeral run. Complete the workflow when both listeners are gone, the WXT-owned Chrome has exited, and the worktree contains no unexpected artifacts.
