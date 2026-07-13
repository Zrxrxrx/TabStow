# MV3 lifecycle observations

Read this reference only when the task concerns extension reload, worker restart, install/startup events, or natural service-worker suspension.

## Reload sequence

The probe connects to the browser-level WebSocket and enables `Target.setDiscoverTargets` before reloading. It briefly attaches to the page and worker to read their runtime state, then detaches both before calling `Extensions.loadUnpacked`.

A successful reload should show this sequence for the same extension ID:

1. Existing extension page target changes or is destroyed.
2. Existing `service_worker` target is destroyed.
3. A replacement `service_worker` target is created.
4. A replacement `newtab.html` target is created and reaches `readyState: complete`.

Target IDs change across reload. The extension ID should remain stable for the same unpacked path.

## Observation boundaries

- Browser-level target events reveal creation and destruction only after discovery is enabled. Persist an application event journal when `runtime.onInstalled` or `runtime.onStartup` must be audited after the fact.
- Attaching DevTools to a service worker can keep it active. Detach the worker before judging termination or restart behavior.
- WXT development HMR can add activity that changes idle behavior. Use the production unpacked output when the task requires store-like natural suspension semantics.
- A New Tab override may appear as `chrome://newtab/` in target metadata. Evaluate `location.href` inside the target to establish its extension origin.

## Natural idle suspension

For an idle-suspension test, connect only to the browser target, enable target discovery, and leave the worker unattached. Record whether its target is destroyed after the expected idle window and whether a new extension event recreates it. Report WXT HMR as a confounder when the worker remains alive.

## Current dependency fact

WXT 0.20.x passes `webExt.chromiumPort` into its runner configuration, but the installed `web-ext-run` version does not forward that option to `chrome-launcher`. Supply `--remote-debugging-port=<port>` through `webExt.chromiumArgs`. Chrome supports WXT's pipe connection and the loopback TCP connection concurrently.
