import { err, type AppResult } from '@/lib/errors';

let generation = 0;

export function currentTabLifecycleGeneration(): number {
  return generation;
}

export function isCurrentTabLifecycleGeneration(candidate: number): boolean {
  return candidate === generation;
}

export function invalidateTabLifecycleGeneration(): void {
  generation += 1;
}

export function tabLifecycleSettingsChanged<T>(): AppResult<T> {
  return err(
    'operation-in-progress',
    'Tab lifecycle settings changed. Retry the action.',
  );
}
