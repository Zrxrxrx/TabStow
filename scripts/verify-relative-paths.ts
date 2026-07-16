#!/usr/bin/env bun

import { lstat, readFile, readlink } from 'node:fs/promises';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import {
  ScriptKind,
  ScriptTarget,
  createSourceFile,
  forEachChild,
  isNoSubstitutionTemplateLiteral,
  isRegularExpressionLiteral,
  isTaggedTemplateExpression,
  type Node,
} from 'typescript';

import {
  hasDriveRelativeFilesystemPath,
  isAbsoluteFilesystemPath,
} from './path-policy';

export type AbsolutePathReference = {
  file: string;
  line: number;
};

const POSIX_FILESYSTEM_ROOTS = [
  'Applications',
  'Library',
  'Network',
  'System',
  'Users',
  'Volumes',
  'bin',
  'boot',
  'build',
  'builds',
  'data',
  'dev',
  'etc',
  'home',
  'lib',
  'lib64',
  'media',
  'mnt',
  'opt',
  'path',
  'private',
  'proc',
  'repo',
  'root',
  'run',
  'sbin',
  'srv',
  'sys',
  'tmp',
  'usr',
  'var',
  'workspace',
  'workspaces',
].join('|');

const PATH_BOUNDARY = String.raw`(?:^|[^A-Za-z0-9._/\\])`;
const WINDOWS_SEPARATOR = String.raw`[\\/]`;
const GENERIC_PATH_SEGMENT = String.raw`[^\s"'\u0060()\[\]{}?#/\\<>;*+^|]+`;
const UNC_HOST_SEGMENT = String.raw`[^\s"'\u0060()/\\[\]{}?#<>:;*+^|]+`;
const PATH_END = String.raw`(?=$|[\s"'\u0060)\]\},;:])`;
const ROOT_PATH_SEGMENT = String.raw`[^\s"'\u0060/\\()[\]{}<>:;|*+?^=!@#%&]+`;
const ROOT_PATH_END = String.raw`(?=$|[\s"'\u0060()[\]{}<>:;|*+?^=!@#%&])`;
const POSIX_ABSOLUTE_PATH = new RegExp(
  `${PATH_BOUNDARY}/(?:${POSIX_FILESYSTEM_ROOTS})/`,
);
const GENERIC_POSIX_ABSOLUTE_PATH = new RegExp(
  `${PATH_BOUNDARY}/(?!/)(?:${GENERIC_PATH_SEGMENT}/)+${GENERIC_PATH_SEGMENT}${PATH_END}`,
);
const ROOT_POSIX_ABSOLUTE_PATH = new RegExp(
  `${PATH_BOUNDARY}/${ROOT_PATH_SEGMENT}${ROOT_PATH_END}`,
);
const WINDOWS_ABSOLUTE_PATH = new RegExp(
  `${PATH_BOUNDARY}[A-Za-z]:${WINDOWS_SEPARATOR}(?:${POSIX_FILESYSTEM_ROOTS})${WINDOWS_SEPARATOR}`,
);
const GENERIC_WINDOWS_BACKSLASH_PATH = new RegExp(
  `${PATH_BOUNDARY}[A-Za-z]:\\\\(?:${GENERIC_PATH_SEGMENT}\\\\)*${GENERIC_PATH_SEGMENT}${PATH_END}`,
);
const GENERIC_WINDOWS_FORWARD_SLASH_PATH = new RegExp(
  `${PATH_BOUNDARY}[A-Za-z]:/(?:${GENERIC_PATH_SEGMENT}/)*${GENERIC_PATH_SEGMENT}${PATH_END}`,
);
const UNC_ABSOLUTE_PATH = new RegExp(
  `${PATH_BOUNDARY}(?:\\\\{2,}|/{2})${UNC_HOST_SEGMENT}${WINDOWS_SEPARATOR}(?:${GENERIC_PATH_SEGMENT}${WINDOWS_SEPARATOR})*${GENERIC_PATH_SEGMENT}${PATH_END}`,
);
const WINDOWS_DEVICE_PATH = new RegExp(
  `${PATH_BOUNDARY}(?:\\\\{2,}|/{2})[?.]${WINDOWS_SEPARATOR}(?:${GENERIC_PATH_SEGMENT}${WINDOWS_SEPARATOR})*${GENERIC_PATH_SEGMENT}${PATH_END}`,
);
const HOME_ALIAS_PATH = new RegExp(
  `${PATH_BOUNDARY}(?:~|\\$(?:HOME|\\{HOME\\})|%USERPROFILE%)${WINDOWS_SEPARATOR}`,
);
const NON_FILE_URI = /\b(?:(?!file:)[A-Za-z][A-Za-z0-9+.-]+:\/\/|(?:about|data|javascript):)[^\s"'`)]*/gi;
const INTEGRITY_HASH = /sha(?:256|384|512)-[A-Za-z0-9+/=]+/g;
const PROJECT_IMPORT = /@\/(?:components|db|entrypoints|features|lib|styles)\//g;
const INTERPOLATED_PATH = /(?:\$\([^)]+\)|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)(?:[\\/][^\s"'`)]*)+/g;
const ANGLE_PLACEHOLDER_PATH = /<[A-Za-z0-9_-]+>\/[A-Za-z0-9._/-]+/g;
const INLINE_CODE_COMPOUND = /`[^`\r\n]+`\/[A-Za-z0-9._-]+/g;
const HTML_CLOSING_TAG = /<\/[A-Za-z][A-Za-z0-9:.-]*\s*>/g;
const CSS_FUNCTION_DIVISION = /\bvar\([^)\r\n]+\)\/var\([^)\r\n]+\)/g;
const JAVASCRIPT_LIKE_FILE = /\.(?:[cm]?[jt]sx?)$/i;
const HTML_LIKE_FILE = /\.html?$/i;
const MARKDOWN_LIKE_FILE = /\.mdx?$/i;
const GITHUB_API_ROUTE = /\/repos\/\$GITHUB_REPOSITORY\/releases\/tags\/\$TAG/g;
const CDP_ROUTE = /\/json\/(?:list|version)\b/g;
const ROOT_WEB_ROUTE = /\/(?:[a-z0-9][a-z0-9-]*\.html|home|user)(?=$|[\s"'`),\]}])/g;
const APPROVED_SLASH_COMMAND = /`\/(?:codex review|plan-(?:ceo|design|devex|eng)-review)`/g;
const FILE_URL = /file:\/\/(?=[^\s"'`)])[^\s"'`)]*/gi;
const FILE_URL_REFERENCE = /file:\/\/(?=[^\s"'`)])[^\s"'`)]*/i;
const RAW_HOME_ALIAS_PATH = /(?:^|[\s=:("'\x60])(?:~|\$(?:HOME|\{HOME\})|%USERPROFILE%)[\\/]/;
const APPROVED_FILE_URL_PREFIX = ['file:', '', '', 'tmp', ''].join('/');
const APPROVED_FILE_URL_SUFFIX = /^[a-zA-Z0-9._/-]+$/;
const FILE_URL_FIXTURE_FILES = new Set([
  'apps/extension/src/components/TabFavicon.test.tsx',
  'apps/extension/src/features/tabs/session-service.test.ts',
]);
const APPROVED_SHEBANG = /^#!(?:\/usr\/bin\/env (?:bash|bun|node|python3?)|\/bin\/(?:bash|sh))$/;
const QUOTED_VALUE = /(["'`])([^"'`\r\n]+)\1/g;
const APPROVED_ROOT_WEB_ROUTE = /^\/(?:[a-z0-9][a-z0-9-]*\.html|home|user)$/;
const APPROVED_NON_FILESYSTEM_REGEX_SOURCES = new Set([
  CSS_FUNCTION_DIVISION.source,
  GITHUB_API_ROUTE.source,
  CDP_ROUTE.source,
  APPROVED_SHEBANG.source,
]);
const JAVASCRIPT_MIME_TYPES = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
]);
const JAVASCRIPT_FENCE_LANGUAGES = new Set([
  'cjs',
  'cts',
  'javascript',
  'js',
  'jsx',
  'mjs',
  'mts',
  'ts',
  'tsx',
  'typescript',
]);

function isApprovedFileUrl(value: string): boolean {
  return value.toLowerCase().startsWith(APPROVED_FILE_URL_PREFIX)
    && APPROVED_FILE_URL_SUFFIX.test(value.slice(APPROVED_FILE_URL_PREFIX.length));
}

function isQuotedUncPath(candidate: string): boolean {
  return candidate.startsWith('\\\\')
    && candidate.split(/\\+/).filter(Boolean).length >= 2;
}

function hasQuotedAbsoluteFilesystemPath(value: string): boolean {
  return [...value.matchAll(QUOTED_VALUE)].some((match) => {
    const candidate = match[2] ?? '';
    if (!isAbsoluteFilesystemPath(candidate) || APPROVED_ROOT_WEB_ROUTE.test(candidate)) {
      return false;
    }
    return /^[A-Za-z]:[\\/].+/.test(candidate)
      || isQuotedUncPath(candidate)
      || (
        candidate.length > 1
        && candidate.startsWith('/')
        && !/[\/\\\s()[\]{}<>:;|*+?^=!@#%&]/.test(candidate.slice(1))
      )
      || (
        candidate.startsWith('/')
        && candidate.slice(1).includes('/')
        && candidate.includes(' ')
        && !/[<>=]/.test(candidate)
      );
  });
}

function hasUnquotedSpacedPosixPath(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '/'
      || value[index + 1] === '/'
      || /[\s"'`/\\()[\]{}<>:;|]/.test(value[index + 1] ?? '')) {
      continue;
    }
    if (index > 0 && /[A-Za-z0-9._/\\]/.test(value[index - 1] ?? '')) continue;
    const candidate = value.slice(index).split(/["'`<>\r\n]/, 1)[0] ?? '';
    const firstSpace = candidate.search(/\s/);
    if (firstSpace < 0) continue;
    const nextToken = candidate.slice(firstSpace).trimStart().split(/\s/)[0] ?? '';
    if (/^[^\\/\s]+\/[^\\/\s"'`<>]+/.test(nextToken)) return true;
  }
  return false;
}

function containsUnescapedFilesystemPathSyntax(value: string): boolean {
  return RAW_HOME_ALIAS_PATH.test(value)
    || HOME_ALIAS_PATH.test(value)
    || FILE_URL_REFERENCE.test(value)
    || hasQuotedAbsoluteFilesystemPath(value)
    || hasUnquotedSpacedPosixPath(value)
    || POSIX_ABSOLUTE_PATH.test(value)
    || GENERIC_POSIX_ABSOLUTE_PATH.test(value)
    || ROOT_POSIX_ABSOLUTE_PATH.test(value)
    || WINDOWS_ABSOLUTE_PATH.test(value)
    || GENERIC_WINDOWS_BACKSLASH_PATH.test(value)
    || GENERIC_WINDOWS_FORWARD_SLASH_PATH.test(value)
    || hasDriveRelativeFilesystemPath(value)
    || UNC_ABSOLUTE_PATH.test(value)
    || WINDOWS_DEVICE_PATH.test(value);
}

function normalizeEscapedPathSeparators(value: string): string {
  return value
    .replace(/\\\//g, '/')
    .replace(/\\\\/g, '\\')
    .replace(/(^|[^:])\/{2}/g, '$1/');
}

function containsFilesystemPathSyntax(value: string): boolean {
  if (containsUnescapedFilesystemPathSyntax(value)) return true;
  const normalizedValue = normalizeEscapedPathSeparators(value);
  return normalizedValue !== value
    && containsUnescapedFilesystemPathSyntax(normalizedValue);
}

function regexLiteralFragments(body: string): string[] {
  const fragments: string[] = [];
  let fragment = '';

  function flush(): void {
    if (fragment !== '') fragments.push(fragment);
    fragment = '';
  }

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] ?? '';
    if (character === '\\') {
      const escaped = body[index + 1] ?? '';
      if (escaped !== '' && !/[0-9A-Za-z]/.test(escaped)) {
        fragment += escaped;
      } else {
        flush();
      }
      index += 1;
      continue;
    }
    if (/[\^$.*+?()[\]{}|]/.test(character)) {
      flush();
      continue;
    }
    fragment += character;
  }
  flush();
  return fragments;
}

function regexContainsConcreteFilesystemPath(body: string): boolean {
  if (APPROVED_NON_FILESYSTEM_REGEX_SOURCES.has(body)) return false;
  return regexLiteralFragments(body).some((fragment) => {
    if (containsFilesystemPathSyntax(fragment)) return true;
    const withoutTrailingSeparator = fragment.replace(/[\\/]+$/, '');
    return withoutTrailingSeparator !== fragment
      && containsFilesystemPathSyntax(withoutTrailingSeparator);
  });
}

function hasRegexSyntax(value: string): boolean {
  return /[\\^$*+?()[\]{}|]/.test(value);
}

type TextRange = {
  start: number;
  end: number;
};

type CodeRanges = {
  mask: TextRange[];
  paths: TextRange[];
};

function scriptKindForFile(file: string): ScriptKind {
  if (/\.[cm]?tsx$/i.test(file)) return ScriptKind.TSX;
  if (/\.[cm]?jsx$/i.test(file)) return ScriptKind.JSX;
  if (/\.[cm]?js$/i.test(file)) return ScriptKind.JS;
  return ScriptKind.TS;
}

function collectJavaScriptRanges(
  sourceText: string,
  file: string,
  baseOffset = 0,
): CodeRanges {
  const sourceFile = createSourceFile(
    file,
    sourceText,
    ScriptTarget.Latest,
    true,
    scriptKindForFile(file),
  );
  const ranges: CodeRanges = { mask: [], paths: [] };

  function addRange(target: TextRange[], node: Node): void {
    target.push({
      start: baseOffset + node.getStart(sourceFile),
      end: baseOffset + node.getEnd(),
    });
  }

  function visit(node: Node): void {
    if (isRegularExpressionLiteral(node)) {
      const literal = node.getText(sourceFile);
      const body = literal.slice(1, literal.lastIndexOf('/'));
      addRange(
        regexContainsConcreteFilesystemPath(body) ? ranges.paths : ranges.mask,
        node,
      );
    } else if (isTaggedTemplateExpression(node)
      && isNoSubstitutionTemplateLiteral(node.template)
      && node.tag.getText(sourceFile) === 'String.raw') {
      const rawValue = node.template.getText(sourceFile).slice(1, -1);
      if (hasRegexSyntax(rawValue)
        && !isAbsoluteFilesystemPath(rawValue)
        && !containsFilesystemPathSyntax(rawValue)) {
        addRange(ranges.mask, node.template);
      }
    }
    forEachChild(node, visit);
  }

  visit(sourceFile);
  return ranges;
}

function isJavaScriptScriptType(
  typeAttribute: string | undefined,
  languageAttribute: string | undefined,
): boolean {
  let type: string;
  if (typeAttribute === ''
    || (typeAttribute === undefined
      && (languageAttribute === undefined || languageAttribute === ''))) {
    type = 'text/javascript';
  } else if (typeAttribute !== undefined) {
    type = typeAttribute.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
  } else {
    type = `text/${languageAttribute}`;
  }
  const normalizedType = type.toLowerCase();
  return normalizedType === 'module' || JAVASCRIPT_MIME_TYPES.has(normalizedType);
}

function findHtmlScriptRanges(contents: string): TextRange[] {
  type HtmlNode = DefaultTreeAdapterMap['node'];
  type HtmlElement = DefaultTreeAdapterMap['element'];

  const ranges: TextRange[] = [];
  const document = parse(contents, {
    scriptingEnabled: true,
    sourceCodeLocationInfo: true,
  });

  function isElement(node: HtmlNode): node is HtmlElement {
    return 'tagName' in node;
  }

  function visit(node: HtmlNode): void {
    if (isElement(node) && node.tagName === 'script') {
      const type = node.attrs.find((attribute) => attribute.name === 'type')?.value;
      const language = node.attrs.find((attribute) => attribute.name === 'language')?.value;
      const hasSource = node.attrs.some((attribute) => attribute.name === 'src');
      const location = node.sourceCodeLocation;
      if (!hasSource && isJavaScriptScriptType(type, language) && location?.startTag) {
        ranges.push({
          start: location.startTag.endOffset,
          end: location.endTag?.startOffset ?? location.endOffset,
        });
      }
    }
    if ('childNodes' in node) {
      for (const child of node.childNodes) visit(child);
    }
    if ('content' in node) visit(node.content);
  }

  visit(document);
  return ranges;
}

function findMarkdownJavaScriptRanges(contents: string): TextRange[] {
  const ranges: TextRange[] = [];
  let openFence: {
    character: string;
    length: number;
    contentStart: number;
    isJavaScript: boolean;
  } | null = null;

  for (const match of contents.matchAll(/[^\r\n]*(?:\r\n|\n|$)/g)) {
    const rawLine = match[0];
    if (rawLine === '') continue;
    const line = rawLine.replace(/\r?\n$/, '');
    const lineStart = match.index;
    const fence = /^(?: {0,3})(`{3,}|~{3,})(.*)$/.exec(line);

    if (!openFence) {
      if (!fence) continue;
      const marker = fence[1] ?? '';
      const language = (fence[2] ?? '').trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
      openFence = {
        character: marker[0] ?? '',
        length: marker.length,
        contentStart: lineStart + rawLine.length,
        isJavaScript: JAVASCRIPT_FENCE_LANGUAGES.has(language),
      };
      continue;
    }

    if (!fence) continue;
    const marker = fence[1] ?? '';
    const trailing = fence[2] ?? '';
    if (marker[0] !== openFence.character
      || marker.length < openFence.length
      || trailing.trim() !== '') continue;
    if (openFence.isJavaScript) {
      ranges.push({ start: openFence.contentStart, end: lineStart });
    }
    openFence = null;
  }

  if (openFence?.isJavaScript) {
    ranges.push({ start: openFence.contentStart, end: contents.length });
  }
  return ranges;
}

function mergeCodeRanges(ranges: CodeRanges[]): CodeRanges {
  return {
    mask: ranges.flatMap((range) => range.mask),
    paths: ranges.flatMap((range) => range.paths),
  };
}

function collectCodeRanges(file: string, contents: string): CodeRanges {
  const ranges = JAVASCRIPT_LIKE_FILE.test(file)
    ? collectJavaScriptRanges(contents, file)
    : HTML_LIKE_FILE.test(file)
      ? mergeCodeRanges(findHtmlScriptRanges(contents).map((range, index) => (
        collectJavaScriptRanges(
          contents.slice(range.start, range.end),
          `inline-script-${index}.js`,
          range.start,
        )
      )))
      : MARKDOWN_LIKE_FILE.test(file)
        ? mergeCodeRanges(findMarkdownJavaScriptRanges(contents).map((range, index) => (
          collectJavaScriptRanges(
            contents.slice(range.start, range.end),
            `inline-markdown-${index}.tsx`,
            range.start,
          )
        )))
        : { mask: [], paths: [] };
  ranges.mask.sort((left, right) => left.start - right.start);
  ranges.paths.sort((left, right) => left.start - right.start);
  return ranges;
}

function maskTextRanges(value: string, offset: number, ranges: TextRange[]): string {
  const lineEnd = offset + value.length;
  let masked = '';
  let cursor = 0;

  for (const range of ranges) {
    if (range.end <= offset) continue;
    if (range.start >= lineEnd) break;
    const start = Math.max(0, range.start - offset);
    const end = Math.min(value.length, range.end - offset);
    if (end <= cursor) continue;
    masked += value.slice(cursor, start);
    masked += ' '.repeat(end - Math.max(start, cursor));
    cursor = end;
  }

  return `${masked}${value.slice(cursor)}`;
}

export function findAbsolutePathReferences(
  file: string,
  contents: string,
  maskCodeSyntax = true,
): AbsolutePathReference[] {
  const references: AbsolutePathReference[] = [];
  const codeRanges = maskCodeSyntax
    ? collectCodeRanges(file, contents)
    : { mask: [], paths: [] };
  let lineOffset = 0;

  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    if (line.startsWith('#!')) {
      if (!APPROVED_SHEBANG.test(line)) references.push({ file, line: index + 1 });
      lineOffset += line.length + (contents.startsWith('\r\n', lineOffset + line.length) ? 2 : 1);
      continue;
    }
    let searchableLine = maskTextRanges(line, lineOffset, codeRanges.mask);
    const lineEnd = lineOffset + line.length;
    const hasCodePath = codeRanges.paths.some(
      (range) => range.end > lineOffset && range.start < lineEnd,
    );
    if (FILE_URL_FIXTURE_FILES.has(file)) {
      searchableLine = searchableLine.replace(FILE_URL, (value) =>
        isApprovedFileUrl(value) ? ' '.repeat(value.length) : value);
    }
    searchableLine = searchableLine
      .replace(NON_FILE_URI, (value) => ' '.repeat(value.length))
      .replace(INTEGRITY_HASH, (value) => ' '.repeat(value.length))
      .replace(GITHUB_API_ROUTE, (value) => ' '.repeat(value.length))
      .replace(CDP_ROUTE, (value) => ' '.repeat(value.length))
      .replace(ROOT_WEB_ROUTE, (value) => ' '.repeat(value.length))
      .replace(APPROVED_SLASH_COMMAND, (value) => ' '.repeat(value.length))
      .replace(ANGLE_PLACEHOLDER_PATH, (value) => ' '.repeat(value.length))
      .replace(INLINE_CODE_COMPOUND, (value) => ' '.repeat(value.length))
      .replace(HTML_CLOSING_TAG, (value) => ' '.repeat(value.length))
      .replace(CSS_FUNCTION_DIVISION, (value) => ' '.repeat(value.length))
      .replace(PROJECT_IMPORT, (value) => ' '.repeat(value.length));
    const hasHomeAliasPath = HOME_ALIAS_PATH.test(searchableLine);
    searchableLine = searchableLine.replace(
      INTERPOLATED_PATH,
      (value) => ' '.repeat(value.length),
    );
    if (hasCodePath || hasHomeAliasPath || containsFilesystemPathSyntax(searchableLine)) {
      references.push({ file, line: index + 1 });
    }
    const newlineOffset = lineOffset + line.length;
    lineOffset = newlineOffset + (contents.startsWith('\r\n', newlineOffset) ? 2 : 1);
  }

  return references;
}

function listRepositoryFiles(): string[] {
  const result = Bun.spawnSync([
    'git',
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
  ], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error('Could not list repository files');
  }
  return result.stdout.toString().split('\0').filter(Boolean);
}

async function readRepositoryEntry(file: string): Promise<{
  contents: Buffer;
  isSymbolicLink: boolean;
}> {
  const metadata = await lstat(file);
  const isSymbolicLink = metadata.isSymbolicLink();
  return {
    contents: isSymbolicLink ? Buffer.from(await readlink(file)) : await readFile(file),
    isSymbolicLink,
  };
}

export async function findRepositoryEntryPathReferences(
  file: string,
): Promise<AbsolutePathReference[]> {
  const { contents, isSymbolicLink } = await readRepositoryEntry(file);
  if (contents.includes(0)) return [];
  return findAbsolutePathReferences(file, contents.toString('utf8'), !isSymbolicLink);
}

async function verifyRelativePaths(): Promise<number> {
  const references: AbsolutePathReference[] = [];

  for (const file of listRepositoryFiles()) {
    references.push(...await findRepositoryEntryPathReferences(file));
  }

  if (references.length === 0) {
    console.log('Verified repository files use repository-relative filesystem paths.');
    return 0;
  }

  console.error('Absolute filesystem paths are not allowed in repository files:');
  for (const reference of references) {
    console.error(`- ${reference.file}:${reference.line}`);
  }
  return 1;
}

if (import.meta.main) {
  verifyRelativePaths().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch(() => {
    console.error('Relative path verification could not complete.');
    process.exitCode = 1;
  });
}
