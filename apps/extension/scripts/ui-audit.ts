#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  evaluateUiAuditCase,
  getUiAuditBrowserArgumentErrors,
  getUiAuditRuntimeIdentityErrors,
  hashUiAuditEntries,
  normalizeCdpRuntimeError,
  parseUiAuditArguments,
  selectUiAuditCase,
  validateUiAuditManifest,
  type UiAuditBuildEntry,
  type UiAuditExtensionManifest,
  type UiAuditMetrics,
} from './ui-audit-core';

type CdpVersion = {
  Browser: string;
  'Protocol-Version': string;
  webSocketDebuggerUrl: string;
};

type CdpTarget = {
  targetId: string;
  type: string;
  url: string;
};

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type RuntimeObservation = {
  metrics: UiAuditMetrics;
  runtimeId: string;
  manifest: UiAuditExtensionManifest;
  resourceHashes: {
    manifest: string;
    page: string;
  };
  colorScheme: string;
};

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(scriptDirectory, '..');
const repositoryRoot = resolve(extensionRoot, '../..');
const buildDirectory = resolve(extensionRoot, '.output/chrome-mv3');
const casesPath = resolve(scriptDirectory, 'ui-audit-cases.json');

function toRepositoryPath(path: string): string {
  return relative(repositoryRoot, path).split(sep).join('/');
}

const helpText = `Tabstow built-extension UI audit

Usage:
  bun run audit:ui -- --case CASE [options]

Options:
  --case CASE          Case ID from apps/extension/scripts/ui-audit-cases.json
  --port PORT          Loopback Chrome DevTools port (default: 9333)
  --output DIRECTORY   Evidence directory (default: .artifacts/ui-audit/<sha>/<case>)
  --extension-id ID    Expected extension ID when target discovery is ambiguous
  --help               Show this help without requiring a build or browser
`;

class CdpConnection {
  readonly runtimeErrors: string[] = [];

  private sequence = 0;
  private readonly pending = new Map<number, PendingCall>();

  private constructor(
    private readonly socket: WebSocket,
    readonly version: CdpVersion,
  ) {
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(
        typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer),
      ) as Record<string, unknown>;
      if (typeof message.id === 'number') {
        const call = this.pending.get(message.id);
        if (!call) return;
        this.pending.delete(message.id);
        clearTimeout(call.timeout);
        if (message.error && typeof message.error === 'object') {
          const error = message.error as { message?: unknown; code?: unknown };
          call.reject(new Error(`${String(error.message ?? 'CDP error')} (${String(error.code ?? '?')})`));
        } else {
          call.resolve(message.result);
        }
        return;
      }

      const runtimeError = normalizeCdpRuntimeError(message);
      if (runtimeError) this.runtimeErrors.push(runtimeError);
    });
    socket.addEventListener('error', () => {
      this.failPending(new Error('Chrome DevTools WebSocket failed'));
    });
    socket.addEventListener('close', () => {
      this.failPending(new Error('Chrome DevTools WebSocket closed'));
    });
  }

  static async connect(port: number): Promise<CdpConnection> {
    const endpoint = `http://127.0.0.1:${port}/json/version`;
    let response: Response;
    try {
      response = await fetch(endpoint, { signal: AbortSignal.timeout(3_000) });
    } catch {
      throw new Error(`Could not reach Chrome DevTools at ${endpoint}`);
    }
    if (!response.ok) throw new Error(`Chrome DevTools returned HTTP ${response.status}`);
    const version = await response.json() as CdpVersion;
    if (!version.webSocketDebuggerUrl?.startsWith('ws://')) {
      throw new Error('Chrome DevTools did not provide a loopback WebSocket URL');
    }

    const socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise<void>((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('Chrome DevTools WebSocket timed out'));
      }, 5_000);
      socket.addEventListener('open', () => {
        clearTimeout(timeout);
        resolvePromise();
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('Chrome DevTools WebSocket failed'));
      }, { once: true });
    });
    return new CdpConnection(socket, version);
  }

  call<T>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<T> {
    const id = ++this.sequence;
    return new Promise<T>((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 15_000);
      this.pending.set(id, {
        resolve: (value) => resolvePromise(value as T),
        reject,
        timeout,
      });
      this.socket.send(JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }));
    });
  }

  close(): void {
    this.failPending(new Error('Chrome DevTools connection closed'));
    this.socket.close();
  }

  private failPending(error: Error): void {
    for (const call of this.pending.values()) {
      clearTimeout(call.timeout);
      call.reject(error);
    }
    this.pending.clear();
  }
}

