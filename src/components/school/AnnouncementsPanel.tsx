import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Filter,
  Megaphone,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  AnnouncementAudience,
  RolePermissions,
  School,
  SchoolAnnouncement,
} from '../../school/types';
import {
  ANNOUNCEMENT_AUDIENCE_OPTIONS,
  canRoleSeeAnnouncement,
  canStudentSeeAnnouncement,
  isLibrarianOnlyAnnouncement,
} from '../../school/malawi';
import {
  removeSchoolAnnouncement,
  saveSchoolAnnouncement,
} from '../../school/firestoreService';
import { buildModalDraftKey, clearModalDraft, loadModalDraft, saveModalDraft } from '../../school/modalDrafts';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';
import { DraftRestoredNotice, ModalBackdrop } from './ModalBackdrop';

interface AnnouncementsPanelProps {
  school: School;
  rolePermissions: RolePermissions;
  announcements: SchoolAnnouncement[];
  authorDisplayName?: string;
  openCreateTrigger?: number;
}

const AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
  Teachers: 'Teachers',
  Librarian: 'Librarians',
  Students: 'Students',
  Bursar: 'Bursar',
};

const QUICK_AUDIENCE_PRESETS: {
  label: string;
  audiences: AnnouncementAudience[];
}[] = [
  { label: 'General (Students & Teachers)', audiences: ['Teachers', 'Students'] },
  { label: 'Teachers Only', audiences: ['Teachers'] },
  { label: 'Librarians Only', audiences: ['Librarian'] },
  { label: 'All Audiences', audiences: ['Teachers', 'Librarian', 'Students', 'Bursar'] },
];

function isSameAudienceSet(a: AnnouncementAudience[], b: AnnouncementAudience[]): boolean {
  if (a.length !== b.length) return false;
  return b.every((item) => a.includes(item));
}

function formatAudienceLabelList(audiences: AnnouncementAudience[]): string {
  const ordered = ANNOUNCEMENT_AUDIENCE_OPTIONS.map((o) => o.value).filter((v) =>
    audiences.includes(v)
  );
  return ordered.map((v) => AUDIENCE_LABELS[v]).join(', ');
}

function formatAudienceSummary(audiences: AnnouncementAudience[]): {
  label: string;
  studentsCanSee: boolean;
} {
  const list = Array.isArray(audiences) ? audiences : [];
  const studentsCanSee = canStudentSeeAnnouncement(list);
  const librarianOnly = isLibrarianOnlyAnnouncement(list);

  if (studentsCanSee) {
    if (list.includes('Librarian')) {
      return {
        label: 'Students, Teachers, Bursar & Librarians',
        studentsCanSee: true,
      };
    }
    return {
      label: 'Students, Teachers & Bursar',
      studentsCanSee: true,
    };
  }

  if (librarianOnly) {
    const extras = list.includes('Teachers') ? 'Librarians & Teachers' : 'Librarians';
    return {
      label: extras,
      studentsCanSee: false,
    };
  }

  const labelText = formatAudienceLabelList(list);
  return {
    label: labelText || 'Staff',
    studentsCanSee: false,
  };
}

interface AudienceMultiSelectDropdownProps {
  selected: AnnouncementAudience[];
  onChange: (next: AnnouncementAudience[]) => void;
  placeholder?: string;
  emptyMeansAll?: boolean;
  compact?: boolean;
  showPresets?: boolean;
  counts?: Partial<Record<AnnouncementAudience, number>>;
  ariaLabel: string;
}

