#!/usr/bin/env bun

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  reportFatalPathSafeError,
  sanitizeFilesystemPaths,
  toRelativeDisplayPath,
} from '../../../../scripts/path-policy';

process.once('uncaughtException', reportFatalPathSafeError);
process.once('unhandledRejection', reportFatalPathSafeError);

function readOption(name: string, fallback?: string): string | undefined {
  const equalsPrefix = `--${name}=`;
  const equalsValue = Bun.argv.find((argument) => argument.startsWith(equalsPrefix));
  if (equalsValue) return equalsValue.slice(equalsPrefix.length);

  const index = Bun.argv.indexOf(`--${name}`);
  if (index >= 0) return Bun.argv[index + 1];
  return fallback;
}

async function forwardSanitizedOutput(
  stream: ReadableStream<Uint8Array>,
  destination: { write: (chunk: string) => unknown },
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        destination.write(`${sanitizeFilesystemPaths(line.replace(/\r$/, ''))}\n`);
      }
      if (done) break;
    }
    if (pending) destination.write(sanitizeFilesystemPaths(pending));
  } finally {
    reader.releaseLock();
  }
}

const root = resolve(readOption('root', 'apps/extension')!);

const portText = readOption('port', '9333')!;
const port = Number(portText);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error(`Invalid CDP port: ${portText}`);
}

const devPortText = readOption('dev-port', '3001')!;
const devPort = Number(devPortText);
if (!Number.isInteger(devPort) || devPort < 1024 || devPort > 65535) {
  throw new Error(`Invalid WXT dev-server port: ${devPortText}`);
}

const profile = resolve(readOption('profile', `${root}/.wxt/cdp-profile`)!);
await mkdir(profile, { recursive: true });

try {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
    signal: AbortSignal.timeout(500),
  });
  if (response.ok) {
    throw new Error(`A CDP browser is already listening on 127.0.0.1:${port}`);
  }
} catch (error) {
  if (error instanceof Error && error.message.includes('already listening')) throw error;
}

const serverCode = String.raw`
import { createServer } from 'wxt';

const port = process.env.WXT_CDP_PORT;
const devPort = Number(process.env.WXT_DEV_PORT);
const profile = process.env.WXT_CDP_PROFILE;
if (!port || !devPort || !profile) throw new Error('Missing WXT CDP launch environment');

const server = await createServer({
  root: process.cwd(),
  browser: 'chrome',
  dev: {
    server: {
      port: devPort,
      strictPort: true,
    },
  },
  webExt: {
    chromiumProfile: profile,
    keepProfileChanges: true,
    chromiumArgs: [
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=' + port,
    ],
    startUrls: ['chrome://newtab/'],
  },
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.stop();
  process.exit(0);
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
await server.start();
console.log('[debug-wxt-cdp] ready on http://127.0.0.1:' + port);
await new Promise(() => {});
`;

console.log(`[debug-wxt-cdp] root: ${toRelativeDisplayPath(process.cwd(), root)}`);
console.log(`[debug-wxt-cdp] profile: ${toRelativeDisplayPath(process.cwd(), profile)}`);
console.log(`[debug-wxt-cdp] endpoint: http://127.0.0.1:${port}`);
console.log(`[debug-wxt-cdp] WXT dev server: http://localhost:${devPort}`);

const child = Bun.spawn([process.execPath, '--eval', serverCode], {
  cwd: root,
  env: {
    ...process.env,
    WXT_CDP_PORT: String(port),
    WXT_DEV_PORT: String(devPort),
    WXT_CDP_PROFILE: profile,
  },
  stdin: 'inherit',
  stdout: 'pipe',
  stderr: 'pipe',
});
const outputForwarding = Promise.all([
  forwardSanitizedOutput(child.stdout, process.stdout),
  forwardSanitizedOutput(child.stderr, process.stderr),
]).catch(reportFatalPathSafeError);

let forwardingSignal = false;
function forward(signal: 'SIGINT' | 'SIGTERM') {
  if (forwardingSignal) return;
  forwardingSignal = true;
  child.kill(signal);
}

process.once('SIGINT', () => forward('SIGINT'));
process.once('SIGTERM', () => forward('SIGTERM'));

const exitCode = await child.exited;
await outputForwarding;
process.exitCode = exitCode;
