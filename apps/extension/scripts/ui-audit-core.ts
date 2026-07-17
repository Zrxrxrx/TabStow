import { createHash } from 'node:crypto';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

export type UiAuditArguments = {
  port: number;
  caseId: string;
  outputDirectory: string;
  extensionId?: string;
  help: boolean;
};

const UI_AUDIT_METRICS = [
  'rootChildCount',
  'horizontalOverflowPx',
  'themeMode',
  'locale',
  'pagePath',
  'workspaceLandmarks',
  'viewportWidth',
  'viewportHeight',
  'zoom',
  'feedbackCount',
  'feedbackWorkspaceOverlapAreaPx2',
  'feedbackSavedOverlapAreaPx2',
  'feedbackViewportOverflowPx',
  'feedbackLineCount',
  'topWorkspaceGapPx',
  'focusRegionSequence',
  'tabSequenceComplete',
  'quickLinkModalIsolationFailures',
  'modalPortaledCount',
  'rootInertDuringModal',
  'lowerModalInert',
  'topModalInteractive',
  'focusInTopModal',
  'responsiveLayoutMode',
  'scrollOwnershipFailures',
  'lastItemReachabilityFailures',
  'lastItemsChecked',
  'dialogViewportOverflowPx',
  'railViewportOverflowPx',
  'topStripViewportOverflowPx',
  'requiredControlVisibilityFailures',
  'firstUseGuidanceFailures',
  'stowUnavailableFailures',
  'appearanceStateCount',
  'appearanceRuntimeFailures',
  'sharedTokenSignatures',
  'newtabComputedStyleSignatures',
  'utilityShellFailures',
  'utilityBackRouteFailures',
  'backControlHeightPx',
  'backViewportOverflowPx',
  'accessibilityThemeStateCount',
  'controlInventoryFailures',
  'textReadabilityFailures',
  'textNodesChecked',
  'contrastFailures',
  'contrastPairsChecked',
  'contrastUnresolvedFailures',
  'targetSizeFailures',
  'targetsChecked',
  'targetOverlapFailures',
  'focusVisibilityFailures',
  'focusTargetsChecked',
  'unavailableDescriptionFailures',
  'unavailableControlsChecked',
] as const;

const NUMERIC_UI_AUDIT_METRICS = new Set<UiAuditMetric>([
  'rootChildCount',
  'horizontalOverflowPx',
  'viewportWidth',
  'viewportHeight',
  'zoom',
  'feedbackCount',
  'feedbackWorkspaceOverlapAreaPx2',
  'feedbackSavedOverlapAreaPx2',
  'feedbackViewportOverflowPx',
  'feedbackLineCount',
  'topWorkspaceGapPx',
  'tabSequenceComplete',
  'quickLinkModalIsolationFailures',
  'modalPortaledCount',
  'rootInertDuringModal',
  'lowerModalInert',
  'topModalInteractive',
  'focusInTopModal',
  'scrollOwnershipFailures',
  'lastItemReachabilityFailures',
  'lastItemsChecked',
  'dialogViewportOverflowPx',
  'railViewportOverflowPx',
  'topStripViewportOverflowPx',
  'requiredControlVisibilityFailures',
  'firstUseGuidanceFailures',
  'stowUnavailableFailures',
  'appearanceStateCount',
  'appearanceRuntimeFailures',
  'utilityShellFailures',
  'utilityBackRouteFailures',
  'backControlHeightPx',
  'backViewportOverflowPx',
  'accessibilityThemeStateCount',
  'controlInventoryFailures',
  'textReadabilityFailures',
  'textNodesChecked',
  'contrastFailures',
  'contrastPairsChecked',
  'contrastUnresolvedFailures',
  'targetSizeFailures',
  'targetsChecked',
  'targetOverlapFailures',
  'focusVisibilityFailures',
  'focusTargetsChecked',
  'unavailableDescriptionFailures',
  'unavailableControlsChecked',
]);

const UI_AUDIT_FEEDBACK_FIXTURES = [
  'none',
  'stow-success',
  'restore-success',
  'long-error',
] as const;

const UI_AUDIT_INTERACTION_FIXTURES = ['finding-006'] as const;

const UI_AUDIT_LAYOUT_FIXTURES = [
  'finding-001-empty',
  'finding-001-populated',
  'finding-001-long',
] as const;

const UI_AUDIT_APPEARANCE_FIXTURES = ['finding-003'] as const;
const UI_AUDIT_ACCESSIBILITY_FIXTURES = ['finding-005'] as const;

