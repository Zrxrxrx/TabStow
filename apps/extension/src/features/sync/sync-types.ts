export type SyncState =
  | 'disconnected'
  | 'authorizing'
  | 'needs-target'
  | 'needs-confirmation'
  | 'synced'
  | 'pending'
  | 'syncing'
  | 'retrying'
  | 'paused';

export type SyncStatusView = {
  state: SyncState;
  message?: string;
  lastSuccessAt?: string;
  retryAt?: number;
  action?: 'reconnect' | 'rebind' | 'inspect-file';
};

export type GitHubAccount = {
  id: number;
  login: string;
};

export type GistBinding = {
  gistId: string;
  fileName: string;
  public: boolean;
  htmlUrl: string;
  ownerId: number;
};

export type GistCandidateView = GistBinding & {
  description: string;
  schemaVersion: 1 | 2;
};

export type PendingGistBinding = GistBinding & {
  targetKey: string;
  fileState: 'valid-v1' | 'valid-v2' | 'empty' | 'missing';
  localCounts: {
    sessionCount: number;
    tabCount: number;
    quickLinkCount: number;
  };
};

export type DeviceFlowView = {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalSeconds: number;
};

export type ConnectionPhase =
  | 'disconnected'
  | 'authorizing'
  | 'needs-target'
  | 'needs-confirmation'
  | 'connected';

export type ConnectionView = {
  phase: ConnectionPhase;
  sync: SyncStatusView;
  account?: GitHubAccount;
  binding?: GistBinding;
  pendingBinding?: PendingGistBinding;
  candidates?: GistCandidateView[];
  deviceFlow?: DeviceFlowView;
};

export type SyncResult = {
  sessionCount: number;
  quickLinkCount: number;
  exportedAt?: string;
  importedAt?: string;
};
