# Support Responsive New Tab Reflow

The V2 New Tab retains its fixed viewport shell and independently scrolling Quick Links, Active Tabs, and Saved for Later regions at effective CSS viewport widths of 1024 pixels or wider. This decision supersedes only the below-1024 layout and scroll-ownership rules in `docs/superpowers/specs/2026-07-13-newtab-v2-frontend-migration-design.md`.

From 768 through 1023 pixels, the viewport-height Quick Links rail and top strip are sticky while the document owns scrolling for stacked Active Tabs and Saved for Later regions. Below 768 pixels, the top strip, Quick Links, feedback, Active Tabs, Saved for Later, and auxiliary controls participate in one document flow in their existing DOM order. Breakpoints use the effective CSS viewport, including page zoom.

Every width avoids horizontal document overflow, exposes the last focusable item in long collections, keeps every existing control available, keeps body-portaled dialogs within the viewport, and preserves pointer drag-and-drop against the current scroll owner. This decision adds no navigation drawer, hidden mobile controls, keyboard reordering, new product behavior, or shared visual-token system.
