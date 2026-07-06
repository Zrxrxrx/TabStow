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
  .omit({ githubToken: true })
  .strict();

export const syncDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  deviceId: z.string().min(1),
  exportedAt: z.string().datetime(),
  sessions: z.array(tabSessionSchema),
  settings: safeSyncSettingsSchema,
});

export const DEFAULT_SETTINGS = {
  gistFileName: 'tabstow.sync.json',
  includePinnedTabs: false,
  closePinnedTabs: false,
  theme: 'system',
} as const satisfies z.infer<typeof defaultSettingsSchema>;

export type SavedTab = z.infer<typeof savedTabSchema>;
export type TabSession = z.infer<typeof tabSessionSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type DefaultSettings = z.infer<typeof defaultSettingsSchema>;
export type ExtensionSettings = z.infer<typeof extensionSettingsSchema>;
export type SafeSyncSettings = z.infer<typeof safeSyncSettingsSchema>;
export type SyncDocument = z.infer<typeof syncDocumentSchema>;
