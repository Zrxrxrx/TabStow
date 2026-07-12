import { storage } from '#imports';
import type {
  ConnectionPhase,
  ConnectionView,
  GistBinding,
  GistCandidateView,
  GitHubAccount,
  PendingGistBinding,
  SyncStatusView,
} from './sync-types';

const CONNECTION_KEY = 'local:tabstow-github-connection-v2';
let storeQueue: Promise<void> = Promise.resolve();

export type OAuthAttempt = {
  attemptId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalSeconds: number;
  nextPollAt: number;
};

export type ConnectionRecord = {
  generation: number;
  phase: ConnectionPhase;
  token?: string;
  account?: GitHubAccount;
  binding?: GistBinding;
  pendingBinding?: PendingGistBinding;
  candidates?: GistCandidateView[];
  oauthAttempt?: OAuthAttempt;
  initializationAllowed?: boolean;
  initialReconciliationPending?: boolean;
  retryAttempt?: number;
  retryMode?: 'pull' | 'push';
  lastReadAt?: number;
  sync: SyncStatusView;
};

function disconnectedRecord(generation = 0): ConnectionRecord {
  return {
    generation,
    phase: 'disconnected',
    sync: { state: 'disconnected' },
  };
}

function isConnectionRecord(value: unknown): value is ConnectionRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ConnectionRecord>;
  return (
    Number.isInteger(candidate.generation) &&
    typeof candidate.phase === 'string' &&
    Boolean(candidate.sync) &&
    typeof candidate.sync?.state === 'string'
  );
}

async function readConnectionRecord(): Promise<ConnectionRecord> {
  const stored = await storage.getItem<ConnectionRecord>(CONNECTION_KEY);
  return isConnectionRecord(stored) ? stored : disconnectedRecord();
}

export async function getConnectionRecord(): Promise<ConnectionRecord> {
  await storeQueue;
  return readConnectionRecord();
}

export async function saveConnectionRecord(
  record: ConnectionRecord,
): Promise<ConnectionRecord> {
  const write = storeQueue.then(async () => {
    await storage.setItem(CONNECTION_KEY, record);
    return record;
  });
  storeQueue = write.then(
    () => undefined,
    () => undefined,
  );
  return write;
}

export async function updateConnectionRecord(
  update: (current: ConnectionRecord) => ConnectionRecord,
): Promise<ConnectionRecord> {
  const write = storeQueue.then(async () => {
    const next = update(await readConnectionRecord());
    await storage.setItem(CONNECTION_KEY, next);
    return next;
  });
  storeQueue = write.then(
    () => undefined,
    () => undefined,
  );
  return write;
}

export async function getConnectionView(): Promise<ConnectionView> {
  const record = await getConnectionRecord();
  return {
    phase: record.phase,
    sync: record.sync,
    ...(record.account ? { account: record.account } : {}),
    ...(record.binding ? { binding: record.binding } : {}),
    ...(record.pendingBinding ? { pendingBinding: record.pendingBinding } : {}),
    ...(record.candidates ? { candidates: record.candidates } : {}),
    ...(record.oauthAttempt
      ? {
          deviceFlow: {
            userCode: record.oauthAttempt.userCode,
            verificationUri: record.oauthAttempt.verificationUri,
            expiresAt: record.oauthAttempt.expiresAt,
            intervalSeconds: record.oauthAttempt.intervalSeconds,
          },
        }
      : {}),
  };
}

export async function disconnectConnection(): Promise<ConnectionRecord> {
  return updateConnectionRecord((current) =>
    disconnectedRecord(current.generation + 1),
  );
}
