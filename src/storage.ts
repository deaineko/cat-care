/** ストレージの永続化を要求（iOS の eviction 対策の第一防御線）。 */
export async function requestPersist(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