export type UiAuditMetric = typeof UI_AUDIT_METRICS[number];
export type UiAuditOperator = 'atMost' | 'atLeast' | 'equals';
export type UiAuditFeedbackFixture = typeof UI_AUDIT_FEEDBACK_FIXTURES[number];
export type UiAuditInteractionFixture = typeof UI_AUDIT_INTERACTION_FIXTURES[number];
export type UiAuditLayoutFixture = typeof UI_AUDIT_LAYOUT_FIXTURES[number];
export type UiAuditAppearanceFixture = typeof UI_AUDIT_APPEARANCE_FIXTURES[number];
export type UiAuditAccessibilityFixture = typeof UI_AUDIT_ACCESSIBILITY_FIXTURES[number];

export type UiAuditAssertion = {
  metric: UiAuditMetric;
  operator: UiAuditOperator;
  value: number | string;
};

export type UiAuditCase = {
  id: string;
  description: string;
  page: string;
  viewport: { width: number; height: number };
  zoom: number;
  theme: 'light' | 'dark';
  locale: 'en' | 'zh-CN';
  feedbackFixture?: UiAuditFeedbackFixture;
  interactionFixture?: UiAuditInteractionFixture;
  layoutFixture?: UiAuditLayoutFixture;
  appearanceFixture?: UiAuditAppearanceFixture;
  accessibilityFixture?: UiAuditAccessibilityFixture;
  setup: string[];
  cleanup: string[];
  screenshot: string;
  assertions: UiAuditAssertion[];
};

export type UiAuditManifest = {
  schemaVersion: 1;
  baselineCommit: string;
  cases: UiAuditCase[];
};

export type UiAuditMetrics = Record<UiAuditMetric, number | string>;

export type UiAuditAssertionResult = UiAuditAssertion & {
  expected: number | string;
  actual?: number | string;
  passed: boolean;
};

export type UiAuditCaseResult = {
  caseId: string;
  passed: boolean;
  runtimeErrors: string[];
  assertions: UiAuditAssertionResult[];
};

export type UiAuditBuildEntry = {
  path: string;
  contents: string | Uint8Array;
};

export type UiAuditExtensionManifest = {
  name?: string;
  version?: string;
  chrome_url_overrides?: Record<string, string>;
  permissions?: string[];
  host_permissions?: string[];
};

type UiAuditResourceHashes = {
  manifest: string;
  page: string;
};

export type UiAuditRuntimeIdentity = {
  extensionId: string;
  runtimeId: string;
  localManifest: UiAuditExtensionManifest;
  runtimeManifest: UiAuditExtensionManifest;
  localResourceHashes: UiAuditResourceHashes;
  runtimeResourceHashes: UiAuditResourceHashes;
};

export type UiAuditBrowserIsolation = {
  temporaryDirectory: string;
  profileMarkerExists: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function sanitizeRuntimeError(value: unknown): string {
  return String(value ?? 'Unknown runtime error')
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/chrome-extension:\/\/[a-p]{32}/g, 'chrome-extension://[extension]')
    .slice(0, 500);
}

function validateInstructions(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isNonEmptyString)) {
    throw new Error(`${field} must contain at least one instruction`);
  }
}

