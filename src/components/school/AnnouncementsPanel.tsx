import React, { useMemo, useState } from 'react';
import { Megaphone, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  AnnouncementAudience,
  RolePermissions,
  School,
  SchoolAnnouncement,
} from '../../school/types';
import {
  ANNOUNCEMENT_AUDIENCE_OPTIONS,
  canRoleSeeAnnouncement,
} from '../../school/malawi';
import {
  removeSchoolAnnouncement,
  saveSchoolAnnouncement,
} from '../../school/firestoreService';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';

interface AnnouncementsPanelProps {
  school: School;
  rolePermissions: RolePermissions;
  announcements: SchoolAnnouncement[];
  authorDisplayName?: string;
}

function formatAudienceSummary(audiences: AnnouncementAudience[]): string {
  const list = Array.isArray(audiences) ? audiences : [];
  const hasStudents = list.includes('Students');
  const hasLibrarian = list.includes('Librarian');
  const hasTeachers = list.includes('Teachers');
  const hasBursar = list.includes('Bursar');

  if (hasStudents) {
    if (hasLibrarian) {
      return 'All Staff (including Teachers, Bursar & Librarian) & Students';
    }
    return 'Students, Teachers, Bursar & Leadership (except Librarian)';
  }

  const labels: string[] = [];
  if (hasTeachers) labels.push('Teachers');
  if (hasBursar) labels.push('Bursar');
  if (hasLibrarian) labels.push('Librarian');
  return labels.length > 0 ? labels.join(', ') : 'Staff';
}

export const AnnouncementsPanel: React.FC<AnnouncementsPanelProps> = ({
  school,
  rolePermissions,
  announcements,
  authorDisplayName = 'School Admin',
}) => {
  const todayIso = new Date().toISOString().slice(0, 10);
  const canManage = rolePermissions.canManageStaff;

  const visibleAnnouncements = useMemo(() => {
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

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SchoolAnnouncement | null>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [publishedDate, setPublishedDate] = useState(todayIso);
  const [targetAudiences, setTargetAudiences] = useState<AnnouncementAudience[]>(['Teachers']);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [confirmDelete, setConfirmDelete] = useState<SchoolAnnouncement | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const openCreateModal = () => {
    setEditing(null);
    setTitle('');
    setMessage('');
    setPublishedDate(new Date().toISOString().slice(0, 10));
    setTargetAudiences(['Teachers']);
    setFormError('');
    setModalOpen(true);
  };

  const openEditModal = (item: SchoolAnnouncement) => {
    setEditing(item);
    setTitle(item.title);
    setMessage(item.message);
    setPublishedDate(item.publishedDate || new Date().toISOString().slice(0, 10));
    setTargetAudiences(item.targetAudiences.length > 0 ? [...item.targetAudiences] : ['Teachers']);
    setFormError('');
    setModalOpen(true);
  };

  const toggleAudience = (audience: AnnouncementAudience) => {
    setTargetAudiences((prev) =>
      prev.includes(audience) ? prev.filter((a) => a !== audience) : [...prev, audience]
    );
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
      setFormError('Select at least one audience group.');
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

  const includesStudentsOnlyWithoutLibrarian =
    targetAudiences.includes('Students') && !targetAudiences.includes('Librarian');

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
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Announcements ({visibleAnnouncements.length})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {canManage
                ? 'Post notices and choose exactly which groups see them.'
                : `School notices visible to ${rolePermissions.roleLabel}.`}
            </p>
          </div>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>New Announcement</span>
          </button>
        )}
      </div>

      {visibleAnnouncements.length === 0 ? (
        <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/70 dark:border-slate-800 px-4 py-5 text-xs text-slate-500 dark:text-slate-400 text-center">
          {canManage
            ? 'No announcements posted yet. Use New Announcement to notify teachers, students, bursar, or librarian.'
            : 'No school announcements for your role at this time.'}
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800/80 rounded-xl border border-slate-200/80 dark:border-slate-800 overflow-hidden">
          {visibleAnnouncements.map((item) => (
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
                <div className="pt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>Posted by {item.authorName || 'School Admin'}</span>
                  {canManage && (
                    <span className="font-medium text-emerald-700 dark:text-emerald-400">
                      · Visible to: {formatAudienceSummary(item.targetAudiences)}
                    </span>
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
          ))}
        </div>
      )}

      {modalOpen && canManage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="announcement-modal-title"
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

              <div>
                <div className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Who Should See This Announcement?
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ANNOUNCEMENT_AUDIENCE_OPTIONS.map((opt) => {
                    const checked = targetAudiences.includes(opt.value);
                    return (
                      <label
                        key={opt.value}
                        className={`flex items-start gap-2.5 p-3 rounded-xl border text-left cursor-pointer transition-colors ${
                          checked
                            ? 'bg-emerald-50/70 dark:bg-emerald-950/35 border-emerald-500/70 dark:border-emerald-700'
                            : 'bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAudience(opt.value)}
                          className="mt-0.5 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {opt.label}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5">
                            {opt.description}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {includesStudentsOnlyWithoutLibrarian && (
                  <div className="mt-2 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/35 border border-emerald-200/80 dark:border-emerald-900/60 px-3 py-2 text-[11px] text-emerald-900 dark:text-emerald-200">
                    Students announcements are automatically visible to Teachers, Leadership, Bursar, and Students — excluding the School Librarian unless Librarian is also checked.
                  </div>
                )}
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
        </div>
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
