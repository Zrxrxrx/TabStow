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
  type UiAuditFeedbackFixture,
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
  interactionTrace: Array<Record<string, unknown>>;
  runtimeId: string;
  manifest: UiAuditExtensionManifest;
  resourceHashes: {
    manifest: string;
    page: string;
  };
  colorScheme: string;
};

type Finding006Interaction = {
  focusRegionSequence: string;
  tabSequenceComplete: number;
  quickLinkModalIsolationFailures: number;
  modalPortaledCount: number;
  rootInertDuringModal: number;
  lowerModalInert: number;
  topModalInteractive: number;
  focusInTopModal: number;
  trace: Array<Record<string, unknown>>;
};

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(scriptDirectory, '..');
const repositoryRoot = resolve(extensionRoot, '../..');
const buildDirectory = resolve(extensionRoot, '.output/chrome-mv3');
const casesPath = resolve(scriptDirectory, 'ui-audit-cases.json');

const feedbackFixtures: Record<Exclude<UiAuditFeedbackFixture, 'none'>, {
  tone: 'success' | 'error';
  message: string;
}> = {
  'stow-success': {
    tone: 'success',
    message: 'Stowed 1 tabs and closed 0.',
  },
  'restore-success': {
    tone: 'success',
    message: 'Restored 2 tabs and moved the session to History.',
  },
  'long-error': {
    tone: 'error',
    message: 'Unable to stow this window because the browser stopped responding before Tabstow could confirm that every saved tab was safely persisted. Review the tabs and try again.',
  },
};

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

async function dispatchKey(
  cdp: CdpConnection,
  sessionId: string,
  key: 'Escape' | 'Tab',
): Promise<void> {
  const code = key === 'Tab' ? 'Tab' : 'Escape';
  const virtualKeyCode = key === 'Tab' ? 9 : 27;
  const params = {
    key,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  };
  await cdp.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params }, sessionId);
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', ...params }, sessionId);
}

async function focusAndClickButton(
  cdp: CdpConnection,
  sessionId: string,
  name: string,
  marker?: string,
): Promise<void> {
  await evaluate(cdp, sessionId, String.raw`(() => {
    const name = ${JSON.stringify(name)};
    const button = [...document.querySelectorAll('button')].find((candidate) =>
      candidate.getAttribute('aria-label') === name
      || candidate.textContent?.replace(/\s+/g, ' ').trim() === name
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('FINDING-006 could not find button: ' + name);
    }
    const marker = ${JSON.stringify(marker ?? null)};
    if (marker) button.dataset[marker] = 'true';
    button.focus();
    button.click();
    return true;
  })()`);
  await waitForDomQuiet(cdp, sessionId);
}

