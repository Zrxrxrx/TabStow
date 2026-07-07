import { z } from 'zod';

export const savedTabSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  title: z.string(),
  favIconUrl: z.string().url().optional(),
  pinned: z.boolean().optional(),
  createdAt: z.string().datetime(),
});

export const tabSessionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  tabs: z.array(savedTabSchema),
  sourceWindowId: z.number().int().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deviceId: z.string().min(1),
});

export const themeSchema = z.enum(['system', 'light', 'dark']);

export const defaultSettingsSchema = z.object({
  gistFileName: z.string().min(1),
  includePinnedTabs: z.boolean(),
  closePinnedTabs: z.boolean(),
  theme: themeSchema,
});

export const extensionSettingsSchema = defaultSettingsSchema.extend({
  deviceId: z.string().min(1),
  githubToken: z.string().min(1).optional(),
  gistId: z.string().min(1).optional(),
});

export const safeSyncSettingsSchema = extensionSettingsSchema
  .omit({ githubToken: true, theme: true })
  .strict();

const syncDocumentSettingsSchema = safeSyncSettingsSchema
  .extend({ theme: themeSchema.optional() })
  .strict()
  .transform(({ theme: _theme, ...settings }) => settings);

const syncedQuickLinkIconSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as { kind?: unknown; value?: unknown };
    if (candidate.kind === 'emoji' && typeof candidate.value === 'string') {
      return { kind: 'emoji', value: candidate.value };
    }
    if (candidate.kind === 'site' && candidate.value === null) {
      return { kind: 'site', value: null };
    }
    return { kind: 'site', value: null };
  },
  z
    .union([
      z.object({ kind: z.literal('emoji'), value: z.string() }),
      z.object({ kind: z.literal('site'), value: z.null() }),
    ])
    .nullable(),
);

export const syncedQuickLinkSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  label: z.string().min(1),
  icon: syncedQuickLinkIconSchema,
  createdAt: z.string().datetime(),
});

export const syncDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  deviceId: z.string().min(1),
  exportedAt: z.string().datetime(),
  sessions: z.array(tabSessionSchema),
  quickLinks: z.array(syncedQuickLinkSchema).default([]),
  settings: syncDocumentSettingsSchema,
}).superRefine((document, context) => {
  const seenSessionIds = new Set<string>();
  const seenQuickLinkIds = new Set<string>();

  for (const [index, session] of document.sessions.entries()) {
    if (seenSessionIds.has(session.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sessions', index, 'id'],
        message: 'Session IDs must be unique.',
      });
      continue;
    }

    seenSessionIds.add(session.id);
  }

  for (const [index, quickLink] of document.quickLinks.entries()) {
    if (seenQuickLinkIds.has(quickLink.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quickLinks', index, 'id'],
        message: 'Quick link IDs must be unique.',
      });
      continue;
    }

    seenQuickLinkIds.add(quickLink.id);
  }
});

export const DEFAULT_SETTINGS = {
  gistFileName: 'tabstow.sync.json',
  includePinnedTabs: false,
  closePinnedTabs: false,
  theme: 'system',
} as const satisfies z.infer<typeof defaultSettingsSchema>;

export function isZodValidationError(error: unknown): error is z.ZodError {
  return error instanceof z.ZodError;
}

export type SavedTab = z.infer<typeof savedTabSchema>;
export type TabSession = z.infer<typeof tabSessionSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type DefaultSettings = z.infer<typeof defaultSettingsSchema>;
export type ExtensionSettings = z.infer<typeof extensionSettingsSchema>;
export type SafeSyncSettings = z.infer<typeof safeSyncSettingsSchema>;
export type SyncDocument = z.infer<typeof syncDocumentSchema>;
export type SyncedQuickLink = z.infer<typeof syncedQuickLinkSchema>;
export type SyncedQuickLinkIcon = NonNullable<
  z.infer<typeof syncedQuickLinkIconSchema>
>;
