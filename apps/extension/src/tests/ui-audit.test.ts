// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import {
  compositeUiAuditColor,
  evaluateUiAuditCase,
  getUiAuditContrastRatio,
  getUiAuditBrowserArgumentErrors,
  getUiAuditMinimumFontSize,
  getUiAuditRuntimeIdentityErrors,
  getUiAuditTargetOverlapArea,
  hashUiAuditEntries,
  meetsUiAuditTargetSize,
  normalizeCdpRuntimeError,
  parseUiAuditCssColor,
  parseUiAuditArguments,
  selectUiAuditCase,
  validateUiAuditManifest,
} from '../../scripts/ui-audit-core';

const manifestInput = {
  schemaVersion: 1,
  baselineCommit: '5bc9f6a765a8464f5bfe74f59620ad4459e87369',
  cases: [{
    id: 'BASELINE',
    description: 'Built New Tab smoke gate',
    page: 'newtab.html',
    viewport: { width: 1440, height: 900 },
    zoom: 1,
    theme: 'light',
    locale: 'en',
    setup: ['Use a dedicated clean Chrome profile.'],
    cleanup: ['Close the generated audit target.'],
    screenshot: 'BASELINE.png',
    assertions: [{
      metric: 'horizontalOverflowPx',
      operator: 'atMost',
      value: 0,
    }],
  }],
};

const feedbackManifestInput = {
  ...manifestInput,
  cases: [{
    ...manifestInput.cases[0],
    id: 'FINDING-004',
    description: 'Action feedback stays above the New Tab workspace',
    viewport: { width: 390, height: 844 },
    feedbackFixture: 'long-error',
    screenshot: 'FINDING-004.png',
    assertions: [
      { metric: 'feedbackCount', operator: 'equals', value: 1 },
      { metric: 'feedbackWorkspaceOverlapAreaPx2', operator: 'atMost', value: 0 },
      { metric: 'feedbackSavedOverlapAreaPx2', operator: 'atMost', value: 0 },
      { metric: 'feedbackViewportOverflowPx', operator: 'atMost', value: 0 },
      { metric: 'feedbackLineCount', operator: 'atLeast', value: 2 },
    ],
  }],
};

const interactionManifestInput = {
  ...manifestInput,
  cases: [{
    ...manifestInput.cases[0],
    id: 'FINDING-006',
    description: 'Keyboard order and modal isolation stay aligned',
    viewport: { width: 768, height: 900 },
    interactionFixture: 'finding-006',
    screenshot: 'FINDING-006.png',
    assertions: [
      { metric: 'focusRegionSequence', operator: 'equals', value: 'top|quick-links|active|saved|auxiliary' },
      { metric: 'tabSequenceComplete', operator: 'equals', value: 1 },
      { metric: 'quickLinkModalIsolationFailures', operator: 'equals', value: 0 },
      { metric: 'modalPortaledCount', operator: 'equals', value: 2 },
      { metric: 'rootInertDuringModal', operator: 'equals', value: 1 },
      { metric: 'lowerModalInert', operator: 'equals', value: 1 },
      { metric: 'topModalInteractive', operator: 'equals', value: 1 },
      { metric: 'focusInTopModal', operator: 'equals', value: 1 },
    ],
  }],
};

const responsiveManifestInput = {
  ...manifestInput,
  cases: [{
    ...manifestInput.cases[0],
    id: 'FINDING-001',
    description: 'Narrow New Tab content reflows into one reachable document flow',
    viewport: { width: 390, height: 844 },
    layoutFixture: 'finding-001-long',
    screenshot: 'FINDING-001.png',
    assertions: [
      { metric: 'horizontalOverflowPx', operator: 'atMost', value: 0 },
      { metric: 'responsiveLayoutMode', operator: 'equals', value: 'single-flow' },
      { metric: 'scrollOwnershipFailures', operator: 'equals', value: 0 },
      { metric: 'lastItemReachabilityFailures', operator: 'equals', value: 0 },
      { metric: 'lastItemsChecked', operator: 'equals', value: 3 },
      { metric: 'dialogViewportOverflowPx', operator: 'atMost', value: 0 },
      { metric: 'railViewportOverflowPx', operator: 'atMost', value: 0 },
      { metric: 'topStripViewportOverflowPx', operator: 'atMost', value: 0 },
      { metric: 'requiredControlVisibilityFailures', operator: 'equals', value: 0 },
    ],
  }],
};