const AudienceMultiSelectDropdown: React.FC<AudienceMultiSelectDropdownProps> = ({
  selected,
  onChange,
  placeholder = 'Select target audiences...',
  emptyMeansAll = false,
  compact = false,
  showPresets = false,
  counts,
  ariaLabel,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const toggleAudience = (audience: AnnouncementAudience) => {
    onChange(
      selected.includes(audience)
        ? selected.filter((item) => item !== audience)
        : [...selected, audience]
    );
  };

  const selectedLabel =
    selected.length === 0
      ? placeholder
      : selected.length === ANNOUNCEMENT_AUDIENCE_OPTIONS.length
      ? 'All Audiences (Teachers, Librarians, Students, Bursar)'
      : formatAudienceLabelList(selected);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-2 rounded-xl border text-left transition-colors cursor-pointer ${
          compact
            ? 'min-h-[38px] px-3 bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100/70 dark:hover:bg-slate-800'
            : 'min-h-[42px] px-3.5 bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 hover:border-slate-300 dark:hover:border-slate-600'
        }`}
      >
        <span className="flex items-center gap-2 min-w-0 truncate">
          {compact && <Filter className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" aria-hidden="true" />}
          <span
            className={`truncate ${
              selected.length === 0 && !emptyMeansAll
                ? 'text-slate-400 dark:text-slate-500'
                : 'text-slate-900 dark:text-slate-100'
            }`}
          >
            {selectedLabel}
          </span>
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          {selected.length > 0 && (
            <span className="text-[11px] font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
              {selected.length}
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-slate-500 dark:text-slate-400 transition-transform ${
              open ? 'rotate-180' : ''
            }`}
            aria-hidden="true"
          />
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          aria-label={ariaLabel}
          className={`absolute z-40 mt-1.5 rounded-xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-700 shadow-lg overflow-hidden ${
            compact ? 'right-0 w-72 max-w-[calc(100vw-2rem)]' : 'left-0 right-0 w-full'
          }`}
        >
          {showPresets ? (
            <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 flex flex-wrap items-center gap-1.5">
              {QUICK_AUDIENCE_PRESETS.map((preset) => {
                const active = isSameAudienceSet(selected, preset.audiences);
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => onChange([...preset.audiences])}
                    className={`px-2 py-1 rounded-lg text-[11px] font-medium border whitespace-nowrap cursor-pointer transition-colors ${
                      active
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 flex items-center justify-between gap-2 text-[11px]">
              <span className="font-semibold text-slate-600 dark:text-slate-300">
                Filter Target Audiences
              </span>
              {selected.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="font-medium text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                >
                  Show All
                </button>
              )}
            </div>
          )}

          <div className="divide-y divide-slate-100 dark:divide-slate-800/80 max-h-64 overflow-y-auto">
            {ANNOUNCEMENT_AUDIENCE_OPTIONS.map((opt) => {
              const checked = selected.includes(opt.value);
              const countValue = counts?.[opt.value];
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onClick={() => toggleAudience(opt.value)}
                  className={`w-full px-3.5 py-2.5 flex items-start gap-2.5 text-left transition-colors cursor-pointer ${
                    checked
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/35'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-900/60'
                  }`}
                >
                  <span
                    className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                      checked
                        ? 'bg-emerald-700 border-emerald-700 text-white'
                        : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    {checked && <Check className="w-3 h-3" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {opt.label}
                      </span>
                      {typeof countValue === 'number' && (
                        <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {countValue}
                        </span>
                      )}
                    </span>
                    {!compact && (
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5">
                        {opt.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export const AnnouncementsPanel: React.FC<AnnouncementsPanelProps> = ({
  school,
  rolePermissions,
  announcements,
  authorDisplayName = 'School Admin',
  openCreateTrigger,
}) => {
  const todayIso = new Date().toISOString().slice(0, 10);
  const canManage = rolePermissions.canManageStaff;

  const [selectedAudienceFilters, setSelectedAudienceFilters] = useState<AnnouncementAudience[]>([]);

  const roleVisibleAnnouncements = useMemo(() => {
    return announcements
      .filter((a) => canRoleSeeAnnouncement(a.targetAudiences, rolePermissions.role))
      .sort((a, b) => {
        const dateCmp = (b.publishedDate || '').localeCompare(a.publishedDate || '');
        if (dateCmp !== 0) return dateCmp;
        const tA = a.createdAt?.toMillis?.() || 0;
        const tB = b.createdAt?.toMillis?.() || 0;
        return tB - tA;
      });
  }, [announcements, rolePermissions.role]);

  const audienceCounts = useMemo(() => {
    const counts: Record<AnnouncementAudience, number> = {
      Teachers: 0,
      Librarian: 0,
      Students: 0,
      Bursar: 0,
    };
    for (const item of roleVisibleAnnouncements) {
      const list = Array.isArray(item.targetAudiences) ? item.targetAudiences : [];
      const includesStudents = canStudentSeeAnnouncement(list);
      if (includesStudents) counts.Students += 1;
      if (list.includes('Teachers') || includesStudents) counts.Teachers += 1;
      if (list.includes('Librarian')) counts.Librarian += 1;
      if (list.includes('Bursar') || includesStudents) counts.Bursar += 1;
    }
    return counts;
  }, [roleVisibleAnnouncements]);

  const filteredAnnouncements = useMemo(() => {
    if (!canManage || selectedAudienceFilters.length === 0) {
      return roleVisibleAnnouncements;
    }
    return roleVisibleAnnouncements.filter((item) => {
      const list = Array.isArray(item.targetAudiences) ? item.targetAudiences : [];
      return selectedAudienceFilters.some((target) => {
        if (target === 'Librarian') return list.includes('Librarian');
        if (target === 'Students') return canStudentSeeAnnouncement(list);
        if (target === 'Teachers') return list.includes('Teachers') || list.includes('Students');
        if (target === 'Bursar') return list.includes('Bursar') || list.includes('Students');
        return false;
      });
    });
  }, [canManage, selectedAudienceFilters, roleVisibleAnnouncements]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SchoolAnnouncement | null>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [publishedDate, setPublishedDate] = useState(todayIso);
  const [targetAudiences, setTargetAudiences] = useState<AnnouncementAudience[]>(['Teachers', 'Students']);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [draftRestored, setDraftRestored] = useState(false);

  const activeDraftKey = useMemo(
    () => buildModalDraftKey(school.id, 'announcement', editing?.id),
    [editing?.id, school.id]
  );

  useEffect(() => {
    if (!modalOpen) return;
    saveModalDraft(activeDraftKey, {
      title,
      message,
      publishedDate,
      targetAudiences,
    });
  }, [activeDraftKey, message, modalOpen, publishedDate, targetAudiences, title]);

  const [confirmDelete, setConfirmDelete] = useState<SchoolAnnouncement | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const openCreateModal = () => {
    setEditing(null);
    const key = buildModalDraftKey(school.id, 'announcement', null);
    const saved = loadModalDraft<{
      title?: string;
      message?: string;
      publishedDate?: string;
      targetAudiences?: AnnouncementAudience[];
    }>(key);
    if (saved && (saved.title || saved.message)) {
      setTitle(saved.title || '');
      setMessage(saved.message || '');
      setPublishedDate(saved.publishedDate || new Date().toISOString().slice(0, 10));
      setTargetAudiences(
        Array.isArray(saved.targetAudiences) && saved.targetAudiences.length > 0
          ? saved.targetAudiences
          : ['Teachers', 'Students']
      );
      setDraftRestored(true);
    } else {
      setTitle('');
      setMessage('');
      setPublishedDate(new Date().toISOString().slice(0, 10));
      setTargetAudiences(['Teachers', 'Students']);
      setDraftRestored(false);
    }
    setFormError('');
    setModalOpen(true);
  };

  useEffect(() => {
    if (openCreateTrigger && openCreateTrigger > 0 && canManage) {
      openCreateModal();
    }
  }, [openCreateTrigger]);

  const openEditModal = (item: SchoolAnnouncement) => {
    setEditing(item);
    const key = buildModalDraftKey(school.id, 'announcement', item.id);
    const saved = loadModalDraft<{
      title?: string;
      message?: string;
      publishedDate?: string;
      targetAudiences?: AnnouncementAudience[];
    }>(key);
    if (saved && (saved.title !== item.title || saved.message !== item.message)) {
      setTitle(saved.title ?? item.title);
      setMessage(saved.message ?? item.message);
      setPublishedDate(saved.publishedDate || item.publishedDate || new Date().toISOString().slice(0, 10));
      setTargetAudiences(
        Array.isArray(saved.targetAudiences) && saved.targetAudiences.length > 0
          ? saved.targetAudiences
          : item.targetAudiences.length > 0
          ? [...item.targetAudiences]
          : ['Teachers']
      );
      setDraftRestored(true);
    } else {
      setTitle(item.title);
      setMessage(item.message);
      setPublishedDate(item.publishedDate || new Date().toISOString().slice(0, 10));
      setTargetAudiences(item.targetAudiences.length > 0 ? [...item.targetAudiences] : ['Teachers']);
      setDraftRestored(false);
    }
    setFormError('');
    setModalOpen(true);
  };

  const discardDraft = () => {
    clearModalDraft(activeDraftKey);
    if (editing) {
      setTitle(editing.title);
      setMessage(editing.message);
      setPublishedDate(editing.publishedDate || new Date().toISOString().slice(0, 10));
      setTargetAudiences(editing.targetAudiences.length > 0 ? [...editing.targetAudiences] : ['Teachers']);
    } else {
      setTitle('');
      setMessage('');
      setPublishedDate(new Date().toISOString().slice(0, 10));
      setTargetAudiences(['Teachers', 'Students']);
    }
    setDraftRestored(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    if (!title.trim()) {
      setFormError('Announcement title is required.');
      return;
    }
    if (!message.trim()) {
      setFormError('Announcement message is required.');
      return;
    }
    if (targetAudiences.length === 0) {
      setFormError('Select at least one target audience (Teachers, Librarians, Students, or Bursar).');
      return;
    }

    setFormError('');
    setSaving(true);
    try {
      await saveSchoolAnnouncement(
        school.id,
        school.ownerId,
        {
          title: title.trim(),
          message: message.trim(),
          publishedDate,
          targetAudiences,
          authorName: authorDisplayName,
        },
        editing?.id
      );
      clearModalDraft(activeDraftKey);
      setDraftRestored(false);
      setModalOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save announcement.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete || !canManage) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await removeSchoolAnnouncement(school.id, confirmDelete.id);
      setConfirmDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to delete announcement.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section
      aria-label="School announcements"
      className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
            <Megaphone className="w-4 h-4" aria-hidden="true" />
          </div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Announcements{' '}
            <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
              ({filteredAnnouncements.length})
            </span>
          </h2>
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            {roleVisibleAnnouncements.length > 0 && (
              <div className="w-56 max-w-full">
                <AudienceMultiSelectDropdown
                  selected={selectedAudienceFilters}
                  onChange={setSelectedAudienceFilters}
                  placeholder="All Audiences"
                  emptyMeansAll
                  compact
                  counts={audienceCounts}
                  ariaLabel="Filter announcements by target audience"
                />
              </div>
            )}
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>New Announcement</span>
            </button>
          </div>
        )}
      </div>

      {filteredAnnouncements.length === 0 ? (
        <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/70 dark:border-slate-800 px-4 py-5 text-xs text-slate-500 dark:text-slate-400 text-center">
          {canManage
            ? selectedAudienceFilters.length === 0
              ? 'No announcements posted yet. Click New Announcement to notify Teachers, Librarians, or Students.'
              : `No announcements currently match ${formatAudienceLabelList(selectedAudienceFilters)}.`
            : 'No school announcements for your role at this time.'}
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800/80 rounded-xl border border-slate-200/80 dark:border-slate-800 overflow-hidden">
          {filteredAnnouncements.map((item) => {
            const summary = formatAudienceSummary(item.targetAudiences);
            return (
              <article
                key={item.id}
                className="p-4 bg-white dark:bg-[#161B22] flex items-start justify-between gap-4"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {item.title}
                    </h3>
                    <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {item.publishedDate}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {item.message}
                  </p>
                  <div className="pt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>Posted by {item.authorName || 'School Admin'}</span>
                    {canManage && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`inline-flex items-center gap-1 font-medium ${
                            summary.studentsCanSee
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {summary.studentsCanSee ? (
                            <Eye className="w-3 h-3 shrink-0" aria-hidden="true" />
                          ) : (
                            <EyeOff className="w-3 h-3 shrink-0" aria-hidden="true" />
                          )}
                          <span>{summary.label}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {canManage && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditModal(item)}
                      aria-label={`Edit ${item.title}`}
                      className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError('');
                        setConfirmDelete(item);
                      }}
                      aria-label={`Delete ${item.title}`}
                      className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {modalOpen && canManage && (
        <ModalBackdrop
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          disabled={saving}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          ariaLabelledBy="announcement-modal-title"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2
                id="announcement-modal-title"
                className="text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                {editing ? 'Edit Announcement' : 'New School Announcement'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close announcement dialog"
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="mt-4 space-y-4">
              <DraftRestoredNotice visible={draftRestored} onDiscard={discardDraft} />

              {formError && (
                <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Title
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={120}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Mid-Term Examination Timetable"
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    required
                    value={publishedDate}
                    onChange={(e) => setPublishedDate(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Target Audiences
                </label>

                <AudienceMultiSelectDropdown
                  selected={targetAudiences}
                  onChange={setTargetAudiences}
                  placeholder="Choose target audiences..."
                  showPresets
                  ariaLabel="Select target audiences for announcement"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Message
                </label>
                <textarea
                  required
                  rows={4}
                  maxLength={1000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Write the full announcement details..."
                  className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm leading-relaxed"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[42px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {saving ? 'Saving...' : editing ? 'Save Changes' : 'Publish Announcement'}
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      <ConfirmDeleteModal
        open={Boolean(confirmDelete)}
        title="Delete Announcement"
        itemName={confirmDelete?.title || ''}
        description="This will remove the announcement from all staff and student dashboards."
        confirmLabel="Delete Announcement"
        deleting={deleting}
        error={deleteError}
        onCancel={() => {
          if (!deleting) setConfirmDelete(null);
        }}
        onConfirm={handleConfirmDelete}
      />
    </section>
  );
};
