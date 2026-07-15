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