const appearanceManifestInput = {
  ...manifestInput,
  cases: [{
    ...manifestInput.cases[0],
    id: 'FINDING-003-SETTINGS-DESKTOP',
    description: 'Settings shares Tabstow identity, tokens, and workspace navigation',
    page: 'options.html',
    appearanceFixture: 'finding-003',
    screenshot: 'FINDING-003-SETTINGS-DESKTOP.png',
    assertions: [
      { metric: 'appearanceStateCount', operator: 'equals', value: 3 },
      { metric: 'appearanceRuntimeFailures', operator: 'equals', value: 0 },
      { metric: 'sharedTokenSignatures', operator: 'equals', value: 'none:light|light:light|dark:dark' },
      { metric: 'utilityShellFailures', operator: 'equals', value: 0 },
      { metric: 'utilityBackRouteFailures', operator: 'equals', value: 0 },
      { metric: 'backControlHeightPx', operator: 'atLeast', value: 44 },
      { metric: 'backViewportOverflowPx', operator: 'atMost', value: 0 },
      { metric: 'newtabComputedStyleSignatures', operator: 'equals', value: 'not-applicable' },
    ],
  }],
};

const accessibilityManifestInput = {
  ...manifestInput,
  cases: [{
    ...manifestInput.cases[0],
    id: 'FINDING-005-NEWTAB-LIGHT-1440',
    description: 'New Tab readability and effective targets pass in light desktop mode',
    accessibilityFixture: 'finding-005',
    screenshot: 'FINDING-005-NEWTAB-LIGHT-1440.png',
    assertions: [
      { metric: 'accessibilityThemeStateCount', operator: 'equals', value: 2 },
      { metric: 'controlInventoryFailures', operator: 'equals', value: 0 },
      { metric: 'textReadabilityFailures', operator: 'equals', value: 0 },
      { metric: 'textNodesChecked', operator: 'atLeast', value: 1 },
      { metric: 'contrastFailures', operator: 'equals', value: 0 },
      { metric: 'contrastPairsChecked', operator: 'atLeast', value: 1 },
      { metric: 'contrastUnresolvedFailures', operator: 'equals', value: 0 },
      { metric: 'targetSizeFailures', operator: 'equals', value: 0 },
      { metric: 'targetsChecked', operator: 'atLeast', value: 1 },
      { metric: 'targetOverlapFailures', operator: 'equals', value: 0 },
      { metric: 'focusVisibilityFailures', operator: 'equals', value: 0 },
      { metric: 'focusTargetsChecked', operator: 'atLeast', value: 1 },
      { metric: 'unavailableDescriptionFailures', operator: 'equals', value: 0 },
      { metric: 'unavailableControlsChecked', operator: 'atLeast', value: 1 },
    ],
  }],
};