async function runFinding006Interaction(
  cdp: CdpConnection,
  sessionId: string,
): Promise<Finding006Interaction> {
  const focusableCount = await evaluate<number>(cdp, sessionId, String.raw`(() => {
    const selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const nameOf = (element) => {
      const labelledBy = element.getAttribute('aria-labelledby');
      const labelled = labelledBy
        ?.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(' ');
      return element.getAttribute('aria-label')
        || labelled
        || element.getAttribute('placeholder')
        || element.textContent?.replace(/\s+/g, ' ').trim()
        || element.tagName.toLowerCase();
    };
    const regionOf = (element) => {
      if (element.closest('.top-strip')) return 'top';
      if (element.closest('.rail-links-scroll')) return 'quick-links';
      if (element.closest('.active-region')) return 'active';
      if (element.closest('.saved-region')) return 'saved';
      if (element.closest('.rail-utilities')) return 'auxiliary';
      return 'unmapped';
    };
    const focusable = [...document.querySelectorAll(selector)].filter((element) => {
      if (!(element instanceof HTMLElement) || element.closest('[inert]')) return false;
      const style = getComputedStyle(element);
      return element.getClientRects().length > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden';
    });
    focusable.forEach((element, index) => {
      element.dataset.uiAuditFocusIndex = String(index);
      element.dataset.uiAuditFocusName = nameOf(element);
      element.dataset.uiAuditFocusRegion = regionOf(element);
    });
    document.body.tabIndex = -1;
    document.body.focus();
    return focusable.length;
  })()`);

  const focusTrace: Array<Record<string, unknown>> = [];
  let tabSequenceComplete = focusableCount > 0 ? 1 : 0;
  for (let index = 0; index < focusableCount; index += 1) {
    await dispatchKey(cdp, sessionId, 'Tab');
    const step = await evaluate<{
      actualIndex: number;
      name: string;
      region: string;
    }>(cdp, sessionId, String.raw`(() => {
      const active = document.activeElement;
      return {
        actualIndex: Number(active?.getAttribute('data-ui-audit-focus-index') ?? -1),
        name: active?.getAttribute('data-ui-audit-focus-name') ?? '',
        region: active?.getAttribute('data-ui-audit-focus-region') ?? 'unmapped',
      };
    })()`);
    if (step.actualIndex !== index) tabSequenceComplete = 0;
    focusTrace.push({ step: 'tab', expectedIndex: index, ...step });
  }

  const focusRegionSequence = focusTrace
    .map((step) => String(step.region))
    .filter((region) => region !== 'unmapped')
    .filter((region, index, regions) => region !== regions[index - 1])
    .join('|');
  await evaluate(cdp, sessionId, String.raw`(() => {
    for (const element of document.querySelectorAll('[data-ui-audit-focus-index]')) {
      delete element.dataset.uiAuditFocusIndex;
      delete element.dataset.uiAuditFocusName;
      delete element.dataset.uiAuditFocusRegion;
    }
    document.body.removeAttribute('tabindex');
    return true;
  })()`);

  await focusAndClickButton(cdp, sessionId, 'Edit quick links');
  await focusAndClickButton(cdp, sessionId, 'Add quick link', 'uiAuditQuickLinkTrigger');
  const quickLinkOpen = await evaluate<{
    focusInside: boolean;
    portal: boolean;
    rootInert: boolean;
  }>(cdp, sessionId, String.raw`(() => {
    const backdrops = [...document.querySelectorAll('.dialog-backdrop')];
    const backdrop = backdrops.at(-1);
    const surface = backdrop?.querySelector('[role="dialog"]');
    return {
      focusInside: surface?.contains(document.activeElement) ?? false,
      portal: backdrop?.parentElement === document.body,
      rootInert: document.querySelector('#root')?.hasAttribute('inert') ?? false,
    };
  })()`);
  const trapPrepared = await evaluate<boolean>(cdp, sessionId, String.raw`(() => {
    const surface = [...document.querySelectorAll('[role="dialog"]')].at(-1);
    if (!(surface instanceof HTMLElement)) return false;
    const selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const focusable = [...surface.querySelectorAll(selector)].filter((element) =>
      element instanceof HTMLElement && element.getClientRects().length > 0
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement)) return false;
    first.dataset.uiAuditTrapFirst = 'true';
    last.focus();
    return true;
  })()`);
  await dispatchKey(cdp, sessionId, 'Tab');
  const focusWrapped = await evaluate<boolean>(cdp, sessionId, String.raw`(() => (
    document.activeElement?.getAttribute('data-ui-audit-trap-first') === 'true'
  ))()`);
  await dispatchKey(cdp, sessionId, 'Escape');
  await waitForDomQuiet(cdp, sessionId);
  const quickLinkClosed = await evaluate<{
    dialogClosed: boolean;
    focusRestored: boolean;
    rootRestored: boolean;
  }>(cdp, sessionId, String.raw`(() => {
    const trigger = document.querySelector('[data-ui-audit-quick-link-trigger="true"]');
    const result = {
      dialogClosed: document.querySelector('.dialog-backdrop') === null,
      focusRestored: document.activeElement === trigger,
      rootRestored: !(document.querySelector('#root')?.hasAttribute('inert') ?? false),
    };
    trigger?.removeAttribute('data-ui-audit-quick-link-trigger');
    return result;
  })()`);
  const quickLinkChecks = {
    ...quickLinkOpen,
    trapPrepared,
    focusWrapped,
    ...quickLinkClosed,
  };
  const quickLinkModalIsolationFailures = Object.values(quickLinkChecks)
    .filter((passed) => !passed).length;

  await focusAndClickButton(cdp, sessionId, 'Extra');
  await focusAndClickButton(cdp, sessionId, 'Add todo');
  const nested = await evaluate<{
    focusInTopModal: number;
    lowerModalInert: number;
    modalPortaledCount: number;
    rootInertDuringModal: number;
    topModalInteractive: number;
  }>(cdp, sessionId, String.raw`(() => {
    const backdrops = [...document.querySelectorAll('.dialog-backdrop')];
    const top = backdrops.at(-1);
    const topSurface = top?.querySelector('[role="dialog"]');
    return {
      modalPortaledCount: backdrops.filter((backdrop) => backdrop.parentElement === document.body).length,
      rootInertDuringModal: document.querySelector('#root')?.hasAttribute('inert') ? 1 : 0,
      lowerModalInert: backdrops.length === 2 && backdrops[0]?.hasAttribute('inert') ? 1 : 0,
      topModalInteractive: top && !top.hasAttribute('inert') ? 1 : 0,
      focusInTopModal: topSurface?.contains(document.activeElement) ? 1 : 0,
    };
  })()`);

  return {
    focusRegionSequence,
    tabSequenceComplete,
    quickLinkModalIsolationFailures,
    ...nested,
    trace: [
      ...focusTrace,
      { step: 'quick-link-modal', ...quickLinkChecks },
      { step: 'nested-extra-todo', ...nested },
    ],
  };
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

    const feedbackFixtureId = auditCase.feedbackFixture ?? 'none';
    const feedbackFixture = feedbackFixtureId === 'none'
      ? null
      : feedbackFixtures[feedbackFixtureId];
    if (feedbackFixture) {
      await evaluate(cdp, sessionId, String.raw`(() => {
        const stage = document.querySelector('.newtab-stage');
        const workspace = stage?.querySelector(':scope > .v2-workspace');
        if (!(stage instanceof HTMLElement) || !(workspace instanceof HTMLElement)) {
          throw new Error('FINDING-004 fixture requires the production New Tab stage and workspace');
        }
        if (stage.querySelector(':scope > .newtab-feedback')) {
          throw new Error('FINDING-004 fixture requires an initially empty feedback row');
        }
        const fixture = ${JSON.stringify(feedbackFixture)};
        const feedback = document.createElement('p');
        feedback.className = 'newtab-feedback status-message status-message--' + fixture.tone;
        feedback.dataset.uiAuditFixture = ${JSON.stringify(feedbackFixtureId)};
        feedback.setAttribute('aria-live', fixture.tone === 'error' ? 'assertive' : 'polite');
        feedback.setAttribute('role', fixture.tone === 'error' ? 'alert' : 'status');
        feedback.textContent = fixture.message;
        stage.insertBefore(feedback, workspace);
        return true;
      })()`);
      await waitForDomQuiet(cdp, sessionId);
    }

    const interactionFixtureId = auditCase.interactionFixture ?? 'none';
    const interaction: Finding006Interaction = interactionFixtureId === 'finding-006'
      ? await runFinding006Interaction(cdp, sessionId)
      : {
          focusRegionSequence: '',
          tabSequenceComplete: 0,
          quickLinkModalIsolationFailures: 0,
          modalPortaledCount: 0,
          rootInertDuringModal: 0,
          lowerModalInert: 0,
          topModalInteractive: 0,
          focusInTopModal: 0,
          trace: [],
        };

    const observation = await evaluate<RuntimeObservation>(cdp, sessionId, String.raw`(async () => {
      const auditPage = ${JSON.stringify(auditCase.page)};
      const interaction = ${JSON.stringify(interaction)};
      const sha256 = async (path) => {
        const response = await fetch(chrome.runtime.getURL(path), { cache: 'no-store' });
        if (!response.ok) throw new Error('Could not read runtime resource: ' + path);
        const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
        return [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
      };
      const root = document.querySelector('#root');
      const feedbackElements = [...document.querySelectorAll('.newtab-feedback')];
      const feedback = feedbackElements[0];
      const workspace = document.querySelector('.v2-workspace');
      const saved = document.querySelector('.saved-region');
      const topStrip = document.querySelector('.top-strip');
      const feedbackRect = feedback?.getBoundingClientRect();
      const workspaceRect = workspace?.getBoundingClientRect();
      const savedRect = saved?.getBoundingClientRect();
      const topStripRect = topStrip?.getBoundingClientRect();
      const overlapArea = (left, right) => {
        if (!left || !right) return 0;
        const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
        const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
        return Math.round(width * height);
      };
      const feedbackLineCount = (() => {
        if (!feedback || !feedback.textContent) return 0;
        const range = document.createRange();
        range.selectNodeContents(feedback);
        return new Set(
          [...range.getClientRects()]
            .filter((rect) => rect.width > 0 && rect.height > 0)
            .map((rect) => Math.round(rect.top * 2) / 2),
        ).size;
      })();
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
          feedbackCount: feedbackElements.length,
          feedbackWorkspaceOverlapAreaPx2: overlapArea(feedbackRect, workspaceRect),
          feedbackSavedOverlapAreaPx2: overlapArea(feedbackRect, savedRect),
          feedbackViewportOverflowPx: feedbackRect
            ? Math.ceil(
                Math.max(0, -feedbackRect.left)
                + Math.max(0, feedbackRect.right - innerWidth)
                + Math.max(0, -feedbackRect.top)
                + Math.max(0, feedbackRect.bottom - innerHeight)
              )
            : 0,
          feedbackLineCount,
          topWorkspaceGapPx: topStripRect && workspaceRect
            ? Math.round((workspaceRect.top - topStripRect.bottom) * 100) / 100
            : 0,
          focusRegionSequence: interaction.focusRegionSequence,
          tabSequenceComplete: interaction.tabSequenceComplete,
          quickLinkModalIsolationFailures: interaction.quickLinkModalIsolationFailures,
          modalPortaledCount: interaction.modalPortaledCount,
          rootInertDuringModal: interaction.rootInertDuringModal,
          lowerModalInert: interaction.lowerModalInert,
          topModalInteractive: interaction.topModalInteractive,
          focusInTopModal: interaction.focusInTopModal,
        },
        interactionTrace: interaction.trace,
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
          feedbackFixture: feedbackFixtureId,
          interactionFixture: interactionFixtureId,
        },
        setup: auditCase.setup,
        cleanup: auditCase.cleanup,
      },
      observed: {
        metrics: observation.metrics,
        interactionTrace: observation.interactionTrace,
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
