import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  CloudOff,
  Lock,
  Search,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type { DigitalLibraryResource } from '../../school/types';
import type { OfflineDigitalResourceRecord } from '../../school/offlineLibraryDb';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export type ReadableDigitalResource = DigitalLibraryResource | OfflineDigitalResourceRecord;

interface OnlineLibraryReaderModalProps {
  resource: ReadableDigitalResource | null;
  isSavedOffline: boolean;
  savingOffline?: boolean;
  onToggleOffline?: (resource: ReadableDigitalResource) => void;
  onClose: () => void;
}

interface ParsedSection {
  id: string;
  heading: string;
  lines: string[];
}

type ReaderTextSize = 'compact' | 'standard' | 'large';

function parseStructuredSections(content: string, fallbackTitle: string): ParsedSection[] {
  const rawLines = String(content ?? '').split(/\r?\n/);
  const sections: ParsedSection[] = [];
  let current: ParsedSection = {
    id: 'sec-0',
    heading: fallbackTitle,
    lines: [],
  };

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('## ')) {
      if (current.lines.some((l) => l.trim().length > 0) || sections.length > 0) {
        sections.push(current);
      }
      const nextHeading = trimmed.slice(3).trim() || `Section ${sections.length + 1}`;
      current = {
        id: `sec-${sections.length + 1}`,
        heading: nextHeading,
        lines: [],
      };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.some((l) => l.trim().length > 0) || sections.length === 0) {
    sections.push(current);
  }
  return sections;
}

