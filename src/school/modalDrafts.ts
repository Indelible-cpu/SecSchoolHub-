const DRAFT_PREFIX = 'secschoolhub_modal_draft_v1:';

export function buildModalDraftKey(scopeId: string, modalName: string, recordId?: string | null): string {
  const safeScope = String(scopeId || 'global').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeModal = String(modalName || 'modal').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeRecord = recordId ? String(recordId).replace(/[^a-zA-Z0-9_-]/g, '_') : 'new';
  return `${DRAFT_PREFIX}${safeScope}:${safeModal}:${safeRecord}`;
}

export function loadModalDraft<T>(draftKey: string): T | null {
  if (typeof window === 'undefined' || !draftKey) return null;
  try {
    const raw = window.sessionStorage.getItem(draftKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; data?: T };
    if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) return null;
    return (parsed.data as T) ?? null;
  } catch {
    return null;
  }
}

export function saveModalDraft<T>(draftKey: string, data: T): void {
  if (typeof window === 'undefined' || !draftKey) return;
  try {
    window.sessionStorage.setItem(
      draftKey,
      JSON.stringify({
        savedAt: Date.now(),
        data,
      })
    );
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

export function clearModalDraft(draftKey: string): void {
  if (typeof window === 'undefined' || !draftKey) return;
  try {
    window.sessionStorage.removeItem(draftKey);
  } catch {
    // Ignore storage errors
  }
}