async function evaluate<T>(
  cdp: CdpConnection,
  sessionId: string,
  expression: string,
): Promise<T> {
  const response = await cdp.call<{
    result: { value?: T };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description
      ?? response.exceptionDetails.text
      ?? 'Runtime evaluation failed',
    );
  }
  return response.result.value as T;
}

async function waitForPage(cdp: CdpConnection, sessionId: string): Promise<void> {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const ready = await evaluate<boolean>(cdp, sessionId, String.raw`(() => (
      document.readyState === 'complete'
      && (document.querySelector('#root')?.childElementCount ?? 0) > 0
    ))()`);
    if (ready) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error('Extension page did not render within 12 seconds');
}

async function waitForDomQuiet(cdp: CdpConnection, sessionId: string): Promise<void> {
  const result = await evaluate<{ timedOut: boolean }>(cdp, sessionId, String.raw`(() => (
    new Promise((resolvePromise) => {
      const quietMilliseconds = 500;
      let quietTimer;
      let finished = false;
      const observer = new MutationObserver(() => scheduleQuietCheck());
      const finish = (timedOut) => {
        if (finished) return;
        finished = true;
        clearTimeout(quietTimer);
        clearTimeout(maxTimer);
        observer.disconnect();
        resolvePromise({ timedOut });
      };
      const scheduleQuietCheck = () => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(() => finish(false), quietMilliseconds);
      };
      const maxTimer = setTimeout(() => finish(true), 5000);
      observer.observe(document.documentElement, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
      scheduleQuietCheck();
    })
  ))()`);
  if (result.timedOut) throw new Error('Extension page did not reach a quiet DOM state');
}

async function collectBuildEntries(
  root: string,
  directory = root,
): Promise<UiAuditBuildEntry[]> {
  const entries: UiAuditBuildEntry[] = [];
  const children = await readdir(directory, { withFileTypes: true });
  for (const child of children) {
    const path = resolve(directory, child.name);
    if (child.isDirectory()) {
      entries.push(...await collectBuildEntries(root, path));
    } else if (child.isFile()) {
      entries.push({
        path: relative(root, path).split(sep).join('/'),
        contents: await readFile(path),
      });
    }
  }
  return entries;
}

async function ensureEmptyOutputDirectory(path: string): Promise<void> {
  if (existsSync(path) && (await readdir(path)).length > 0) {
    throw new Error(`Evidence directory is not empty: ${path}`);
  }
  await mkdir(path, { recursive: true });
}

function gitOutput(args: string[]): string {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
}

function discoverExtensionWorkerTargets(
  targets: CdpTarget[],
  expectedId?: string,
): { extensionId: string; workers: CdpTarget[] } {
  const ids = new Set(targets.flatMap((target) => {
    if (target.type !== 'service_worker') return [];
    const match = /^chrome-extension:\/\/([a-p]{32})(?:\/|$)/.exec(target.url);
    return match?.[1] ? [match[1]] : [];
  }));

  if (expectedId) {
    if (!ids.has(expectedId)) {
      throw new Error(`Expected extension ${expectedId} is not active in the audit profile`);
    }
    return {
      extensionId: expectedId,
      workers: targets.filter((target) =>
        target.type === 'service_worker'
        && target.url.startsWith(`chrome-extension://${expectedId}/`)),
    };
  }
  if (ids.size === 0) {
    throw new Error('No active unpacked extension target found; open the loaded Tabstow New Tab once');
  }
  if (ids.size > 1) {
    throw new Error('Multiple extension targets found; rerun with --extension-id');
  }
  const extensionId = [...ids][0]!;
  return {
    extensionId,
    workers: targets.filter((target) =>
      target.type === 'service_worker'
      && target.url.startsWith(`chrome-extension://${extensionId}/`)),
  };
}

