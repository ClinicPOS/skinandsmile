const eventName = 'pos-financial-change';
// Revision signals contain no patient data, credentials or financial amounts.
export function announceFinancialChange() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(eventName));
  try { window.localStorage.setItem(eventName, String(Date.now())); } catch { /* local event still works */ }
}
export function subscribeFinancialChanges(refresh: () => void) {
  let dirty = false;
  const changed = () => { if (document.visibilityState === 'hidden') dirty = true; else refresh(); };
  const storage = (event: StorageEvent) => { if (event.key === eventName) changed(); };
  const focus = () => { if (dirty && document.visibilityState !== 'hidden') { dirty = false; refresh(); } };
  window.addEventListener(eventName, changed);
  window.addEventListener('storage', storage);
  window.addEventListener('focus', focus);
  document.addEventListener('visibilitychange', focus);
  return () => {
    window.removeEventListener(eventName, changed); window.removeEventListener('storage', storage);
    window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus);
  };
}
