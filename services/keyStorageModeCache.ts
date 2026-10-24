/** Per-sign-in cache. A failed deployment lookup deliberately keeps legacy mode. */
export function createKeyStorageModeCache(fetchMode: () => Promise<boolean>) {
  let uid: string | undefined;
  let mode = false;
  let pending: Promise<boolean> | undefined;
  let generation = 0;
  return {
    enabled(currentUid?: string): boolean { return currentUid === uid && mode; },
    reset(): void { generation++; uid = undefined; mode = false; pending = undefined; },
    load(currentUid: string): Promise<boolean> {
      if (uid === currentUid && pending) return pending;
      uid = currentUid; mode = false;
      const requestGeneration = ++generation;
      pending = Promise.resolve().then(fetchMode).then(value => value === true).catch(() => false)
        .then(value => { if (generation === requestGeneration) mode = value; return value; });
      return pending;
    },
  };
}