async function runUiAudit(): Promise<number> {
  const args = parseUiAuditArguments(process.argv.slice(2));
  if (args.help) {
    console.log(helpText);
    return 0;
  }

  const manifest = validateUiAuditManifest(JSON.parse(await readFile(casesPath, 'utf8')));
  const auditCase = selectUiAuditCase(manifest, args.caseId);
  const localManifestPath = resolve(buildDirectory, 'manifest.json');
  if (!existsSync(localManifestPath)) {
    throw new Error(`Missing production extension build: ${localManifestPath}`);
  }
  const localManifestText = await readFile(localManifestPath, 'utf8');
  const localManifest = JSON.parse(localManifestText) as UiAuditExtensionManifest;
  const localPagePath = resolve(buildDirectory, auditCase.page);
  if (!existsSync(localPagePath)) {
    throw new Error(`Production build is missing ${auditCase.page}`);
  }
  const localPageBytes = await readFile(localPagePath);
  const localResourceHashes = {
    manifest: createHash('sha256').update(localManifestText).digest('hex'),
    page: createHash('sha256').update(localPageBytes).digest('hex'),
  };

  const buildEntries = await collectBuildEntries(buildDirectory);
  const buildSha256 = hashUiAuditEntries(buildEntries);
  const commitSha = process.env.GITHUB_SHA ?? gitOutput(['rev-parse', 'HEAD']);
  const dirty = gitOutput(['status', '--porcelain']).length > 0;
  const defaultOutput = resolve(repositoryRoot, '.artifacts/ui-audit', commitSha, auditCase.id);
  const outputDirectory = args.outputDirectory === '.artifacts/ui-audit'
    ? defaultOutput
    : isAbsolute(args.outputDirectory)
      ? args.outputDirectory
      : resolve(repositoryRoot, args.outputDirectory);
  await ensureEmptyOutputDirectory(outputDirectory);

  const startedAt = Date.now();
  const cdp = await CdpConnection.connect(args.port);
  let targetId: string | undefined;
  let sessionId: string | undefined;
  const attachedSessionIds: string[] = [];

  try {
    let browserArguments: string[];
    try {
      ({ arguments: browserArguments } = await cdp.call<{ arguments: string[] }>(
        'Browser.getBrowserCommandLine',
      ));
    } catch {
      throw new Error('Chrome must be launched with --enable-automation for profile preflight');
    }
    const browserArgumentErrors = getUiAuditBrowserArgumentErrors(
      browserArguments,
      buildDirectory,
      {
        temporaryDirectory: tmpdir(),
        profileMarkerExists: (() => {
          const profileArgument = browserArguments.find((argument) =>
            argument.startsWith('--user-data-dir='));
          if (!profileArgument) return false;
          const profileDirectory = profileArgument.slice('--user-data-dir='.length);
          return existsSync(resolve(profileDirectory, '.tabstow-ui-audit-profile'));
        })(),
      },
    );
    if (browserArgumentErrors.length > 0) {
      throw new Error(browserArgumentErrors.join('; '));
    }

    const { targetInfos } = await cdp.call<{ targetInfos: CdpTarget[] }>('Target.getTargets');
    const { extensionId, workers } = discoverExtensionWorkerTargets(
      targetInfos,
      args.extensionId,
    );
    for (const worker of workers) {
      const attached = await cdp.call<{ sessionId: string }>('Target.attachToTarget', {
        targetId: worker.targetId,
        flatten: true,
      });
      attachedSessionIds.push(attached.sessionId);
      await Promise.all([
        cdp.call('Runtime.enable', {}, attached.sessionId),
        cdp.call('Log.enable', {}, attached.sessionId),
      ]);
    }
    ({ targetId } = await cdp.call<{ targetId: string }>('Target.createTarget', {
      url: 'about:blank',
    }));
    ({ sessionId } = await cdp.call<{ sessionId: string }>('Target.attachToTarget', {
      targetId,
      flatten: true,
    }));
    attachedSessionIds.push(sessionId);
    await Promise.all([
      cdp.call('Runtime.enable', {}, sessionId),
      cdp.call('Page.enable', {}, sessionId),
      cdp.call('Log.enable', {}, sessionId),
    ]);
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: auditCase.viewport.width,
      height: auditCase.viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: auditCase.viewport.width,
      screenHeight: auditCase.viewport.height,
    }, sessionId);

    const url = `chrome-extension://${extensionId}/${auditCase.page}`;
    const navigation = await cdp.call<{ errorText?: string }>('Page.navigate', { url }, sessionId);
    if (navigation.errorText) throw new Error(`Could not navigate to built extension: ${navigation.errorText}`);
    await waitForPage(cdp, sessionId);
    await waitForDomQuiet(cdp, sessionId);

    const observation = await evaluate<RuntimeObservation>(cdp, sessionId, String.raw`(async () => {
      const auditPage = ${JSON.stringify(auditCase.page)};
      const sha256 = async (path) => {
        const response = await fetch(chrome.runtime.getURL(path), { cache: 'no-store' });
        if (!response.ok) throw new Error('Could not read runtime resource: ' + path);
        const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
        return [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
      };
      const root = document.querySelector('#root');
      const headingLabels = new Set(
        [...document.querySelectorAll('h1,h2,h3')]
          .map((heading) => heading.textContent?.trim())
          .filter(Boolean),
      );
      const currentTab = await chrome.tabs.getCurrent();
      const zoom = currentTab?.id == null ? Number.NaN : await chrome.tabs.getZoom(currentTab.id);
      return {
        metrics: {
          rootChildCount: root?.childElementCount ?? 0,
          horizontalOverflowPx: Math.max(
            0,
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
          themeMode: document.documentElement.dataset.themeMode ?? '',
          locale: document.documentElement.lang,
          pagePath: location.pathname,
          workspaceLandmarks: ['Quick links', 'Active tabs', 'Saved for later']
            .filter((label) => headingLabels.has(label))
            .join('|'),
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          zoom,
        },
        runtimeId: chrome.runtime.id,
        manifest: chrome.runtime.getManifest(),
        resourceHashes: {
          manifest: await sha256('manifest.json'),
          page: await sha256(auditPage),
        },
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
      };
    })()`);

    const identityErrors = getUiAuditRuntimeIdentityErrors({
      extensionId,
      runtimeId: observation.runtimeId,
      localManifest,
      runtimeManifest: observation.manifest,
      localResourceHashes,
      runtimeResourceHashes: observation.resourceHashes,
    });

    const screenshot = await cdp.call<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    }, sessionId);
    const screenshotBytes = Buffer.from(screenshot.data, 'base64');
    const screenshotPath = resolve(outputDirectory, auditCase.screenshot);
    await writeFile(screenshotPath, screenshotBytes);
    if ((await stat(screenshotPath)).size < 1024) {
      identityErrors.push('Captured screenshot is unexpectedly small');
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    await evaluate(cdp, sessionId, 'true');

    const runtimeErrors = [...cdp.runtimeErrors, ...identityErrors];
    const result = evaluateUiAuditCase(auditCase, observation.metrics, runtimeErrors);
    const report = {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      baselineCommit: manifest.baselineCommit,
      source: {
        commitSha,
        dirty,
      },
      browser: {
        version: cdp.version.Browser,
        protocolVersion: cdp.version['Protocol-Version'],
      },
      build: {
        directory: toRepositoryPath(buildDirectory),
        sha256: buildSha256,
        resourceHashes: localResourceHashes,
        manifest: {
          name: localManifest.name,
          version: localManifest.version,
          permissions: localManifest.permissions ?? [],
          hostPermissions: localManifest.host_permissions ?? [],
        },
      },
      case: {
        id: auditCase.id,
        description: auditCase.description,
        requested: {
          viewport: auditCase.viewport,
          zoom: auditCase.zoom,
          theme: auditCase.theme,
          locale: auditCase.locale,
        },
        setup: auditCase.setup,
        cleanup: auditCase.cleanup,
      },
      observed: {
        metrics: observation.metrics,
        colorScheme: observation.colorScheme,
        resourceHashes: observation.resourceHashes,
      },
      screenshot: {
        path: auditCase.screenshot,
        bytes: screenshotBytes.byteLength,
        sha256: createHash('sha256').update(screenshotBytes).digest('hex'),
      },
      ...result,
    };
    const reportPath = resolve(outputDirectory, 'assertions.json');
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      case: auditCase.id,
      passed: result.passed,
      report: toRepositoryPath(reportPath),
      screenshot: toRepositoryPath(screenshotPath),
    }, null, 2));
    return result.passed ? 0 : 2;
  } finally {
    for (const attachedSessionId of [...attachedSessionIds].reverse()) {
      try {
        await cdp.call('Target.detachFromTarget', { sessionId: attachedSessionId });
      } catch {
        // Best-effort cleanup; the audit result has already captured the failure state.
      }
    }
    if (targetId) {
      try {
        await cdp.call('Target.closeTarget', { targetId });
      } catch {
        // Best-effort cleanup; the disposable profile is the final isolation boundary.
      }
    }
    cdp.close();
  }
}

if (import.meta.main) {
  runUiAudit().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
