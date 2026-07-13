#!/usr/bin/env bun

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

type CdpTarget = {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
};

type PendingCall = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type LifecycleEvent = {
  atMs: number;
  method: string;
  targetId: string;
  type?: string;
  url?: string;
};

function readOption(name: string, fallback?: string): string | undefined {
  const equalsPrefix = `--${name}=`;
  const equalsValue = Bun.argv.find((argument) => argument.startsWith(equalsPrefix));
  if (equalsValue) return equalsValue.slice(equalsPrefix.length);

  const index = Bun.argv.indexOf(`--${name}`);
  if (index >= 0) return Bun.argv[index + 1];
  return fallback;
}

const defaultRoot = existsSync(resolve('apps/extension/package.json'))
  ? 'apps/extension'
  : '.';
const root = resolve(readOption('root', defaultRoot)!);
const portText = readOption('port', '9333')!;
const port = Number(portText);
const reload = Bun.argv.includes('--reload');

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error(`Invalid CDP port: ${portText}`);
}

const extensionPath = resolve(root, '.output/chrome-mv3-dev');
if (!existsSync(resolve(extensionPath, 'manifest.json'))) {
  throw new Error(`WXT development output is missing: ${extensionPath}`);
}

const cdpBase = `http://127.0.0.1:${port}`;
const sleep = (milliseconds: number) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const versionResponse = await fetch(`${cdpBase}/json/version`);
if (!versionResponse.ok) {
  throw new Error(`CDP version endpoint failed: ${versionResponse.status}`);
}
const version = await versionResponse.json() as {
  Browser: string;
  'Protocol-Version': string;
  webSocketDebuggerUrl: string;
};

const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise<void>((resolvePromise, reject) => {
  socket.addEventListener('open', () => resolvePromise(), { once: true });
  socket.addEventListener('error', () => reject(new Error('CDP WebSocket failed to open')), {
    once: true,
  });
});

let sequence = 0;
const pending = new Map<number, PendingCall>();
const knownTargets = new Map<string, CdpTarget>();
const lifecycleEvents: LifecycleEvent[] = [];
const runtimeErrors: Array<{ method: string; summary: string }> = [];
const consoleErrors: Array<{ method: string; summary: string }> = [];
const createdTargetIds = new Set<string>();
const attachedSessionIds = new Set<string>();
const startedAt = Date.now();

socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(
    typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer),
  );

  if (message.id != null) {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) {
      entry.reject(new Error(`${message.error.message} (${message.error.code})`));
    } else {
      entry.resolve(message.result);
    }
    return;
  }

  if (message.method === 'Target.targetCreated' || message.method === 'Target.targetInfoChanged') {
    const info = message.params.targetInfo as CdpTarget;
    knownTargets.set(info.targetId, info);
    lifecycleEvents.push({
      atMs: Date.now() - startedAt,
      method: message.method,
      targetId: info.targetId,
      type: info.type,
      url: info.url,
    });
  } else if (message.method === 'Target.targetDestroyed') {
    const targetId = message.params.targetId as string;
    const info = knownTargets.get(targetId);
    lifecycleEvents.push({
      atMs: Date.now() - startedAt,
      method: message.method,
      targetId,
      type: info?.type,
      url: info?.url,
    });
    knownTargets.delete(targetId);
  } else if (message.method === 'Runtime.exceptionThrown') {
    const description = message.params.exceptionDetails?.exception?.description
      ?? message.params.exceptionDetails?.text
      ?? 'Runtime exception';
    runtimeErrors.push({ method: message.method, summary: String(description).slice(0, 500) });
  } else if (message.method === 'Runtime.consoleAPICalled') {
    const type = message.params.type as string;
    if (type === 'error' || type === 'assert') {
      const summary = (message.params.args ?? [])
        .map((argument: { value?: unknown; description?: string }) =>
          argument.value ?? argument.description ?? '')
        .join(' ');
      consoleErrors.push({ method: message.method, summary: String(summary).slice(0, 500) });
    }
  } else if (message.method === 'Log.entryAdded') {
    const entry = message.params.entry;
    if (entry?.level === 'error') {
      runtimeErrors.push({ method: message.method, summary: String(entry.text).slice(0, 500) });
    }
  }
});

function call(
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
): Promise<any> {
  const id = ++sequence;
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 10_000);
    pending.set(id, { resolve: resolvePromise, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

async function getTargets(): Promise<CdpTarget[]> {
  const { targetInfos } = await call('Target.getTargets');
  for (const target of targetInfos as CdpTarget[]) knownTargets.set(target.targetId, target);
  return targetInfos;
}

async function waitForTarget(
  predicate: (target: CdpTarget) => boolean,
  timeoutMs = 8_000,
): Promise<CdpTarget> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const target = (await getTargets()).find(predicate);
    if (target) return target;
    await sleep(100);
  }
  throw new Error('Timed out waiting for CDP target');
}