export function validateUiAuditManifest(input: unknown): UiAuditManifest {
  if (!isRecord(input) || input.schemaVersion !== 1) {
    throw new Error('UI audit manifest schemaVersion must be 1');
  }
  if (typeof input.baselineCommit !== 'string' || !/^[a-f0-9]{40}$/.test(input.baselineCommit)) {
    throw new Error('UI audit baselineCommit must be a full Git SHA');
  }
  if (!Array.isArray(input.cases) || input.cases.length === 0) {
    throw new Error('UI audit manifest must define at least one case');
  }

  const caseIds = new Set<string>();
  for (const [caseIndex, candidate] of input.cases.entries()) {
    const field = `cases[${caseIndex}]`;
    if (!isRecord(candidate)) throw new Error(`${field} must be an object`);
    if (typeof candidate.id !== 'string' || !/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(candidate.id)) {
      throw new Error(`${field}.id must be a safe uppercase identifier`);
    }
    if (caseIds.has(candidate.id)) throw new Error(`Duplicate UI audit case: ${candidate.id}`);
    caseIds.add(candidate.id);
    if (!isNonEmptyString(candidate.description)) throw new Error(`${field}.description is required`);
    if (typeof candidate.page !== 'string' || !/^[a-z0-9][a-z0-9-]*\.html$/.test(candidate.page)) {
      throw new Error(`${field}.page must be a root extension HTML path`);
    }
    if (!isRecord(candidate.viewport)) throw new Error(`${field}.viewport is required`);
    for (const dimension of ['width', 'height'] as const) {
      const value = candidate.viewport[dimension];
      if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > 10_000) {
        throw new Error(`${field}.viewport.${dimension} must be a positive integer`);
      }
    }
    if (typeof candidate.zoom !== 'number' || !Number.isFinite(candidate.zoom)
      || candidate.zoom < 0.25 || candidate.zoom > 5) {
      throw new Error(`${field}.zoom must be between 0.25 and 5`);
    }
    if (candidate.theme !== 'light' && candidate.theme !== 'dark') {
      throw new Error(`${field}.theme must be light or dark`);
    }
    if (candidate.locale !== 'en' && candidate.locale !== 'zh-CN') {
      throw new Error(`${field}.locale must be en or zh-CN`);
    }
    if (candidate.feedbackFixture !== undefined
      && !UI_AUDIT_FEEDBACK_FIXTURES.includes(candidate.feedbackFixture as UiAuditFeedbackFixture)) {
      throw new Error(`${field}.feedbackFixture is unsupported`);
    }
    if (candidate.interactionFixture !== undefined
      && !UI_AUDIT_INTERACTION_FIXTURES.includes(
        candidate.interactionFixture as UiAuditInteractionFixture,
      )) {
      throw new Error(`${field}.interactionFixture is unsupported`);
    }
    if (candidate.layoutFixture !== undefined
      && !UI_AUDIT_LAYOUT_FIXTURES.includes(candidate.layoutFixture as UiAuditLayoutFixture)) {
      throw new Error(`${field}.layoutFixture is unsupported`);
    }
    if (candidate.appearanceFixture !== undefined
      && !UI_AUDIT_APPEARANCE_FIXTURES.includes(
        candidate.appearanceFixture as UiAuditAppearanceFixture,
      )) {
      throw new Error(`${field}.appearanceFixture is unsupported`);
    }
    if (candidate.accessibilityFixture !== undefined
      && !UI_AUDIT_ACCESSIBILITY_FIXTURES.includes(
        candidate.accessibilityFixture as UiAuditAccessibilityFixture,
      )) {
      throw new Error(`${field}.accessibilityFixture is unsupported`);
    }
    const fixtureCount = [
      candidate.feedbackFixture,
      candidate.interactionFixture,
      candidate.layoutFixture,
      candidate.appearanceFixture,
      candidate.accessibilityFixture,
    ].filter((fixture) => fixture !== undefined && fixture !== 'none').length;
    if (fixtureCount > 1) throw new Error(`${field} must not combine focused fixtures`);
    validateInstructions(candidate.setup, `${field}.setup`);
    validateInstructions(candidate.cleanup, `${field}.cleanup`);
    if (typeof candidate.screenshot !== 'string'
      || !/^[A-Z0-9]+(?:-[A-Z0-9]+)*\.png$/.test(candidate.screenshot)) {
      throw new Error(`${field}.screenshot must be a safe relative PNG path`);
    }
    if (!Array.isArray(candidate.assertions) || candidate.assertions.length === 0) {
      throw new Error(`${field}.assertions must contain at least one assertion`);
    }
    for (const [assertionIndex, assertion] of candidate.assertions.entries()) {
      const assertionField = `${field}.assertions[${assertionIndex}]`;
      if (!isRecord(assertion)) throw new Error(`${assertionField} must be an object`);
      if (!UI_AUDIT_METRICS.includes(assertion.metric as UiAuditMetric)) {
        throw new Error(`${assertionField}.metric is unsupported`);
      }
      if (!['atMost', 'atLeast', 'equals'].includes(String(assertion.operator))) {
        throw new Error(`${assertionField}.operator is unsupported`);
      }
      if (NUMERIC_UI_AUDIT_METRICS.has(assertion.metric as UiAuditMetric)) {
        if (typeof assertion.value !== 'number' || !Number.isFinite(assertion.value)) {
          throw new Error(`${assertionField}.value must be a finite number`);
        }
      } else if (assertion.operator !== 'equals') {
        throw new Error(`${assertionField} string metrics require equals`);
      } else if (!isNonEmptyString(assertion.value)) {
        throw new Error(`${assertionField}.value must be a non-empty string`);
      }
    }
    if (candidate.accessibilityFixture === 'finding-005') {
      const assertionsByMetric = new Map(
        candidate.assertions.map((assertion) => [assertion.metric, assertion]),
      );
      const zeroFailureMetrics: UiAuditMetric[] = [
        'controlInventoryFailures',
        'textReadabilityFailures',
        'contrastFailures',
        'contrastUnresolvedFailures',
        'targetSizeFailures',
        'targetOverlapFailures',
        'focusVisibilityFailures',
        'unavailableDescriptionFailures',
      ];
      const positiveCoverageMetrics: UiAuditMetric[] = [
        'textNodesChecked',
        'contrastPairsChecked',
        'targetsChecked',
        'focusTargetsChecked',
      ];
      const requiredMetrics: UiAuditMetric[] = [
        'accessibilityThemeStateCount',
        ...zeroFailureMetrics,
        ...positiveCoverageMetrics,
        'unavailableControlsChecked',
      ];
      const missingMetrics = requiredMetrics.filter((metric) => !assertionsByMetric.has(metric));
      if (missingMetrics.length > 0) {
        throw new Error(`${field}.assertions must cover ${missingMetrics.join(', ')}`);
      }
      const themeCountAssertion = assertionsByMetric.get('accessibilityThemeStateCount')!;
      if (themeCountAssertion.operator !== 'equals' || themeCountAssertion.value !== 2) {
        throw new Error(`${field}.accessibilityThemeStateCount must use equals 2`);
      }
      for (const metric of zeroFailureMetrics) {
        const assertion = assertionsByMetric.get(metric)!;
        if (assertion.operator !== 'equals' || assertion.value !== 0) {
          throw new Error(`${field}.${metric} must use equals 0`);
        }
      }
      for (const metric of positiveCoverageMetrics) {
        const assertion = assertionsByMetric.get(metric)!;
        if (assertion.operator !== 'atLeast'
          || typeof assertion.value !== 'number'
          || assertion.value < 1) {
          throw new Error(`${field}.${metric} must use atLeast 1 or greater`);
        }
      }
      const unavailableCoverage = assertionsByMetric.get('unavailableControlsChecked')!;
      const unavailableCoverageIsExplicitlyEmpty = unavailableCoverage.operator === 'equals'
        && unavailableCoverage.value === 0;
      const unavailableCoverageIsPositive = unavailableCoverage.operator === 'atLeast'
        && typeof unavailableCoverage.value === 'number'
        && unavailableCoverage.value >= 1;
      if (!unavailableCoverageIsExplicitlyEmpty && !unavailableCoverageIsPositive) {
        throw new Error(
          `${field}.unavailableControlsChecked must use equals 0 or atLeast 1 or greater`,
        );
      }
    }
  }

  return input as UiAuditManifest;
}

