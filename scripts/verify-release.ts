import { readFile } from 'node:fs/promises';

export interface ReleaseVersions {
  packageVersion: string;
  lockVersion: string;
  manifestVersion: string;
  tag: string;
}

export function extractWorkspaceVersion(lockText: string, workspace: string): string {
  const workspaceLine = new RegExp(
    `^([ \\t]*)${escapeRegExp(JSON.stringify(workspace))}\\s*:\\s*\\{\\s*$`,
    'm',
  ).exec(lockText);

  if (workspaceLine?.index !== undefined) {
    const indentation = workspaceLine[1];
    const workspaceBody = lockText.slice(workspaceLine.index + workspaceLine[0].length);
    const workspaceEnd = new RegExp(`^${escapeRegExp(indentation)}\\}`, 'm').exec(workspaceBody);
    const workspaceBlock = workspaceBody.slice(0, workspaceEnd?.index);
    const directPropertyIndentation = workspaceBlock.match(/^([ \t]+)"[^"]+"\s*:/m)?.[1];
    const version = directPropertyIndentation
      ? new RegExp(
          `^${escapeRegExp(directPropertyIndentation)}"version"\\s*:\\s*"([^"]+)"\\s*,?\\s*$`,
          'm',
        ).exec(workspaceBlock)?.[1]
      : undefined;

    if (version !== undefined) {
      return version;
    }
  }

  throw new Error(`Missing version for workspace "${workspace}" in bun.lock`);
}

export function validateReleaseVersions(versions: ReleaseVersions): string {
  validateNumericVersion('package', versions.packageVersion);
  validateNumericVersion('lock', versions.lockVersion);
  validateNumericVersion('manifest', versions.manifestVersion);

  if (!/^v\d+\.\d+\.\d+$/.test(versions.tag)) {
    throw new Error(`Invalid tag "${versions.tag}": expected numeric vX.Y.Z`);
  }

  if (
    versions.packageVersion !== versions.lockVersion ||
    versions.packageVersion !== versions.manifestVersion ||
    versions.packageVersion !== versions.tag.slice(1)
  ) {
    throw new Error(
      `Release version mismatch: package=${versions.packageVersion}, lock=${versions.lockVersion}, manifest=${versions.manifestVersion}, tag=${versions.tag}`,
    );
  }

  return versions.packageVersion;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateNumericVersion(source: string, version: string): void {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid ${source} version "${version}": expected numeric x.y.z`);
  }
}

async function main(): Promise<void> {
  const [tag, manifestPath] = process.argv.slice(2);

  if (tag === undefined || manifestPath === undefined) {
    throw new Error('Usage: bun scripts/verify-release.ts <tag> <manifest-path>');
  }

  const repositoryRoot = new URL('../', import.meta.url);
  const [packageText, lockText, manifestText] = await Promise.all([
    readFile(new URL('apps/extension/package.json', repositoryRoot), 'utf8'),
    readFile(new URL('bun.lock', repositoryRoot), 'utf8'),
    readFile(manifestPath, 'utf8'),
  ]);
  const packageJson = JSON.parse(packageText) as { version: string };
  const manifest = JSON.parse(manifestText) as { version: string };
  const version = validateReleaseVersions({
    packageVersion: packageJson.version,
    lockVersion: extractWorkspaceVersion(lockText, 'apps/extension'),
    manifestVersion: manifest.version,
    tag,
  });

  console.log(version);
}

if (import.meta.main) {
  await main();
}
