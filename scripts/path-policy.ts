import { isAbsolute, relative, sep, win32 } from 'node:path';

const QUOTED_FILE_URL = /(["'`])file:(?:\\?\/){2,3}[^"'`\r\n]*\1/gi;
const FILE_URL = /file:(?:\\?\/){2,3}[^\r\n]*/gi;
const ANSI_ESCAPE = /\u001B\[[0-?]*[ -/]*[@-~]/g;
const QUOTED_VALUE = /(["'`])([^"'`\r\n]+)\1/g;
const SOURCE_LOCATION = /^(.*?)(:\d+(?::\d+)?)$/;
const TOKEN_END = /[\s"'`]/;
const DRIVE_RELATIVE_SEGMENT = String.raw`[^\s"'\u0060/\\]+`;
const DRIVE_RELATIVE_SEPARATOR = String.raw`(?:\\+|/)`;
const DRIVE_RELATIVE_END = String.raw`(?=$|[\s"'\u0060)\]},;:])`;
const DRIVE_RELATIVE_EXTENSIONS = String.raw`(?:avif|bmp|cjs|css|csv|cts|gif|html?|ico|jpe?g|js|json|jsx|lock|log|map|md|mdx|mjs|mts|pdf|png|svg|toml|ts|tsx|txt|wasm|webp|ya?ml|zip)`;
const DRIVE_RELATIVE_MULTI_SOURCE = String.raw`(^|[^A-Za-z0-9._/\\])([A-Za-z]:(?![\\/\s])(?:${DRIVE_RELATIVE_SEGMENT}${DRIVE_RELATIVE_SEPARATOR})+${DRIVE_RELATIVE_SEGMENT})`;
const DRIVE_RELATIVE_SINGLE_SOURCE = String.raw`(^|["'\u0060])([A-Za-z]:(?![\\/\s])${DRIVE_RELATIVE_SEGMENT}\.${DRIVE_RELATIVE_EXTENSIONS})${DRIVE_RELATIVE_END}`;
const DRIVE_RELATIVE_LABELED_SOURCE = String.raw`(\b(?:cwd|directory|file|output|path|root)\s*[:=]\s*)([A-Za-z]:(?![\\/\s])${DRIVE_RELATIVE_SEGMENT})${DRIVE_RELATIVE_END}`;
const DRIVE_RELATIVE_QUOTED_DIRECTORY_SOURCE = String.raw`(["'\u0060])([C-Z]:(?![\\/\s])${DRIVE_RELATIVE_SEGMENT})${DRIVE_RELATIVE_END}`;
const DRIVE_RELATIVE_MULTI = new RegExp(DRIVE_RELATIVE_MULTI_SOURCE, 'im');
const DRIVE_RELATIVE_SINGLE = new RegExp(DRIVE_RELATIVE_SINGLE_SOURCE, 'im');
const DRIVE_RELATIVE_LABELED = new RegExp(DRIVE_RELATIVE_LABELED_SOURCE, 'im');
const DRIVE_RELATIVE_QUOTED_DIRECTORY = new RegExp(
  DRIVE_RELATIVE_QUOTED_DIRECTORY_SOURCE,
  'm',
);

function normalizeEscapedPathSeparators(value: string): string {
  return value
    .replace(/\\\//g, '/')
    .replace(/\\\\/g, '\\');
}

export function hasDriveRelativeFilesystemPath(value: string): boolean {
  return DRIVE_RELATIVE_MULTI.test(value)
    || DRIVE_RELATIVE_SINGLE.test(value)
    || DRIVE_RELATIVE_LABELED.test(value)
    || DRIVE_RELATIVE_QUOTED_DIRECTORY.test(value);
}

function redactDriveRelativePaths(value: string): string {
  return [
    new RegExp(DRIVE_RELATIVE_MULTI_SOURCE, 'gim'),
    new RegExp(DRIVE_RELATIVE_SINGLE_SOURCE, 'gim'),
    new RegExp(DRIVE_RELATIVE_LABELED_SOURCE, 'gim'),
    new RegExp(DRIVE_RELATIVE_QUOTED_DIRECTORY_SOURCE, 'gm'),
  ].reduce(
    (sanitized, pattern) => sanitized.replace(
      pattern,
      (_match, prefix: string) => `${prefix}[path]`,
    ),
    value,
  );
}

export function isAbsoluteFilesystemPath(value: string): boolean {
  return isAbsolute(value) || win32.isAbsolute(value);
}

function splitSourceLocation(value: string): { path: string; location: string } {
  const match = SOURCE_LOCATION.exec(value);
  if (match?.[1] && isAbsoluteFilesystemPath(match[1])) {
    return { path: match[1], location: match[2] ?? '' };
  }
  return { path: value, location: '' };
}

function splitAbsolutePathCandidate(value: string): { path: string; location: string } {
  const candidate = splitSourceLocation(value);
  return isAbsoluteFilesystemPath(candidate.path)
    ? candidate
    : splitSourceLocation(normalizeEscapedPathSeparators(value));
}

function isPathBoundary(value: string, index: number): boolean {
  if (index === 0) return true;
  return !/[A-Za-z0-9._/\\]/.test(value[index - 1] ?? '');
}

function findAbsolutePathStart(value: string, fromIndex = 0): number {
  for (let index = fromIndex; index < value.length; index += 1) {
    if (!isPathBoundary(value, index)) continue;
    const remaining = value.slice(index);
    if (/^[A-Za-z]:[\\/]/.test(remaining) || remaining.startsWith('\\\\')) return index;
    if (remaining.startsWith('//') && value[index - 1] !== ':') return index;
    if (remaining.startsWith('/') && !remaining.startsWith('//')) return index;
    const normalizedRemaining = normalizeEscapedPathSeparators(remaining);
    if (/^[A-Za-z]:[\\/]/.test(normalizedRemaining)
      || normalizedRemaining.startsWith('\\\\')) return index;
    if (normalizedRemaining.startsWith('//') && value[index - 1] !== ':') return index;
    if (normalizedRemaining.startsWith('/') && !normalizedRemaining.startsWith('//')) return index;
  }
  return -1;
}

function redactUnquotedAbsolutePaths(value: string): string {
  return value.split('\n').map((line) => {
    let sanitized = line;
    let searchFrom = 0;
    while (searchFrom < sanitized.length) {
      const pathStart = findAbsolutePathStart(sanitized, searchFrom);
      if (pathStart < 0) break;
      const remainder = sanitized.slice(pathStart);
      const whitespaceIndex = remainder.search(/\s/);
      if (whitespaceIndex >= 0) {
        const candidate = remainder.slice(0, whitespaceIndex);
        const { path, location } = splitAbsolutePathCandidate(candidate);
        if (!isAbsoluteFilesystemPath(path)) {
          searchFrom = pathStart + 1;
          continue;
        }
        const suffix = remainder.slice(whitespaceIndex);
        const nextToken = suffix.trimStart().split(/\s/)[0] ?? '';
        const pathSeparatorCount = path.match(/[\\/]/g)?.length ?? 0;
        const basename = path.split(/[\\/]/).at(-1) ?? '';
        const nextTokenLooksLikePathContinuation = /[\\/]/.test(nextToken)
          || (!basename.includes('.') && nextToken.includes('.'));
        const pathClearlyEndsAtWhitespace = !nextTokenLooksLikePathContinuation
          && (pathSeparatorCount >= 2 || basename.includes('.'));
        if (!pathClearlyEndsAtWhitespace) {
          sanitized = `${sanitized.slice(0, pathStart)}[path]`;
          break;
        }
        sanitized = `${sanitized.slice(0, pathStart)}[path]${location}${suffix}`;
        searchFrom = pathStart + '[path]'.length + location.length;
        continue;
      }
      const tokenEnd = remainder.search(TOKEN_END);
      const candidate = tokenEnd < 0 ? remainder : remainder.slice(0, tokenEnd);
      const { path, location } = splitAbsolutePathCandidate(candidate);
      if (!isAbsoluteFilesystemPath(path)) {
        searchFrom = pathStart + 1;
        continue;
      }
      const suffix = tokenEnd < 0 ? '' : remainder.slice(tokenEnd);
      sanitized = `${sanitized.slice(0, pathStart)}[path]${location}${suffix}`;
      searchFrom = pathStart + '[path]'.length + location.length;
    }
    return sanitized;
  }).join('\n');
}

export function sanitizeFilesystemPaths(value: unknown): string {
  const message = String(value ?? '')
    .replace(ANSI_ESCAPE, '')
    .replace(QUOTED_FILE_URL, (_fullValue, quote: string) => `${quote}[path]${quote}`)
    .replace(FILE_URL, '[path]');
  const sanitizedQuotedValues = message.replace(
    QUOTED_VALUE,
    (fullValue, quote: string, candidate: string) => {
      const { path, location } = splitAbsolutePathCandidate(candidate);
      if (isAbsoluteFilesystemPath(path)) return `${quote}[path]${location}${quote}`;
      const sanitizedCandidate = redactDriveRelativePaths(
        redactUnquotedAbsolutePaths(candidate),
      );
      return sanitizedCandidate === candidate
        ? fullValue
        : `${quote}${sanitizedCandidate}${quote}`;
    },
  );
  return redactDriveRelativePaths(redactUnquotedAbsolutePaths(sanitizedQuotedValues));
}

export function toRelativeDisplayPath(baseDirectory: string, targetPath: string): string {
  const displayPath = relative(baseDirectory, targetPath);
  if (displayPath === '..'
    || displayPath.startsWith(`..${sep}`)
    || isAbsoluteFilesystemPath(displayPath)) return '[path]';
  return displayPath.split(sep).join('/') || '.';
}

export function reportFatalPathSafeError(error: unknown): never {
  const message = error instanceof Error ? error.message : error;
  console.error(sanitizeFilesystemPaths(message));
  process.exit(1);
}