describe('UI audit command', () => {
  it('parses a named case and deterministic output settings', () => {
    expect(parseUiAuditArguments([
      '--port',
      '9333',
      '--case',
      'BASELINE',
      '--output',
      '.artifacts/ui-audit/example',
      '--extension-id',
      'abcdefghijklmnopabcdefghijklmnop',
    ])).toEqual({
      port: 9333,
      caseId: 'BASELINE',
      outputDirectory: '.artifacts/ui-audit/example',
      extensionId: 'abcdefghijklmnopabcdefghijklmnop',
      help: false,
    });
  });

  it('rejects an audit run without a named case', () => {
    expect(() => parseUiAuditArguments(['--port', '9333'])).toThrow(
      'Missing required --case',
    );
  });

  it('rejects an invalid CDP port', () => {
    expect(() => parseUiAuditArguments([
      '--port',
      '80',
      '--case',
      'BASELINE',
    ])).toThrow('Invalid --port');
  });

  it('rejects unknown or valueless flags', () => {
    expect(() => parseUiAuditArguments([
      '--case',
      'BASELINE',
      '--unknown',
    ])).toThrow('Unknown option: --unknown');
    expect(() => parseUiAuditArguments(['--case'])).toThrow(
      'Missing value for --case',
    );
  });

  it('rejects an invalid expected extension ID', () => {
    expect(() => parseUiAuditArguments([
      '--case',
      'BASELINE',
      '--extension-id',
      'not-an-extension-id',
    ])).toThrow('Invalid --extension-id');
  });
});