async function attach(targetId: string): Promise<string> {
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  attachedSessionIds.add(sessionId);
  await call('Runtime.enable', {}, sessionId);
  return sessionId;
}

async function detach(sessionId: string): Promise<void> {
  if (!attachedSessionIds.has(sessionId)) return;
  await call('Target.detachFromTarget', { sessionId });
  attachedSessionIds.delete(sessionId);
}

async function evaluate(sessionId: string, expression: string): Promise<any> {
  const output = await call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (output.exceptionDetails) {
    throw new Error(output.exceptionDetails.exception?.description ?? output.exceptionDetails.text);
  }
  return output.result.value;
}

try {
  await call('Target.setDiscoverTargets', { discover: true });
  const initialTargets = await getTargets();
  const worker = initialTargets.find(
    (target) => target.type === 'service_worker' && target.url.startsWith('chrome-extension://'),
  );
  if (!worker) throw new Error('No extension service worker target found');

  const extensionId = new URL(worker.url).host;
  const extensionUrl = `chrome-extension://${extensionId}/newtab.html`;
  const createdPage = await call('Target.createTarget', { url: extensionUrl });
  createdTargetIds.add(createdPage.targetId);
  const page = await waitForTarget((target) => target.targetId === createdPage.targetId);
  const pageSession = await attach(page.targetId);
  await call('Page.enable', {}, pageSession);
  await call('DOM.enable', {}, pageSession);
  await call('Log.enable', {}, pageSession);
  await sleep(1_500);

  const pageState = await evaluate(pageSession, String.raw`(async () => {
    const storageKeys = {};
    for (const area of ['local', 'sync', 'session']) {
      try {
        const api = chrome.storage?.[area];
        storageKeys[area] = api ? Object.keys(await api.get(null)).sort() : null;
      } catch (error) {
        storageKeys[area] = { error: String(error) };
      }
    }

    const databases = typeof indexedDB.databases === 'function'
      ? await indexedDB.databases()
      : [];
    const manifest = chrome.runtime.getManifest();
    const root = document.querySelector('#root');
    const firstChild = root?.firstElementChild;
    const rootRect = root?.getBoundingClientRect();
    const firstChildRect = firstChild?.getBoundingClientRect();

    let backgroundMessage;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'settings:get' });
      backgroundMessage = {
        ok: response?.ok === true,
        valueKeys: response?.ok && response.value
          ? Object.keys(response.value).sort()
          : [],
      };
    } catch (error) {
      backgroundMessage = { ok: false, error: String(error) };
    }

    return {
      href: location.href,
      title: document.title,
      readyState: document.readyState,
      extensionId: chrome.runtime.id,
      manifest: {
        name: manifest.name,
        version: manifest.version,
        manifestVersion: manifest.manifest_version,
        permissions: manifest.permissions ?? [],
      },
      indexedDB: databases.map(({ name, version }) => ({ name, version })),
      storageKeys,
      backgroundMessage,
      dom: {
        elementCount: document.querySelectorAll('*').length,
        rootChildCount: root?.childElementCount ?? null,
        rootHtmlLength: root?.outerHTML.length ?? null,
        headingCount: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
        buttonCount: document.querySelectorAll('button').length,
        inputCount: document.querySelectorAll('input,textarea,select').length,
        firstChild: firstChild && {
          tagName: firstChild.tagName,
          className: firstChild.className,
        },
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        rootRect: rootRect && {
          x: rootRect.x,
          y: rootRect.y,
          width: rootRect.width,
          height: rootRect.height,
        },
        firstChildRect: firstChildRect && {
          x: firstChildRect.x,
          y: firstChildRect.y,
          width: firstChildRect.width,
          height: firstChildRect.height,
        },
      },
    };
  })()`);

  const documentNode = await call('DOM.getDocument', { depth: 1, pierce: true }, pageSession);
  const rootNode = await call('DOM.querySelector', {
    nodeId: documentNode.root.nodeId,
    selector: '#root',
  }, pageSession);
  const rootOuterHtml = await call('DOM.getOuterHTML', { nodeId: rootNode.nodeId }, pageSession);
  const screenshot = await call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  }, pageSession);

  const workerSession = await attach(worker.targetId);
  const workerState = await evaluate(workerSession, `({
    extensionId: chrome.runtime.id,
    href: self.location.href,
    manifestName: chrome.runtime.getManifest().name,
    manifestVersion: chrome.runtime.getManifest().version,
    timeOrigin: performance.timeOrigin
  })`);
  await detach(workerSession);
  await detach(pageSession);

  let reloadReport: Record<string, unknown> | undefined;
  if (reload) {
    const reloadStartedAt = Date.now() - startedAt;
    const reloadResult = await call('Extensions.loadUnpacked', { path: extensionPath });
    await sleep(2_000);

    const postReloadPage = await call('Target.createTarget', { url: extensionUrl });
    createdTargetIds.add(postReloadPage.targetId);
    const replacementPage = await waitForTarget(
      (target) => target.targetId === postReloadPage.targetId,
    );
    const replacementPageSession = await attach(replacementPage.targetId);
    await sleep(1_000);
    const postReloadState = await evaluate(replacementPageSession, `({
      href: location.href,
      title: document.title,
      readyState: document.readyState,
      extensionId: chrome.runtime.id,
      rootChildCount: document.querySelector('#root')?.childElementCount ?? null
    })`);
    await detach(replacementPageSession);

    const lifecycle = lifecycleEvents.filter((event) =>
      event.atMs >= reloadStartedAt
      && (
        event.url?.startsWith(`chrome-extension://${extensionId}/`)
        || event.targetId === worker.targetId
        || event.targetId === page.targetId
        || event.targetId === replacementPage.targetId
      ),
    );

    const reloadChecks = {
      sameExtensionId: reloadResult.id === extensionId,
      oldPageDestroyed: lifecycle.some(
        (event) => event.method === 'Target.targetDestroyed' && event.targetId === page.targetId,
      ),
      oldWorkerDestroyed: lifecycle.some(
        (event) => event.method === 'Target.targetDestroyed' && event.targetId === worker.targetId,
      ),
      replacementWorkerCreated: lifecycle.some(
        (event) =>
          event.method === 'Target.targetCreated'
          && event.type === 'service_worker'
          && event.targetId !== worker.targetId,
      ),
      replacementPageCreated: lifecycle.some(
        (event) =>
          event.method === 'Target.targetCreated'
          && event.type === 'page'
          && event.targetId === replacementPage.targetId,
      ),
      replacementPageRendered:
        postReloadState.readyState === 'complete'
        && postReloadState.rootChildCount > 0,
    };

    reloadReport = {
      result: reloadResult,
      postReloadState,
      lifecycle,
      checks: reloadChecks,
    };
  }

  const checks = {
    idsAgree:
      pageState.extensionId === extensionId
      && workerState.extensionId === extensionId,
    pageComplete: pageState.readyState === 'complete',
    rootRendered: pageState.dom.rootChildCount > 0 && pageState.dom.rootHtmlLength > 0,
    domProtocolRead: rootNode.nodeId > 0 && rootOuterHtml.outerHTML.length > 0,
    screenshotCaptured: screenshot.data.length > 0,
    indexedDbDiscovered: pageState.indexedDB.some(
      (database: { name?: string }) => database.name === 'tabstow',
    ),
    storageAreasRead: ['local', 'sync', 'session'].every(
      (area) => Array.isArray(pageState.storageKeys[area]),
    ),
    backgroundMessageOk: pageState.backgroundMessage.ok === true,
    noRuntimeOrLogErrors: runtimeErrors.length === 0,
  };

  const output = {
    connection: {
      browser: version.Browser,
      protocolVersion: version['Protocol-Version'],
      endpoint: cdpBase,
    },
    discovered: {
      extensionId,
      initialTargetTypes: initialTargets.map(({ type, title, url }) => ({ type, title, url })),
    },
    pageState,
    domProtocol: {
      rootNodeId: rootNode.nodeId,
      rootOuterHtmlLength: rootOuterHtml.outerHTML.length,
      screenshotPngBytes: Math.floor(screenshot.data.length * 0.75),
    },
    workerState,
    checks,
    ...(reloadReport ? { reload: reloadReport } : {}),
    diagnostics: {
      runtimeOrLogErrorCount: runtimeErrors.length,
      runtimeOrLogErrors: runtimeErrors,
      consoleErrorCount: consoleErrors.length,
      consoleErrors,
    },
  };

  console.log(JSON.stringify(output, null, 2));

  const basicChecksPass = Object.values(checks).every(Boolean);
  const reloadChecksPass = !reloadReport
    || Object.values(reloadReport.checks as Record<string, boolean>).every(Boolean);
  if (!basicChecksPass || !reloadChecksPass) process.exitCode = 2;
} finally {
  for (const sessionId of [...attachedSessionIds]) {
    try {
      await call('Target.detachFromTarget', { sessionId });
    } catch {
      // The target may already be gone after an extension reload.
    }
  }
  for (const targetId of createdTargetIds) {
    try {
      await call('Target.closeTarget', { targetId });
    } catch {
      // The target may already be gone after an extension reload.
    }
  }
  socket.close();
}
