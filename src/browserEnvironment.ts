// Only the dedicated preview document opts into the isolated simulator store.
export const isPhonePreview =
  typeof document !== 'undefined' && document.documentElement.dataset.phonePreview === 'true';

export const browserDatabaseName = isPhonePreview ? 'ludian-phone-simulator' : 'guilu-attendance';

export function browserPreferenceKey(key: string) {
  return isPhonePreview ? `ludian-phone-simulator:${key}` : key;
}