describe('UI audit manifest', () => {
  it('accepts the versioned baseline case contract', () => {
    expect(validateUiAuditManifest(manifestInput)).toEqual(manifestInput);
  });

  it('accepts a feedback fixture with geometry assertions', () => {
    expect(validateUiAuditManifest(feedbackManifestInput)).toEqual(feedbackManifestInput);
  });

  it('accepts the focused FINDING-006 interaction fixture', () => {
    expect(validateUiAuditManifest(interactionManifestInput)).toEqual(interactionManifestInput);
  });

  it('accepts the focused FINDING-001 responsive layout fixture', () => {
    expect(validateUiAuditManifest(responsiveManifestInput)).toEqual(responsiveManifestInput);
  });

  it('accepts the focused FINDING-003 shared appearance fixture', () => {
    expect(validateUiAuditManifest(appearanceManifestInput)).toEqual(appearanceManifestInput);
  });

  it('accepts the focused FINDING-005 accessibility fixture', () => {
    expect(validateUiAuditManifest(accessibilityManifestInput)).toEqual(accessibilityManifestInput);
  });

  it('keeps the checked-in case manifest valid', () => {
    const checkedInManifest = JSON.parse(readFileSync(
      new URL('../../scripts/ui-audit-cases.json', import.meta.url),
      'utf8',
    ));
    expect(validateUiAuditManifest(checkedInManifest).cases.map(({ id }) => id)).toEqual([
      'BASELINE',
      'FINDING-002-LIGHT',
      'FINDING-002-DARK',
      'FINDING-004-NONE',
      'FINDING-004-STOW',
      'FINDING-004-RESTORE',
      'FINDING-004',
      'FINDING-006-DESKTOP',
      'FINDING-006',
      'FINDING-001-DESKTOP',
      'FINDING-001-1024',
      'FINDING-001-768',
      'FINDING-001',
      'FINDING-001-ZOOM',
      'FINDING-003-NEWTAB-DESKTOP',
      'FINDING-003-NEWTAB-NARROW',
      'FINDING-003-SETTINGS-DESKTOP',
      'FINDING-003-SETTINGS-NARROW',
      'FINDING-003-HISTORY-DESKTOP',
      'FINDING-003-HISTORY-NARROW',
      'FINDING-005-NEWTAB-1440',
      'FINDING-005-NEWTAB-768',
      'FINDING-005-NEWTAB-390',
      'FINDING-005-NEWTAB-ZOOM',
      'FINDING-005-SETTINGS-1440',
      'FINDING-005-SETTINGS-768',
      'FINDING-005-SETTINGS-390',
      'FINDING-005-SETTINGS-ZOOM',
      'FINDING-005-HISTORY-1440',
      'FINDING-005-HISTORY-768',
      'FINDING-005-HISTORY-390',
      'FINDING-005-HISTORY-ZOOM',
    ]);
  });

  it('covers FINDING-005 across every page and required viewport profile', () => {
    const checkedInManifest = validateUiAuditManifest(JSON.parse(readFileSync(
      new URL('../../scripts/ui-audit-cases.json', import.meta.url),
      'utf8',
    )));
    const cases = checkedInManifest.cases.filter(({ accessibilityFixture }) =>
      accessibilityFixture === 'finding-005');

    expect(cases.map(({ page, viewport, zoom }) => ({
      page,
      width: viewport.width,
      height: viewport.height,
      zoom,
    }))).toEqual([
      { page: 'newtab.html', width: 1440, height: 900, zoom: 1 },
      { page: 'newtab.html', width: 768, height: 900, zoom: 1 },
      { page: 'newtab.html', width: 390, height: 844, zoom: 1 },
      { page: 'newtab.html', width: 1024, height: 900, zoom: 2 },
      { page: 'options.html', width: 1440, height: 900, zoom: 1 },
      { page: 'options.html', width: 768, height: 900, zoom: 1 },
      { page: 'options.html', width: 390, height: 844, zoom: 1 },
      { page: 'options.html', width: 1024, height: 900, zoom: 2 },
      { page: 'saved-history.html', width: 1440, height: 900, zoom: 1 },
      { page: 'saved-history.html', width: 768, height: 900, zoom: 1 },
      { page: 'saved-history.html', width: 390, height: 844, zoom: 1 },
      { page: 'saved-history.html', width: 1024, height: 900, zoom: 2 },
    ]);
    for (const auditCase of cases) {
      expect(auditCase.assertions).toEqual(expect.arrayContaining([
        { metric: 'accessibilityThemeStateCount', operator: 'equals', value: 2 },
        { metric: 'controlInventoryFailures', operator: 'equals', value: 0 },
        { metric: 'textReadabilityFailures', operator: 'equals', value: 0 },
        { metric: 'contrastFailures', operator: 'equals', value: 0 },
        { metric: 'targetSizeFailures', operator: 'equals', value: 0 },
        { metric: 'targetOverlapFailures', operator: 'equals', value: 0 },
        { metric: 'focusVisibilityFailures', operator: 'equals', value: 0 },
        { metric: 'unavailableDescriptionFailures', operator: 'equals', value: 0 },
      ]));
    }
  });

  it('covers first-use guidance in both themes and locales', () => {
    const checkedInManifest = validateUiAuditManifest(JSON.parse(readFileSync(
      new URL('../../scripts/ui-audit-cases.json', import.meta.url),
      'utf8',
    )));
    const findingCases = checkedInManifest.cases.filter(({ id }) =>
      id === 'FINDING-002-LIGHT' || id === 'FINDING-002-DARK');

    expect(findingCases.map(({ locale, theme }) => ({ locale, theme }))).toEqual([
      { locale: 'en', theme: 'light' },
      { locale: 'zh-CN', theme: 'dark' },
    ]);
    for (const auditCase of findingCases) {
      expect(auditCase.assertions).toEqual(expect.arrayContaining([
        { metric: 'firstUseGuidanceFailures', operator: 'equals', value: 0 },
        { metric: 'stowUnavailableFailures', operator: 'equals', value: 0 },
      ]));
    }
  });

  it('checks long collection reachability at 390 pixels', () => {
    const checkedInManifest = validateUiAuditManifest(JSON.parse(readFileSync(
      new URL('../../scripts/ui-audit-cases.json', import.meta.url),
      'utf8',
    )));
    const narrowCase = checkedInManifest.cases.find(({ id }) => id === 'FINDING-001');

    expect(narrowCase).toMatchObject({
      layoutFixture: 'finding-001-long',
      assertions: expect.arrayContaining([
        { metric: 'lastItemsChecked', operator: 'equals', value: 3 },
      ]),
    });
  });

  it('rejects a case name that is absent from the manifest', () => {
    const manifest = validateUiAuditManifest(manifestInput);
    expect(() => selectUiAuditCase(manifest, 'MISSING')).toThrow(
      'Unknown UI audit case: MISSING',
    );
  });

  it('rejects an unknown feedback fixture', () => {
    const invalidManifest = structuredClone(feedbackManifestInput);
    invalidManifest.cases[0]!.feedbackFixture = 'custom-message';
    expect(() => validateUiAuditManifest(invalidManifest)).toThrow(
      'feedbackFixture is unsupported',
    );
  });

  it('rejects an unknown interaction fixture', () => {
    const invalidManifest = structuredClone(interactionManifestInput);
    invalidManifest.cases[0]!.interactionFixture = 'custom-actions';
    expect(() => validateUiAuditManifest(invalidManifest)).toThrow(
      'interactionFixture is unsupported',
    );
  });

  it('rejects an unknown responsive layout fixture', () => {
    const invalidManifest = structuredClone(responsiveManifestInput);
    invalidManifest.cases[0]!.layoutFixture = 'custom-layout';
    expect(() => validateUiAuditManifest(invalidManifest)).toThrow(
      'layoutFixture is unsupported',
    );
  });

  it('rejects an unknown shared appearance fixture', () => {
    const invalidManifest = structuredClone(appearanceManifestInput);
    invalidManifest.cases[0]!.appearanceFixture = 'custom-appearance';
    expect(() => validateUiAuditManifest(invalidManifest)).toThrow(
      'appearanceFixture is unsupported',
    );
  });

  it('rejects an unknown accessibility fixture', () => {
    const invalidManifest = structuredClone(accessibilityManifestInput);
    invalidManifest.cases[0]!.accessibilityFixture = 'custom-accessibility';
    expect(() => validateUiAuditManifest(invalidManifest)).toThrow(
      'accessibilityFixture is unsupported',
    );
  });

  it('requires the complete FINDING-005 assertion bundle', () => {
    const invalidManifest = structuredClone(accessibilityManifestInput);
    invalidManifest.cases[0]!.assertions = invalidManifest.cases[0]!.assertions.filter(
      ({ metric }) => metric !== 'targetOverlapFailures',
    );
    expect(() => validateUiAuditManifest(invalidManifest)).toThrow(
      'assertions must cover targetOverlapFailures',
    );
  });

  it('requires zero-failure assertions to use exact zero thresholds', () => {
    const invalidManifest = structuredClone(accessibilityManifestInput);
    const targetSizeAssertion = invalidManifest.cases[0]!.assertions.find(
      ({ metric }) => metric === 'targetSizeFailures',
    )!;
    targetSizeAssertion.operator = 'atMost';

    expect(() => validateUiAuditManifest(invalidManifest)).toThrow(
      'targetSizeFailures must use equals 0',
    );
  });

  it('rejects vacuous FINDING-005 coverage thresholds', () => {
    const invalidManifest = structuredClone(accessibilityManifestInput);
    const targetsCheckedAssertion = invalidManifest.cases[0]!.assertions.find(
      ({ metric }) => metric === 'targetsChecked',
    )!;
    targetsCheckedAssertion.value = 0;

    expect(() => validateUiAuditManifest(invalidManifest)).toThrow(
      'targetsChecked must use atLeast 1 or greater',
    );
  });

  it('rejects range operators for string-valued metrics', () => {
    const invalidManifest = structuredClone(manifestInput);
    invalidManifest.cases[0]!.assertions[0] = {
      metric: 'themeMode',
      operator: 'atMost',
      value: 1,
    };
    expect(() => validateUiAuditManifest(invalidManifest)).toThrow(
      'string metrics require equals',
    );
  });
});