export type UiAuditTextRole =
  | 'page-title'
  | 'section-title'
  | 'body'
  | 'metadata'
  | 'functional';

const UI_AUDIT_MINIMUM_FONT_SIZES: Record<UiAuditTextRole, number> = {
  'page-title': 28,
  'section-title': 18,
  body: 14,
  metadata: 12,
  functional: 12,
};

export type UiAuditRgba = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
};

export type UiAuditRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function getUiAuditMinimumFontSize(role: UiAuditTextRole): number {
  return UI_AUDIT_MINIMUM_FONT_SIZES[role];
}

export function parseUiAuditCssColor(value: string): UiAuditRgba | null {
  const input = value.trim().toLowerCase();
  const hex = /^#([a-f0-9]{6})([a-f0-9]{2})?$/.exec(input);
  if (hex) {
    const channels = hex[1]!;
    return {
      red: Number.parseInt(channels.slice(0, 2), 16),
      green: Number.parseInt(channels.slice(2, 4), 16),
      blue: Number.parseInt(channels.slice(4, 6), 16),
      alpha: hex[2] ? Number.parseInt(hex[2], 16) / 255 : 1,
    };
  }

  const rgb = /^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(input);
  if (!rgb) return null;
  const alpha = rgb[4]?.endsWith('%')
    ? Number.parseFloat(rgb[4]) / 100
    : Number.parseFloat(rgb[4] ?? '1');
  const channels = rgb.slice(1, 4).map((channel) => Number.parseFloat(channel!));
  if ([...channels, alpha].some((channel) => !Number.isFinite(channel))) return null;
  return {
    red: Math.min(255, Math.max(0, channels[0]!)),
    green: Math.min(255, Math.max(0, channels[1]!)),
    blue: Math.min(255, Math.max(0, channels[2]!)),
    alpha: Math.min(1, Math.max(0, alpha)),
  };
}

