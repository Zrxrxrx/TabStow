# Use One Extension Theme Preference

`local:tabstow-theme-preferences` is the sole current source for the extension's fixed light or dark mode. New Tab, Settings, and History load it before rendering, apply `data-theme-mode`, and share one watched storage listener per page so open pages stay synchronized. A failed initial read renders the page in light mode and surfaces the error.

Theme is not part of `ExtensionSettings`, default behavior settings, or synchronized settings. The Settings page therefore does not expose a second theme control. Legacy local settings may still contain any `theme` value; the normal settings rewrite ignores and removes it. Version 1 sync documents may also contain any JSON `theme` value; import accepts and strips that field, while new exports omit it.

The authoritative preference key is retained across this migration. Rolling back may let an older version recreate its core default theme, but it does not delete the user's fixed-mode selection. A later upgrade strips the recreated legacy field again and continues using the retained authoritative preference.