describe('UI audit assertions', () => {
  it('fails a selected case when an observed threshold is breached', () => {
    const auditCase = validateUiAuditManifest(manifestInput).cases[0]!;
    const result = evaluateUiAuditCase(auditCase, {
      rootChildCount: 1,
      horizontalOverflowPx: 12,
      themeMode: 'light',
      locale: 'en',
      pagePath: '/newtab.html',
      workspaceLandmarks: 'Quick links|Active tabs|Saved windows',
      viewportWidth: 1440,
      viewportHeight: 900,
      zoom: 1,
      feedbackCount: 0,
      feedbackWorkspaceOverlapAreaPx2: 0,
      feedbackSavedOverlapAreaPx2: 0,
      feedbackViewportOverflowPx: 0,
      feedbackLineCount: 0,
      topWorkspaceGapPx: 0,
      focusRegionSequence: 'top|quick-links|active|saved|auxiliary',
      tabSequenceComplete: 1,
      quickLinkModalIsolationFailures: 0,
      modalPortaledCount: 0,
      rootInertDuringModal: 0,
      lowerModalInert: 0,
      topModalInteractive: 0,
      focusInTopModal: 0,
      responsiveLayoutMode: '',
      scrollOwnershipFailures: 0,
      lastItemReachabilityFailures: 0,
      lastItemsChecked: 0,
      dialogViewportOverflowPx: 0,
      railViewportOverflowPx: 0,
      topStripViewportOverflowPx: 0,
      requiredControlVisibilityFailures: 0,
      firstUseGuidanceFailures: 0,
      stowUnavailableFailures: 0,
      appearanceStateCount: 0,
      appearanceRuntimeFailures: 0,
      sharedTokenSignatures: 'not-applicable',
      newtabComputedStyleSignatures: 'not-applicable',
      utilityShellFailures: 0,
      utilityBackRouteFailures: 0,
      backControlHeightPx: 0,
      backViewportOverflowPx: 0,
      accessibilityThemeStateCount: 0,
      controlInventoryFailures: 0,
      textReadabilityFailures: 0,
      textNodesChecked: 0,
      contrastFailures: 0,
      contrastPairsChecked: 0,
      contrastUnresolvedFailures: 0,
      targetSizeFailures: 0,
      targetsChecked: 0,
      targetOverlapFailures: 0,
      focusVisibilityFailures: 0,
      focusTargetsChecked: 0,
      unavailableDescriptionFailures: 0,
      unavailableControlsChecked: 0,
    }, []);

    expect(result.passed).toBe(false);
    expect(result.assertions).toEqual([expect.objectContaining({
      metric: 'horizontalOverflowPx',
      expected: 0,
      actual: 12,
      passed: false,
    })]);
  });

  it('treats captured runtime errors as a non-configurable failure', () => {
    const auditCase = validateUiAuditManifest(manifestInput).cases[0]!;
    const result = evaluateUiAuditCase(auditCase, {
      rootChildCount: 1,
      horizontalOverflowPx: 0,
      themeMode: 'light',
      locale: 'en',
      pagePath: '/newtab.html',
      workspaceLandmarks: 'Quick links|Active tabs|Saved windows',
      viewportWidth: 1440,
      viewportHeight: 900,
      zoom: 1,
      feedbackCount: 0,
      feedbackWorkspaceOverlapAreaPx2: 0,
      feedbackSavedOverlapAreaPx2: 0,
      feedbackViewportOverflowPx: 0,
      feedbackLineCount: 0,
      topWorkspaceGapPx: 0,
      focusRegionSequence: 'top|quick-links|active|saved|auxiliary',
      tabSequenceComplete: 1,
      quickLinkModalIsolationFailures: 0,
      modalPortaledCount: 0,
      rootInertDuringModal: 0,
      lowerModalInert: 0,
      topModalInteractive: 0,
      focusInTopModal: 0,
      responsiveLayoutMode: '',
      scrollOwnershipFailures: 0,
      lastItemReachabilityFailures: 0,
      lastItemsChecked: 0,
      dialogViewportOverflowPx: 0,
      railViewportOverflowPx: 0,
      topStripViewportOverflowPx: 0,
      requiredControlVisibilityFailures: 0,
      firstUseGuidanceFailures: 0,
      stowUnavailableFailures: 0,
      appearanceStateCount: 0,
      appearanceRuntimeFailures: 0,
      sharedTokenSignatures: 'not-applicable',
      newtabComputedStyleSignatures: 'not-applicable',
      utilityShellFailures: 0,
      utilityBackRouteFailures: 0,
      backControlHeightPx: 0,
      backViewportOverflowPx: 0,
      accessibilityThemeStateCount: 0,
      controlInventoryFailures: 0,
      textReadabilityFailures: 0,
      textNodesChecked: 0,
      contrastFailures: 0,
      contrastPairsChecked: 0,
      contrastUnresolvedFailures: 0,
      targetSizeFailures: 0,
      targetsChecked: 0,
      targetOverlapFailures: 0,
      focusVisibilityFailures: 0,
      focusTargetsChecked: 0,
      unavailableDescriptionFailures: 0,
      unavailableControlsChecked: 0,
    }, ['Unhandled exception']);

    expect(result.assertions.every((assertion) => assertion.passed)).toBe(true);
    expect(result.passed).toBe(false);
  });
});

