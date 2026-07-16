import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isAbsoluteFilesystemPath,
  sanitizeFilesystemPaths,
  toRelativeDisplayPath,
} from './path-policy';
import {
  findAbsolutePathReferences,
  findRepositoryEntryPathReferences,
} from './verify-relative-paths';

describe('relative path policy', () => {
  it('flags platform and user-specific absolute filesystem paths', () => {
    const slash = String.fromCharCode(47);
    const backslash = String.fromCharCode(92);
    const contents = [
      `@${slash}Users${slash}example${slash}project${slash}AGENTS.md`,
      `${slash}Applications${slash}Example.app${slash}Contents${slash}MacOS${slash}Example`,
      ['C:', 'Users', 'example', 'project', 'README.md'].join(backslash),
      ['Q:', 'custom-root', 'project', 'README.md'].join(backslash),
      ['R:', 'custom-root', 'README.md'].join(backslash),
      ['~', 'project', 'README.md'].join(slash),
      `prefix:${slash}System${slash}Library${slash}Example`,
      `[${slash}Library${slash}Application Support${slash}Example]`,
      `#!${slash}Users${slash}example${slash}bin${slash}bun`,
      `prefix:${slash}custom-root${slash}project${slash}file.ts`,
      `prefix:${slash}custom-root${slash}file.ts`,
      ['', '', 'server', 'share', 'file.ts'].join(backslash),
      ['', '', 'server', 'share', 'file.ts'].join(slash),
    ].join('\n');

    expect(findAbsolutePathReferences('fixture.md', contents)).toEqual([
      { file: 'fixture.md', line: 1 },
      { file: 'fixture.md', line: 2 },
      { file: 'fixture.md', line: 3 },
      { file: 'fixture.md', line: 4 },
      { file: 'fixture.md', line: 5 },
      { file: 'fixture.md', line: 6 },
      { file: 'fixture.md', line: 7 },
      { file: 'fixture.md', line: 8 },
      { file: 'fixture.md', line: 9 },
      { file: 'fixture.md', line: 10 },
      { file: 'fixture.md', line: 11 },
      { file: 'fixture.md', line: 12 },
      { file: 'fixture.md', line: 13 },
    ]);
  });

  it('allows repository-relative paths, approved URL routes, standard shebangs, and file fixtures', () => {
    const slash = String.fromCharCode(47);
    const contents = [
      'apps/extension/src/main.ts',
      `#!${slash}usr${slash}bin${slash}env bun`,
      'https://example.com/home/example',
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/newtab.html',
      ['file:', '', '', 'tmp', 'private.html'].join(slash),
      '/newtab.html',
      '/json/list',
      '/repos/$GITHUB_REPOSITORY/releases/tags/$TAG',
      `const pattern = ${slash}error${slash}g;`,
      `  ${slash}^error$${slash}g,`,
      '<div><span>Safe</span></div>',
      'const fragment = String.raw`(?=$|[^a-z])`;',
      `const boundary = String.raw\`(?=$|[^a-z${slash}])\`;`,
      'font: var(--text-base)/var(--leading-body) var(--font-body);',
    ].join('\n');

    expect(findAbsolutePathReferences(
      'apps/extension/src/components/TabFavicon.test.tsx',
      contents,
    )).toEqual([]);
  });

  it('allows JavaScript regular expressions inside HTML script elements', () => {
    const slash = String.fromCharCode(47);
    const contents = [
      `<script>const words = value.match(${slash}[A-Z]+${slash}g);`,
      'const newline = `',
      `\`; const pattern = ${slash}error${slash}g;</script>`,
      `<template><script>const nested = ${slash}error${slash}g;</script></template>`,
    ].join('\n');

    expect(findAbsolutePathReferences('fixture.html', contents)).toEqual([]);
  });

  it('still flags paths inside multiline script template values', () => {
    const slash = String.fromCharCode(47);
    const contents = [
      '<script>const output = `',
      `${slash}Users${slash}g`,
      '`;</script>',
    ].join('\n');

    expect(findAbsolutePathReferences('fixture.html', contents)).toEqual([
      { file: 'fixture.html', line: 2 },
    ]);
  });

  it('recognizes regular expressions inside template interpolations', () => {
    const slash = String.fromCharCode(47);
    const contents = [
      'const output = `value ${value.replace(',
      `${slash}error${slash}g`,
      ", '')}`;",
    ].join('');

    expect(findAbsolutePathReferences('fixture.ts', contents)).toEqual([]);
  });

  it.each(['ts', 'cjs', 'cts'])('recognizes regular expressions inside %s Markdown fences', (language) => {
    const slash = String.fromCharCode(47);
    const contents = [
      `\`\`\`${language}`,
      `const pattern = ${slash}error${slash}g;`,
      '\`\`\`',
    ].join('\n');

    expect(findAbsolutePathReferences('fixture.md', contents)).toEqual([]);
  });

  it('flags escaped filesystem separators in strings and regular expressions', () => {
    const slash = String.fromCharCode(47);
    const backslash = String.fromCharCode(92);
    const escapedSlash = `${backslash}${slash}`;
    const escapedBackslash = `${backslash}${backslash}`;
    const escapedPosixPath = `${escapedSlash}Users${escapedSlash}g`;
    const escapedWindowsPath = ['Q:', 'custom-root', 'g'].join(escapedBackslash);
    const escapedUncPath = ['', '', 'server', 'share', 'secret.ts'].join(escapedBackslash);
    const contents = [
      `const posixPath = "${escapedPosixPath}";`,
      `const windowsPath = "${escapedWindowsPath}";`,
      `const matcher = ${slash}${escapedPosixPath}${slash};`,
      `const wildcard = ${slash}${escapedPosixPath}${escapedSlash}.*${slash};`,
      `const windowsMatcher = ${slash}${escapedWindowsPath}${slash};`,
      `const windowsWildcard = ${slash}${escapedWindowsPath}${escapedBackslash}.*${slash};`,
      `const uncMatcher = ${slash}${escapedUncPath}${slash};`,
      `const uncWildcard = ${slash}${escapedUncPath}${escapedBackslash}.*${slash};`,
      `const groupedWindows = ${slash}(?:${escapedWindowsPath})${slash};`,
      `const alternativeWindows = ${slash}safe|${escapedWindowsPath}${escapedBackslash}.*${slash};`,
      `const groupedUnc = ${slash}(?:${escapedUncPath})${slash};`,
      `const alternativeUnc = ${slash}safe|${escapedUncPath}${escapedBackslash}.*${slash};`,
      `const groupedPosix = ${slash}(?:${escapedPosixPath})${slash};`,
      `const alternativePosix = ${slash}safe|${escapedPosixPath}${escapedSlash}.*${slash};`,
      `const boundedWindows = ${slash}${backslash}b${escapedWindowsPath}${slash};`,
      `const spacedWindows = ${slash}${backslash}s${escapedWindowsPath}${slash};`,
      `const boundedUnc = ${slash}${backslash}b${escapedUncPath}${slash};`,
    ].join('\n');

    expect(findAbsolutePathReferences('fixture.ts', contents)).toEqual([
      { file: 'fixture.ts', line: 1 },
      { file: 'fixture.ts', line: 2 },
      { file: 'fixture.ts', line: 3 },
      { file: 'fixture.ts', line: 4 },
      { file: 'fixture.ts', line: 5 },
      { file: 'fixture.ts', line: 6 },
      { file: 'fixture.ts', line: 7 },
      { file: 'fixture.ts', line: 8 },
      { file: 'fixture.ts', line: 9 },
      { file: 'fixture.ts', line: 10 },
      { file: 'fixture.ts', line: 11 },
      { file: 'fixture.ts', line: 12 },
      { file: 'fixture.ts', line: 13 },
      { file: 'fixture.ts', line: 14 },
      { file: 'fixture.ts', line: 15 },
      { file: 'fixture.ts', line: 16 },
      { file: 'fixture.ts', line: 17 },
    ]);
    expect(findAbsolutePathReferences(
      'fixture.json',
      `{"path":"${escapedPosixPath}"}`,
    )).toEqual([{ file: 'fixture.json', line: 1 }]);
  });

  it('scans a symlink target as plain repository text without following it', async () => {
    const directory = await mkdtemp('.path-policy-test-');
    const link = `${directory}/alias.ts`;
    const target = resolve(directory, 'outside-target');
    try {
      await symlink(target, link);
      expect(await findRepositoryEntryPathReferences(link)).toEqual([
        { file: link, line: 1 },
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('rejects file URLs outside the approved security fixtures', () => {
    const slash = String.fromCharCode(47);
    const contents = [
      ['file:', '', '', 'custom-root', 'project', 'private.html'].join(slash),
      ['file:', '', 'server', 'share', 'private.html'].join(slash),
      ['FiLe:', '', '', 'custom-root', 'private.html'].join(slash),
    ].join('\n');

    expect(findAbsolutePathReferences('README.md', contents)).toEqual([
      { file: 'README.md', line: 1 },
      { file: 'README.md', line: 2 },
      { file: 'README.md', line: 3 },
    ]);
  });

  it('flags short and spaced absolute paths outside the platform root allowlist', () => {
    const slash = String.fromCharCode(47);
    const backslash = String.fromCharCode(92);
    const quotedPaths = [
      ['', 'custom root', 'file.ts'].join(slash),
      ['S:', 'README.md'].join(backslash),
      ['T:', 'custom root', 'README.md'].join(backslash),
      ['', '', 's', 'share'].join(backslash),
      ['', '', 'server', 'share name', 'file.ts'].join(backslash),
    ].map((value) => `"${value}"`);
    const contents = [
      ...quotedPaths,
      `${slash}diagnostic.log`,
      `${slash}custom root${slash}file.ts`,
      `${slash}custom,root${slash}file.ts`,
    ].join('\n');

    expect(findAbsolutePathReferences('fixture.md', contents)).toEqual([
      { file: 'fixture.md', line: 1 },
      { file: 'fixture.md', line: 2 },
      { file: 'fixture.md', line: 3 },
      { file: 'fixture.md', line: 4 },
      { file: 'fixture.md', line: 5 },
      { file: 'fixture.md', line: 6 },
      { file: 'fixture.md', line: 7 },
      { file: 'fixture.md', line: 8 },
    ]);
  });

  it('flags absolute paths following arbitrary punctuation', () => {
    const slash = String.fromCharCode(47);
    const path = ['', 'custom-root', 'file.ts'].join(slash);
    const contents = [
      `error;${path}`,
      `=>${path}`,
      `|${path}`,
      `%${path}`,
      `+${path}`,
      `-${path}`,
      `error:${slash}diagnostic.log`,
    ].join('\n');

    expect(findAbsolutePathReferences('fixture.md', contents)).toEqual([
      { file: 'fixture.md', line: 1 },
      { file: 'fixture.md', line: 2 },
      { file: 'fixture.md', line: 3 },
      { file: 'fixture.md', line: 4 },
      { file: 'fixture.md', line: 5 },
      { file: 'fixture.md', line: 6 },
      { file: 'fixture.md', line: 7 },
    ]);
  });

  it('flags root files after common punctuation boundaries', () => {
    const slash = String.fromCharCode(47);
    const rootFile = `${slash}diagnostic.log`;
    const contents = [' ', '%', '+', '-', '@', '[', '(']
      .map((boundary) => `${boundary}${rootFile}`)
      .join('\n');

    expect(findAbsolutePathReferences('fixture.md', contents)).toEqual(
      Array.from({ length: 7 }, (_, index) => ({ file: 'fixture.md', line: index + 1 })),
    );
  });

  it('does not confuse path-shaped values with regular expression literals', () => {
    const slash = String.fromCharCode(47);
    const contents = [
      `Path: ${slash}Users${slash}g`,
      `Path: ${slash}custom-root${slash}g`,
      `${slash}Users${slash}g`,
      `${slash}custom-root${slash}g`,
      `ROOT=${slash}Users${slash}g`,
      `cwd=${slash}custom-root${slash}g`,
      `Error (${slash}Users${slash}g)`,
    ].join('\n');

    expect(findAbsolutePathReferences('fixture.md', contents)).toEqual([
      { file: 'fixture.md', line: 1 },
      { file: 'fixture.md', line: 2 },
      { file: 'fixture.md', line: 3 },
      { file: 'fixture.md', line: 4 },
      { file: 'fixture.md', line: 5 },
      { file: 'fixture.md', line: 6 },
      { file: 'fixture.md', line: 7 },
    ]);
  });

  it('does not mask paths inside JavaScript strings or comments', () => {
    const slash = String.fromCharCode(47);
    const backslash = String.fromCharCode(92);
    const contents = [
      `const message = "Error (${slash}Users${slash}g)";`,
      `// ROOT=${slash}Users${slash}g`,
      '/*',
      `ROOT=${slash}Users${slash}g`,
      '*/',
      ['const continued = "prefix', backslash].join(''),
      `ROOT=${slash}Users${slash}g suffix";`,
      'const template = `',
      `ROOT=${slash}Users${slash}g suffix`,
      '`;',
    ].join('\n');

    expect(findAbsolutePathReferences('fixture.ts', contents)).toEqual([
      { file: 'fixture.ts', line: 1 },
      { file: 'fixture.ts', line: 2 },
      { file: 'fixture.ts', line: 4 },
      { file: 'fixture.ts', line: 7 },
      { file: 'fixture.ts', line: 9 },
    ]);
  });

  it('limits HTML script parsing to real script contents', () => {
    const slash = String.fromCharCode(47);
    const regex = `${slash}error${slash}g`;
    const contents = [
      '<!-- <script>const ignored = true;</script> -->',
      `ROOT=${slash}Users${slash}g`,
      '<div data-example="<script>">safe</div>',
      `cwd=${slash}custom-root${slash}g`,
      '<script>/*',
      `ROOT=${slash}Users${slash}g`,
      `*/ const pattern = ${regex};</script>`,
      `ROOT=${slash}Users${slash}g <script>const pattern = ${regex};</script>`,
      `<script>const pattern = ${regex};</script> cwd=${slash}custom-root${slash}g`,
    ].join('\n');

    expect(findAbsolutePathReferences('fixture.html', contents)).toEqual([
      { file: 'fixture.html', line: 2 },
      { file: 'fixture.html', line: 4 },
      { file: 'fixture.html', line: 6 },
      { file: 'fixture.html', line: 8 },
      { file: 'fixture.html', line: 9 },
    ]);
  });

  it('does not parse data script elements as JavaScript', () => {
    const slash = String.fromCharCode(47);
    const regex = `${slash}error${slash}g`;
    const contents = [
      `<script type="text/plain">ROOT=${slash}Users${slash}g</script>`,
      `<script type="application/json">{"path":"${slash}Users${slash}g"}</script>`,
      `<script type="module">const pattern = ${regex};</script>`,
      `<script type="text/javascript">const pattern = ${regex};</script>`,
      `<script type="text/x-javascript">const pattern = ${regex};</script>`,
      `<script data-example=" type='text/javascript' data" type="text/plain">ROOT=${slash}Users${slash}g</script>`,
      `<script type="module; charset=utf-8">ROOT=${slash}Users${slash}g</script>`,
      `<script type="\u00a0module\u00a0">ROOT=${slash}Users${slash}g</script>`,
      `<script type="text/javascript; charset=utf-8">ROOT=${slash}Users${slash}g</script>`,
      `<script type="application/javascript;version=1">ROOT=${slash}Users${slash}g</script>`,
      `<script language="VBScript">ROOT=${slash}Users${slash}g</script>`,
      `<script language="JavaScript">const pattern = ${regex};</script>`,
      `<script language="">const pattern = ${regex};</script>`,
      `<script type="" language="VBScript">const pattern = ${regex};</script>`,
      `<script type=" ">ROOT=${slash}Users${slash}g</script>`,
      `<script src="app.js">ROOT=${slash}Users${slash}g</script>`,
      `<script src="">ROOT=${slash}Users${slash}g</script>`,
    ].join('\n');

    expect(findAbsolutePathReferences('fixture.html', contents)).toEqual([
      { file: 'fixture.html', line: 1 },
      { file: 'fixture.html', line: 2 },
      { file: 'fixture.html', line: 6 },
      { file: 'fixture.html', line: 7 },
      { file: 'fixture.html', line: 8 },
      { file: 'fixture.html', line: 9 },
      { file: 'fixture.html', line: 10 },
      { file: 'fixture.html', line: 11 },
      { file: 'fixture.html', line: 15 },
      { file: 'fixture.html', line: 16 },
      { file: 'fixture.html', line: 17 },
    ]);
  });

  it('does not parse script-like text inside raw-text HTML elements', () => {
    const slash = String.fromCharCode(47);
    const path = `${slash}Users${slash}g`;
    const contents = [
      `<textarea><script>ROOT=${path}</script></textarea>`,
      `<title><script>ROOT=${path}</script></title>`,
      `<style><script>ROOT=${path}</script></style>`,
      `<noscript><script>ROOT=${path}</script></noscript>`,
      `<script.foo>ROOT=${path}</script.foo>`,
      `<?xml <script>ROOT=${path}</script> ?>`,
    ].join('\n');

    expect(findAbsolutePathReferences('fixture.html', contents)).toEqual([
      { file: 'fixture.html', line: 1 },
      { file: 'fixture.html', line: 2 },
      { file: 'fixture.html', line: 3 },
      { file: 'fixture.html', line: 4 },
      { file: 'fixture.html', line: 5 },
      { file: 'fixture.html', line: 6 },
    ]);
  });

  it('does not mask filesystem paths in raw string templates', () => {
    const backslash = String.fromCharCode(92);
    const rawPath = ['Q:', 'custom-root', 'g'].join(backslash);
    const contents = [
      `const rawPath = String.raw\`${rawPath}\`;`,
      `const diagnostic = String.raw\`cwd=${rawPath}\`;`,
    ].join('\n');

    expect(findAbsolutePathReferences('fixture.ts', contents)).toEqual([
      { file: 'fixture.ts', line: 1 },
      { file: 'fixture.ts', line: 2 },
    ]);
  });

  it('flags root files with short names and diagnostic suffixes', () => {
    const slash = String.fromCharCode(47);
    const rootFile = `${slash}diagnostic.log`;
    const contents = [
      `${slash}g`,
      `${slash}i`,
      `at ${rootFile}:12:3`,
      `${rootFile}>`,
      `${rootFile}|stderr`,
    ].join('\n');

    expect(findAbsolutePathReferences('fixture.md', contents)).toEqual(
      Array.from({ length: 5 }, (_, index) => ({ file: 'fixture.md', line: index + 1 })),
    );
  });

  it('flags Unicode root names and spaced Unicode paths', () => {
    const slash = String.fromCharCode(47);
    const backslash = String.fromCharCode(92);
    const rootName = '\u8def\u5f84';
    const folder = '\u8d44\u6599';
    const nestedFolder = '\u76ee\u5f55';
    const fileName = '\u6587\u4ef6.txt';
    const contents = [
      `${slash}${rootName}`,
      `"${slash}${rootName}"`,
      `cwd=${slash}${folder} ${nestedFolder}${slash}${fileName}`,
      ['', '', folder, nestedFolder].join(backslash),
      ['', '', '?', 'Q:', 'custom-root', 'file.ts'].join(backslash),
      [['Q', 'custom-root'].join(':'), 'file.ts'].join(backslash),
    ].join('\n');

    expect(findAbsolutePathReferences('fixture.md', contents)).toEqual([
      { file: 'fixture.md', line: 1 },
      { file: 'fixture.md', line: 2 },
      { file: 'fixture.md', line: 3 },
      { file: 'fixture.md', line: 4 },
      { file: 'fixture.md', line: 5 },
      { file: 'fixture.md', line: 6 },
    ]);
  });

  it('flags single-file drive-relative paths only in path-like contexts', () => {
    const upperPath = ['Q', 'file.ts'].join(':');
    const lowerPath = ['q', 'file.ts'].join(':');
    const directoryPath = ['Q', 'folder'].join(':');
    const contents = [
      upperPath,
      `"${lowerPath}"`,
      `path = ${upperPath}`,
      `Path: ${lowerPath}`,
      `cwd: ${directoryPath}`,
      `"${directoryPath}"`,
    ].join('\n');

    expect(findAbsolutePathReferences('fixture.md', contents)).toEqual(
      Array.from({ length: 6 }, (_, index) => ({ file: 'fixture.md', line: index + 1 })),
    );
    expect(findAbsolutePathReferences('fixture.css', [
      'a:focus-visible {',
      'A:hover {',
      'a:focus.visible {',
    ].join('\n'))).toEqual([]);
  });
});

describe('filesystem path sanitization', () => {
  it('recognizes POSIX, Windows, and UNC paths without relying on root names', () => {
    const slash = String.fromCharCode(47);
    const backslash = String.fromCharCode(92);
    const posixPath = ['', 'custom-root', 'Project Files', 'bundle.js'].join(slash);
    const windowsPath = ['Q:', 'custom-root', 'project', 'bundle.js'].join(backslash);
    const uncPath = ['', '', 'server', 'share', 'bundle.js'].join(backslash);
    const uncFileUrl = `file:${slash}${slash}server${slash}share${slash}bundle.js`;
    const spacedFileUrl = `file:${slash}${slash}${slash}custom-root${slash}Project Files${slash}bundle.js`;
    const mixedCaseFileUrl = `FiLe:${slash}${slash}${slash}custom-root${slash}bundle.js`;

    expect(isAbsoluteFilesystemPath(posixPath)).toBe(true);
    expect(isAbsoluteFilesystemPath(windowsPath)).toBe(true);
    expect(isAbsoluteFilesystemPath(uncPath)).toBe(true);
    expect(sanitizeFilesystemPaths(`at "${posixPath}"`)).toBe('at "[path]"');
    expect(sanitizeFilesystemPaths(`at ${windowsPath}:7:2`)).toBe('at [path]:7:2');
    expect(sanitizeFilesystemPaths(`at ${uncPath}`)).toBe('at [path]');
    expect(sanitizeFilesystemPaths(`at "${uncFileUrl}"`)).toBe('at "[path]"');
    expect(sanitizeFilesystemPaths(`at "${spacedFileUrl}"`)).toBe('at "[path]"');
    expect(sanitizeFilesystemPaths(`at "${mixedCaseFileUrl}"`)).toBe('at "[path]"');
    expect(sanitizeFilesystemPaths(`\u001B[31m${posixPath}\u001B[0m`)).toBe('[path]');
  });

  it('sanitizes paths after punctuation without changing network URLs', () => {
    const slash = String.fromCharCode(47);
    const backslash = String.fromCharCode(92);
    const posixPath = ['', 'custom-root', 'project', 'bundle.js'].join(slash);
    const windowsPath = ['Q:', 'custom-root', 'bundle.js'].join(backslash);
    const unquotedSpacedPath = ['', 'custom-root', 'project', 'My File.js'].join(slash);
    const commaPath = ['', 'custom,root', 'secret.ts'].join(slash);

    expect(sanitizeFilesystemPaths(`cwd=${posixPath}`)).toBe('cwd=[path]');
    expect(sanitizeFilesystemPaths(`error;${posixPath}:12:3`)).toBe('error;[path]:12:3');
    expect(sanitizeFilesystemPaths(`label:${posixPath}`)).toBe('label:[path]');
    expect(sanitizeFilesystemPaths(`=>${posixPath}`)).toBe('=>[path]');
    expect(sanitizeFilesystemPaths(`|${posixPath}`)).toBe('|[path]');
    expect(sanitizeFilesystemPaths(`%${posixPath}`)).toBe('%[path]');
    expect(sanitizeFilesystemPaths(`+${posixPath}`)).toBe('+[path]');
    expect(sanitizeFilesystemPaths(`-${posixPath}`)).toBe('-[path]');
    expect(sanitizeFilesystemPaths(`cwd=${windowsPath}`)).toBe('cwd=[path]');
    expect(sanitizeFilesystemPaths(commaPath)).toBe('[path]');
    expect(sanitizeFilesystemPaths(`cwd=${posixPath} failed to load`)).toBe(
      'cwd=[path] failed to load',
    );
    expect(sanitizeFilesystemPaths(`at ${unquotedSpacedPath} failed to load`)).toBe('at [path]');
    expect(sanitizeFilesystemPaths('https://example.com/path')).toBe('https://example.com/path');
  });

  it('sanitizes JSON-escaped filesystem separators', () => {
    const slash = String.fromCharCode(47);
    const backslash = String.fromCharCode(92);
    const escapedSlash = `${backslash}${slash}`;
    const escapedBackslash = `${backslash}${backslash}`;
    const escapedPosixPath = ['', 'custom-root', 'secret.ts'].join(escapedSlash);
    const escapedWindowsPath = ['Q:', 'custom-root', 'secret.ts'].join(escapedBackslash);
    const escapedFileUrl = ['file:', '', '', 'custom-root', 'secret.ts'].join(escapedSlash);

    expect(sanitizeFilesystemPaths(`{"path":"${escapedPosixPath}"}`)).toBe(
      '{"path":"[path]"}',
    );
    expect(sanitizeFilesystemPaths(`cwd=${escapedPosixPath}`)).toBe('cwd=[path]');
    expect(sanitizeFilesystemPaths(`{"path":"${escapedWindowsPath}"}`)).toBe(
      '{"path":"[path]"}',
    );
    expect(sanitizeFilesystemPaths(`{"path":"${escapedFileUrl}"}`)).toBe(
      '{"path":"[path]"}',
    );
  });

  it('preserves JSON structure while redacting spaced and drive-relative paths', () => {
    const slash = String.fromCharCode(47);
    const backslash = String.fromCharCode(92);
    const spacedPath = ['', 'custom-root', 'Project Files', 'secret.ts'].join(slash);
    const driveRelativeFile = ['Q', 'file.ts'].join(':');
    const driveRelativeDirectory = [['Q', 'folder'].join(':'), 'secret.ts'].join(backslash);
    const input = JSON.stringify({
      message: `at ${spacedPath} failed`,
      file: driveRelativeFile,
      path: driveRelativeDirectory,
    });
    const sanitized = sanitizeFilesystemPaths(input);

    expect(JSON.parse(sanitized)).toEqual({
      message: 'at [path]',
      file: '[path]',
      path: '[path]',
    });
  });

  it('only displays paths contained by the selected base directory', () => {
    const base = resolve('fixtures/root');

    expect(toRelativeDisplayPath(base, resolve(base, 'nested/file.ts'))).toBe('nested/file.ts');
    expect(toRelativeDisplayPath(base, resolve(base, '../outside/file.ts'))).toBe('[path]');
  });
});