export const OnlineLibraryReaderModal: React.FC<OnlineLibraryReaderModalProps> = ({
  resource,
  isSavedOffline,
  savingOffline = false,
  onToggleOffline,
  onClose,
}) => {
  const isOnline = useOnlineStatus();
  const [textSize, setTextSize] = useState<ReaderTextSize>('standard');
  const [inBookSearch, setInBookSearch] = useState('');
  const [activeSectionId, setActiveSectionId] = useState<string>('all');

  useEffect(() => {
    setInBookSearch('');
    setActiveSectionId('all');
  }, [resource?.id]);

  useEffect(() => {
    if (!resource) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'u'].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, resource]);

  const sections = useMemo(() => {
    if (!resource) return [];
    return parseStructuredSections(resource.content, resource.title);
  }, [resource]);

  const filteredSections = useMemo(() => {
    const q = inBookSearch.trim().toLowerCase();
    return sections.filter((sec) => {
      if (activeSectionId !== 'all' && sec.id !== activeSectionId) return false;
      if (!q) return true;
      return (
        sec.heading.toLowerCase().includes(q) ||
        sec.lines.some((line) => line.toLowerCase().includes(q))
      );
    });
  }, [activeSectionId, inBookSearch, sections]);

  if (!resource) return null;

  const textScaleClass =
    textSize === 'compact'
      ? 'text-xs leading-6'
      : textSize === 'large'
      ? 'text-base leading-8'
      : 'text-sm leading-7';

  return (
    <div
      className="no-print-reader fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-2 sm:p-4 select-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="digital-reader-title"
      onContextMenu={(e) => e.preventDefault()}
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      <div className="w-full max-w-5xl h-[92vh] flex flex-col rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        {/* Top Reader Toolbar */}
        <header className="px-4 sm:px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/80 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
              <BookOpen className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="digital-reader-title"
                className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate"
              >
                {resource.title}
              </h2>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate font-mono">
                {resource.category} · {resource.subject} · {resource.formLevel}
                {resource.examYear ? ` · ${resource.examYear}` : ''} · by {resource.author}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border ${
                isOnline
                  ? 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-white dark:bg-[#161B22]'
                  : 'border-amber-200 dark:border-amber-800/70 text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40'
              }`}
            >
              {isOnline ? (
                <Wifi className="w-3 h-3 text-emerald-600" aria-hidden="true" />
              ) : (
                <WifiOff className="w-3 h-3" aria-hidden="true" />
              )}
              <span>{isOnline ? 'Online Reader' : 'Offline Cache'}</span>
            </span>

            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#161B22] text-slate-600 dark:text-slate-300">
              <Lock className="w-3 h-3 text-slate-500" aria-hidden="true" />
              <span>Read-Only · No Downloads</span>
            </span>

            {onToggleOffline && resource.allowOffline && (
              <button
                type="button"
                onClick={() => onToggleOffline(resource)}
                disabled={savingOffline}
                className={`inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 ${
                  isSavedOffline
                    ? 'border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/80'
                    : 'bg-emerald-700 hover:bg-emerald-800 text-white'
                }`}
              >
                {isSavedOffline ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Saved Offline</span>
                    <Trash2 className="w-3 h-3 ml-0.5 opacity-70" aria-hidden="true" />
                  </>
                ) : (
                  <>
                    <CloudOff className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{savingOffline ? 'Saving...' : 'Save for Offline'}</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close digital reader"
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Sub-Toolbar: Search & Reading Comfort */}
        <div className="px-4 sm:px-6 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#161B22] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search
              className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search inside reading material"
              value={inBookSearch}
              onChange={(e) => setInBookSearch(e.target.value)}
              placeholder="Find topic, formula, or question..."
              className="w-full min-h-[36px] pl-8 pr-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
            />
          </div>

          <div className="flex items-center gap-2 text-xs">
            {sections.length > 1 && (
              <select
                aria-label="Jump to section"
                value={activeSectionId}
                onChange={(e) => setActiveSectionId(e.target.value)}
                className="lg:hidden min-h-[36px] px-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 max-w-[180px]"
              >
                <option value="all">All Sections ({sections.length})</option>
                {sections.map((sec) => (
                  <option key={sec.id} value={sec.id}>
                    {sec.heading}
                  </option>
                ))}
              </select>
            )}

            <div className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-900 p-0.5">
              {(
                [
                  { id: 'compact', label: 'A-' },
                  { id: 'standard', label: 'A' },
                  { id: 'large', label: 'A+' },
                ] as { id: ReaderTextSize; label: string }[]
              ).map((sizeOpt) => (
                <button
                  key={sizeOpt.id}
                  type="button"
                  onClick={() => setTextSize(sizeOpt.id)}
                  className={`min-h-[30px] px-2.5 rounded-md text-xs font-semibold cursor-pointer ${
                    textSize === sizeOpt.id
                      ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {sizeOpt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Main Split Reader Body */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {sections.length > 1 && (
            <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-3 overflow-y-auto space-y-1">
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Contents
              </div>
              <button
                type="button"
                onClick={() => setActiveSectionId('all')}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium cursor-pointer ${
                  activeSectionId === 'all'
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 font-semibold'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                }`}
              >
                All Sections ({sections.length})
              </button>
              {sections.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setActiveSectionId(sec.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium truncate cursor-pointer ${
                    activeSectionId === sec.id
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 font-semibold'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  }`}
                >
                  {sec.heading}
                </button>
              ))}
            </aside>
          )}

          {/* Reading Canvas */}
          <div className="flex-1 overflow-y-auto p-5 sm:p-8 bg-[#FCFCFA] dark:bg-[#0D1117]">
            <article className="max-w-3xl mx-auto space-y-6">
              {resource.summary && (
                <div className="rounded-xl bg-slate-100/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 px-4 py-3 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  {resource.summary}
                </div>
              )}

              {filteredSections.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 py-10 px-4 text-center text-xs text-slate-500 dark:text-slate-400">
                  No sections match &ldquo;{inBookSearch.trim()}&rdquo; in this material.
                </div>
              ) : (
                filteredSections.map((sec) => (
                  <section
                    key={sec.id}
                    className="rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-3"
                  >
                    <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-2.5">
                      {sec.heading}
                    </h3>
                    <div className={`space-y-2.5 text-slate-800 dark:text-slate-200 ${textScaleClass}`}>
                      {sec.lines.map((rawLine, idx) => {
                        const line = rawLine.trim();
                        if (!line) return <div key={idx} className="h-1" />;
                        if (line.startsWith('- ')) {
                          return (
                            <div key={idx} className="flex items-start gap-2.5 pl-1">
                              <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-600 shrink-0" />
                              <span>{line.slice(2)}</span>
                            </div>
                          );
                        }
                        if (/^(Answer Guide:|Worked Solution:|Question [A-Z0-9]+:|Examiner Tip)/i.test(line)) {
                          return (
                            <p
                              key={idx}
                              className="font-medium text-emerald-900 dark:text-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-900/50 rounded-xl px-3.5 py-2.5"
                            >
                              {line}
                            </p>
                          );
                        }
                        return <p key={idx}>{line}</p>;
                      })}
                    </div>
                  </section>
                ))
              )}

              <footer className="pt-2 pb-6 text-center text-[11px] text-slate-500 dark:text-slate-400">
                Protected school study material · Read online or save in-app for offline revision · Exporting or downloading files is disabled.
              </footer>
            </article>
          </div>
        </div>
      </div>
    </div>
  );
};