describe('UI accessibility thresholds', () => {
  it('uses the reviewed type scale for every text role', () => {
    expect(getUiAuditMinimumFontSize('page-title')).toBe(28);
    expect(getUiAuditMinimumFontSize('section-title')).toBe(18);
    expect(getUiAuditMinimumFontSize('body')).toBe(14);
    expect(getUiAuditMinimumFontSize('metadata')).toBe(12);
    expect(getUiAuditMinimumFontSize('functional')).toBe(12);
  });

  it('calculates opaque and composited contrast deterministically', () => {
    const black = parseUiAuditCssColor('#000000')!;
    const white = parseUiAuditCssColor('rgb(255, 255, 255)')!;
    const gray = parseUiAuditCssColor('#777777')!;
    const translucentBlack = parseUiAuditCssColor('rgba(0, 0, 0, 0.5)')!;

    expect(getUiAuditContrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(getUiAuditContrastRatio(gray, white)).toBeLessThan(4.5);
    expect(compositeUiAuditColor(translucentBlack, white)).toMatchObject({
      red: 127.5,
      green: 127.5,
      blue: 127.5,
      alpha: 1,
    });
    expect(parseUiAuditCssColor('linear-gradient(red, blue)')).toBeNull();
  });

  it('enforces 44px targets and treats edge-touching rectangles as non-overlapping', () => {
    const target = { left: 0, top: 0, right: 44, bottom: 44 };
    expect(meetsUiAuditTargetSize(target)).toBe(true);
    expect(meetsUiAuditTargetSize({ ...target, right: 43.99 })).toBe(false);
    expect(getUiAuditTargetOverlapArea(
      target,
      { left: 44, top: 0, right: 88, bottom: 44 },
    )).toBe(0);
    expect(getUiAuditTargetOverlapArea(
      target,
      { left: 40, top: 0, right: 84, bottom: 44 },
    )).toBe(176);
  });
});

describe('CDP runtime error gate', () => {
  it('normalizes exceptions and error-level console events only', () => {
    expect(normalizeCdpRuntimeError({
      method: 'Runtime.exceptionThrown',
      params: { exceptionDetails: { exception: { description: 'Error: broken' } } },
    })).toBe('Error: broken');
    expect(normalizeCdpRuntimeError({
      method: 'Runtime.consoleAPICalled',
      params: { type: 'error', args: [{ value: 'failed' }, { description: 'request' }] },
    })).toBe('failed request');
    expect(normalizeCdpRuntimeError({
      method: 'Runtime.consoleAPICalled',
      params: { type: 'log', args: [{ value: 'diagnostic' }] },
    })).toBeNull();
  });
});

describe('UI audit build identity', () => {
  it('hashes normalized build entries independently of traversal order', () => {
    const first = hashUiAuditEntries([
      { path: 'manifest.json', contents: '{"name":"Tabstow"}' },
      { path: 'assets/newtab.js', contents: 'console.log("ready")' },
    ]);
    const reordered = hashUiAuditEntries([
      { path: 'assets\\newtab.js', contents: 'console.log("ready")' },
      { path: 'manifest.json', contents: '{"name":"Tabstow"}' },
    ]);
    const changed = hashUiAuditEntries([
      { path: 'manifest.json', contents: '{"name":"Changed"}' },
      { path: 'assets/newtab.js', contents: 'console.log("ready")' },
    ]);

    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('accepts a utility page when the runtime resources match the local build', () => {
    expect(getUiAuditRuntimeIdentityErrors({
      extensionId: 'abcdefghijklmnopabcdefghijklmnop',
      runtimeId: 'abcdefghijklmnopabcdefghijklmnop',
      localManifest: {
        name: 'Tabstow',
        version: '2.1.0',
        chrome_url_overrides: { newtab: 'newtab.html' },
      },
      runtimeManifest: {
        name: 'Tabstow',
        version: '2.1.0',
        chrome_url_overrides: { newtab: 'newtab.html' },
      },
      localResourceHashes: { manifest: 'manifest-hash', page: 'options-hash' },
      runtimeResourceHashes: { manifest: 'manifest-hash', page: 'options-hash' },
    })).toEqual([]);
  });

  it('rejects a runtime page from a stale build', () => {
    expect(getUiAuditRuntimeIdentityErrors({
      extensionId: 'abcdefghijklmnopabcdefghijklmnop',
      runtimeId: 'abcdefghijklmnopabcdefghijklmnop',
      localManifest: {
        name: 'Tabstow',
        version: '2.1.0',
        chrome_url_overrides: { newtab: 'newtab.html' },
      },
      runtimeManifest: {
        name: 'Tabstow',
        version: '2.1.0',
        chrome_url_overrides: { newtab: 'newtab.html' },
      },
      localResourceHashes: { manifest: 'manifest-hash', page: 'current-page-hash' },
      runtimeResourceHashes: { manifest: 'manifest-hash', page: 'stale-page-hash' },
    })).toContain('Running page resource does not match the production build');
  });
});

describe('UI audit browser isolation', () => {
  it('requires a disposable profile and the exact production build flags', () => {
    const buildDirectory = '/repo/apps/extension/.output/chrome-mv3';
    expect(getUiAuditBrowserArgumentErrors([
      '/path/to/chrome',
      '--enable-automation',
      '--remote-debugging-address=127.0.0.1',
      '--user-data-dir=/tmp/tabstow-ui-audit.example',
      `--disable-extensions-except=${buildDirectory}`,
      `--load-extension=${buildDirectory}`,
    ], buildDirectory, {
      temporaryDirectory: '/tmp',
      profileMarkerExists: true,
    })).toEqual([]);
    expect(getUiAuditBrowserArgumentErrors([
      '/path/to/chrome',
      '--enable-automation',
      '--remote-debugging-address=127.0.0.1',
    ], buildDirectory, {
      temporaryDirectory: '/tmp',
      profileMarkerExists: false,
    })).toEqual([
      'Chrome must use an explicit non-default --user-data-dir',
      'Chrome must disable extensions except the audited production build',
      'Chrome must load the audited production build',
    ]);
  });

  it('rejects a daily-use profile even when Chrome receives an explicit path', () => {
    const buildDirectory = '/repo/apps/extension/.output/chrome-mv3';
    expect(getUiAuditBrowserArgumentErrors([
      '/path/to/chrome',
      '--user-data-dir=fixtures/daily-use-profile',
      `--disable-extensions-except=${buildDirectory}`,
      `--load-extension=${buildDirectory}`,
    ], buildDirectory, {
      temporaryDirectory: '/tmp',
      profileMarkerExists: false,
    })).toContain(
      'Chrome profile must be a marked tabstow-ui-audit directory under the system temp directory',
    );
  });
});
