# Tabstow brand extraction

Source reviewed: `/Users/zrx/Dev/tabstow/apps/extension/src/entrypoints/newtab/styles.css` and `/Users/zrx/Dev/tabstow/apps/extension/src/entrypoints/options/styles.css`.

## Tokens

```css
:root {
  --bg:      oklch(97.6% 0.003 264.5);
  --surface: oklch(100.0% 0.000 89.9);
  --fg:      oklch(25.8% 0.017 255.7);
  --muted:   oklch(50.0% 0.029 257.7);
  --border:  oklch(89.6% 0.014 258.3);
  --accent:  oklch(40.7% 0.095 255.7);

  --success-bg: oklch(94.6% 0.021 158.6);
  --success-fg: oklch(42.3% 0.086 151.5);
  --danger-bg:  oklch(93.5% 0.017 17.5);
  --danger-fg:  oklch(43.4% 0.143 25.4);

  --font-display: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}
```

## Posture rules

- Light productivity canvas: `#f6f7f9` page background, white translucent panels, and blue-grey text.
- Primary accent is a reserved deep blue (`#234a7c`) used for main actions, not decorative floods.
- Panel rhythm is compact and tool-like: 1px borders, soft 12px radii, and minimal shadow.
- Existing new tab UI supports themed backgrounds through `--dashboard-background-image` and `--surface-opacity`; preserve that sense of customizable chrome.
- Status colors are calm and system-level: muted blue for info, soft green for success, soft red for errors.
