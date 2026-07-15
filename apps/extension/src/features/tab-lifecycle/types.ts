export const AUTOMATIC_SLEEP_DAY_PRESETS = [1, 3, 7, 14, 30] as const;
export const STOW_SUGGESTION_DAY_PRESETS = [3, 7, 14, 30] as const;

export type AutomaticSleepDays = (typeof AUTOMATIC_SLEEP_DAY_PRESETS)[number];
export type StowSuggestionDays = (typeof STOW_SUGGESTION_DAY_PRESETS)[number];

export type TabLifecyclePolicy = {
  automaticSleepEnabled: boolean;
  automaticSleepAfterDays: AutomaticSleepDays;
  stowSuggestionsEnabled: boolean;
  stowSuggestionAfterDays: StowSuggestionDays;
};

export type AutomaticSleepCapability =
  | { status: 'supported' }
  | { status: 'unsupported' }
  | { status: 'unavailable'; message: string };

export type TabLifecycleState = {
  policy: TabLifecyclePolicy;
  automaticSleepCapability: AutomaticSleepCapability;
};

export const DEFAULT_TAB_LIFECYCLE_POLICY: TabLifecyclePolicy = {
  automaticSleepEnabled: false,
  automaticSleepAfterDays: 7,
  stowSuggestionsEnabled: true,
  stowSuggestionAfterDays: 14,
};