export function compositeUiAuditColor(
  foreground: UiAuditRgba,
  background: UiAuditRgba,
): UiAuditRgba {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
  const channel = (foregroundChannel: number, backgroundChannel: number) =>
    (foregroundChannel * foreground.alpha
      + backgroundChannel * background.alpha * (1 - foreground.alpha)) / alpha;
  return {
    red: channel(foreground.red, background.red),
    green: channel(foreground.green, background.green),
    blue: channel(foreground.blue, background.blue),
    alpha,
  };
}

function uiAuditRelativeLuminance(color: UiAuditRgba): number {
  const linear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color.red)
    + 0.7152 * linear(color.green)
    + 0.0722 * linear(color.blue);
}

export function getUiAuditContrastRatio(
  foreground: UiAuditRgba,
  background: UiAuditRgba,
): number {
  const opaqueBackground = background.alpha < 1
    ? compositeUiAuditColor(background, { red: 255, green: 255, blue: 255, alpha: 1 })
    : background;
  const opaqueForeground = foreground.alpha < 1
    ? compositeUiAuditColor(foreground, opaqueBackground)
    : foreground;
  const foregroundLuminance = uiAuditRelativeLuminance(opaqueForeground);
  const backgroundLuminance = uiAuditRelativeLuminance(opaqueBackground);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

export function meetsUiAuditTargetSize(
  rect: UiAuditRect,
  minimum = 44,
): boolean {
  return rect.right - rect.left >= minimum && rect.bottom - rect.top >= minimum;
}

export function getUiAuditTargetOverlapArea(
  left: UiAuditRect,
  right: UiAuditRect,
): number {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  return width * height;
}

export function selectUiAuditCase(manifest: UiAuditManifest, caseId: string): UiAuditCase {
  const auditCase = manifest.cases.find((candidate) => candidate.id === caseId);
  if (!auditCase) throw new Error(`Unknown UI audit case: ${caseId}`);
  return auditCase;
}

export function normalizeCdpRuntimeError(message: unknown): string | null {
  if (!isRecord(message) || typeof message.method !== 'string' || !isRecord(message.params)) {
    return null;
  }

  if (message.method === 'Runtime.exceptionThrown') {
    const details = isRecord(message.params.exceptionDetails)
      ? message.params.exceptionDetails
      : {};
    const exception = isRecord(details.exception) ? details.exception : {};
    return sanitizeRuntimeError(exception.description ?? details.text);
  }

  if (message.method === 'Runtime.consoleAPICalled'
    && (message.params.type === 'error' || message.params.type === 'assert')) {
    const args = Array.isArray(message.params.args) ? message.params.args : [];
    return sanitizeRuntimeError(args.map((argument) => {
      if (!isRecord(argument)) return '';
      return argument.value ?? argument.description ?? '';
    }).join(' ').trim());
  }

  if (message.method === 'Log.entryAdded' && isRecord(message.params.entry)
    && message.params.entry.level === 'error') {
    return sanitizeRuntimeError(message.params.entry.text);
  }

  return null;
}

export function hashUiAuditEntries(entries: UiAuditBuildEntry[]): string {
  const encoder = new TextEncoder();
  const hash = createHash('sha256');
  const normalizedEntries = entries.map((entry) => ({
    ...entry,
    path: entry.path.replaceAll('\\', '/'),
  })).sort((left, right) => left.path.localeCompare(right.path));

  for (const entry of normalizedEntries) {
    const pathBytes = encoder.encode(entry.path);
    const contents = typeof entry.contents === 'string'
      ? encoder.encode(entry.contents)
      : entry.contents;
    hash.update(`${pathBytes.byteLength}:`);
    hash.update(pathBytes);
    hash.update(`${contents.byteLength}:`);
    hash.update(contents);
  }

  return hash.digest('hex');
}

export function getUiAuditRuntimeIdentityErrors(identity: UiAuditRuntimeIdentity): string[] {
  const errors: string[] = [];
  if (identity.runtimeId !== identity.extensionId) {
    errors.push('Runtime extension ID does not match the discovered extension target');
  }
  if (identity.runtimeManifest.name !== identity.localManifest.name
    || identity.runtimeManifest.version !== identity.localManifest.version) {
    errors.push('Running extension manifest does not match the production build manifest');
  }
  if (identity.runtimeManifest.chrome_url_overrides?.newtab !== 'newtab.html'
    || identity.localManifest.chrome_url_overrides?.newtab !== 'newtab.html') {
    errors.push('Running or local manifest does not expose the New Tab override');
  }
  if (identity.runtimeResourceHashes.manifest !== identity.localResourceHashes.manifest) {
    errors.push('Running manifest resource does not match the production build');
  }
  if (identity.runtimeResourceHashes.page !== identity.localResourceHashes.page) {
    errors.push('Running page resource does not match the production build');
  }
  return errors;
}

export function getUiAuditBrowserArgumentErrors(
  browserArguments: string[],
  auditedBuildDirectory: string,
  isolation: UiAuditBrowserIsolation,
): string[] {
  const errors: string[] = [];
  const userDataDirectoryArgument = browserArguments.find((argument) =>
    argument.startsWith('--user-data-dir='));
  if (!userDataDirectoryArgument || userDataDirectoryArgument === '--user-data-dir=') {
    errors.push('Chrome must use an explicit non-default --user-data-dir');
  } else {
    const userDataDirectory = resolve(userDataDirectoryArgument.slice('--user-data-dir='.length));
    const temporaryDirectory = resolve(isolation.temporaryDirectory);
    const pathFromTemporaryDirectory = relative(temporaryDirectory, userDataDirectory);
    const isInsideTemporaryDirectory = pathFromTemporaryDirectory !== ''
      && pathFromTemporaryDirectory !== '..'
      && !pathFromTemporaryDirectory.startsWith(`..${sep}`)
      && !isAbsolute(pathFromTemporaryDirectory);
    const isNamedForAudit = basename(userDataDirectory).startsWith('tabstow-ui-audit.');
    if (!isInsideTemporaryDirectory || !isNamedForAudit || !isolation.profileMarkerExists) {
      errors.push(
        'Chrome profile must be a marked tabstow-ui-audit directory under the system temp directory',
      );
    }
  }
  if (!browserArguments.includes(`--disable-extensions-except=${auditedBuildDirectory}`)) {
    errors.push('Chrome must disable extensions except the audited production build');
  }
  if (!browserArguments.includes(`--load-extension=${auditedBuildDirectory}`)) {
    errors.push('Chrome must load the audited production build');
  }
  return errors;
}

export function evaluateUiAuditCase(
  auditCase: UiAuditCase,
  metrics: UiAuditMetrics,
  runtimeErrors: string[],
): UiAuditCaseResult {
  const assertions = auditCase.assertions.map((assertion): UiAuditAssertionResult => {
    const actual = metrics[assertion.metric];
    let passed = false;

    if (assertion.operator === 'equals') {
      passed = actual === assertion.value;
    } else if (typeof actual === 'number' && Number.isFinite(actual)
      && typeof assertion.value === 'number') {
      passed = assertion.operator === 'atMost'
        ? actual <= assertion.value
        : actual >= assertion.value;
    }

    return {
      ...assertion,
      expected: assertion.value,
      actual,
      passed,
    };
  });

  return {
    caseId: auditCase.id,
    passed: runtimeErrors.length === 0 && assertions.every((assertion) => assertion.passed),
    runtimeErrors: [...runtimeErrors],
    assertions,
  };
}

export function parseUiAuditArguments(argv: string[]): UiAuditArguments {
  const valueFlags = new Set(['--port', '--case', '--output', '--extension-id']);
  const values = new Map<string, string>();
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help') {
      if (help) throw new Error('Duplicate option: --help');
      help = true;
      continue;
    }
    if (!valueFlags.has(flag)) throw new Error(`Unknown option: ${flag}`);
    if (values.has(flag)) throw new Error(`Duplicate option: ${flag}`);

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    values.set(flag, value);
    index += 1;
  }

  const caseId = values.get('--case') ?? '';
  const portInput = values.get('--port') ?? '9333';
  const port = Number(portInput);
  const extensionId = values.get('--extension-id');
  if (!help && !caseId) throw new Error('Missing required --case');
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error(`Invalid --port: ${portInput}`);
  }
  if (extensionId && !/^[a-p]{32}$/.test(extensionId)) {
    throw new Error(`Invalid --extension-id: ${extensionId}`);
  }

  return {
    port,
    caseId,
    outputDirectory: values.get('--output') ?? '.artifacts/ui-audit',
    ...(extensionId ? { extensionId } : {}),
    help,
  };
}
