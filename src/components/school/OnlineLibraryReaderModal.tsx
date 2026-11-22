import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  BookOpen,
  Check,
  CheckCircle2,
  CloudOff,
  FileText,
  Search,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { DigitalLibraryResource, LibraryReadingMode } from '../../school/types';
import {
  getOfflineDigitalResources,
  type OfflineDigitalResourceRecord,
} from '../../school/offlineLibraryDb';
import {
  closeLibraryReadingSession,
  fetchDigitalResourceBytes,
  upsertLibraryReadingSession,
} from '../../school/firestoreService';
import { formatFileSizeLabel } from '../../school/digitalMaterialParser';
import {
  buildReadingSessionId,
  getBrowserReaderKey,
  queueOfflineReadingSync,
  recordResourceReadingPage,
  setLocalActiveReadingSession,
} from '../../school/readingProgressStore';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type ReadableDigitalResource = DigitalLibraryResource | OfflineDigitalResourceRecord;

interface OnlineLibraryReaderModalProps {
  resource: ReadableDigitalResource | null;
  isSavedOffline: boolean;
  savingOffline?: boolean;
  onToggleOffline?: (resource: ReadableDigitalResource) => void;
  scopeKey?: string;
  ownerId?: string;
  registrationCode?: string;
  isRead?: boolean;
  lastReadPage?: number;
  onlineReadersCount?: number;
  offlineReadersCount?: number;
  onToggleRead?: (resource: ReadableDigitalResource) => void;
  onProgressChange?: (
    resourceId: string,
    page: number,
    totalPages: number,
    mode: LibraryReadingMode
  ) => void;
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

interface PdfPageCanvasProps {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  onPageInView?: (pageNumber: number) => void;
}

const PdfPageCanvas: React.FC<PdfPageCanvasProps> = ({
  pdfDoc,
  pageNumber,
  zoom,
  onPageInView,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isVisible, setIsVisible] = useState(pageNumber <= 2);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) {
      setIsVisible(true);
      return;
    }
    const loadObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true);
        }
      },
      { rootMargin: '400px 0px' }
    );
    loadObserver.observe(el);

    const activeObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.35)) {
          onPageInView?.(pageNumber);
        }
      },
      { threshold: [0.35, 0.6] }
    );
    activeObserver.observe(el);

    return () => {
      loadObserver.disconnect();
      activeObserver.disconnect();
    };
  }, [onPageInView, pageNumber]);

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

    async function drawPage() {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;

        const baseViewport = page.getViewport({ scale: zoom });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const scaledViewport = page.getViewport({ scale: zoom * dpr });

        canvas.width = Math.floor(scaledViewport.width);
        canvas.height = Math.floor(scaledViewport.height);
        canvas.style.width = `${Math.floor(baseViewport.width)}px`;
        canvas.style.height = `${Math.floor(baseViewport.height)}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const task = page.render({
          canvas,
          canvasContext: ctx,
          viewport: scaledViewport,
        });
        renderTask = task;
        await task.promise;
        if (!cancelled) setRendered(true);
      } catch {
        // Ignore cancelled render task
      }
    }

    setRendered(false);
    drawPage();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // Ignore cancel errors
      }
    };
  }, [isVisible, pageNumber, pdfDoc, zoom]);

  return (
    <div
      id={`pdf-page-${pageNumber}`}
      ref={containerRef}
      className="flex flex-col items-center gap-2"
    >
      <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
        Page {pageNumber} of {pdfDoc.numPages}
      </div>
      <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white shadow-sm min-h-[240px] flex items-center justify-center max-w-full overflow-x-auto">
        <canvas
          ref={canvasRef}
          onContextMenu={(e) => e.preventDefault()}
          className="block max-w-full h-auto pointer-events-none"
        />
        {!rendered && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-xs text-slate-500">
            Rendering page {pageNumber}...
          </div>
        )}
      </div>
    </div>
  );
};

export const OnlineLibraryReaderModal: React.FC<OnlineLibraryReaderModalProps> = ({
  resource,
  isSavedOffline,
  savingOffline = false,
  onToggleOffline,
  scopeKey = 'reader',
  ownerId,
  registrationCode = '',
  isRead = false,
  lastReadPage = 0,
  onlineReadersCount = 0,
  offlineReadersCount = 0,
  onToggleRead,
  onProgressChange,
  onClose,
}) => {
  const isOnline = useOnlineStatus();
  const [textSize, setTextSize] = useState<ReaderTextSize>('standard');
  const [zoom, setZoom] = useState(1.15);
  const [inBookSearch, setInBookSearch] = useState('');
  const [activeSectionId, setActiveSectionId] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState<number>(Math.max(1, lastReadPage || 1));

  // Binary file state for PDF / Image materials
  const [loadingBinary, setLoadingBinary] = useState(false);
  const [binaryError, setBinaryError] = useState('');
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfPageTexts, setPdfPageTexts] = useState<Record<number, string>>({});
  const [imageObjectUrl, setImageObjectUrl] = useState<string | null>(null);

  const resumedPdfRef = useRef<string | null>(null);
  const currentPageRef = useRef<number>(Math.max(1, lastReadPage || 1));
  const isReadRef = useRef<boolean>(isRead);
  isReadRef.current = isRead;

  const readerMode: LibraryReadingMode = isOnline ? 'online' : 'offline';
  const resolvedOwnerId =
    ownerId || (resource && 'ownerId' in resource ? resource.ownerId : '');
  const readerKey = useMemo(() => getBrowserReaderKey(scopeKey), [scopeKey]);

  const storageFormat = resource?.storageFormat || 'text';
  const hasBinaryChunks =
    storageFormat === 'pdf' ||
    storageFormat === 'image' ||
    Boolean(resource?.chunkCount && resource.chunkCount > 0);

  useEffect(() => {
    setInBookSearch('');
    setActiveSectionId('all');
    setZoom(1.15);
    const startPage = Math.max(1, lastReadPage || 1);
    setCurrentPage(startPage);
    currentPageRef.current = startPage;
    resumedPdfRef.current = null;
  }, [resource?.id]);

  // Keyboard shortcuts & protected reading guard
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

  // Persist initial page/timestamp upon opening non-PDF or immediately when ready
  useEffect(() => {
    if (!resource) return;
    const pageToSave = Math.max(1, currentPageRef.current);
    const totalToSave = pdfDoc?.numPages || 1;
    recordResourceReadingPage(
      scopeKey,
      resource.schoolId,
      resource.id,
      pageToSave,
      totalToSave,
      readerMode
    );
    onProgressChange?.(resource.id, pageToSave, totalToSave, readerMode);
  }, [onProgressChange, pdfDoc, readerMode, resource?.id, resource?.schoolId, scopeKey]);

  // Live online/offline active reading session lifecycle & heartbeat
  useEffect(() => {
    if (!resource) return;
    const schoolId = resource.schoolId;
    const resourceId = resource.id;

    const pushHeartbeat = () => {
      const nowMs = Date.now();
      setLocalActiveReadingSession({
        schoolId,
        resourceId,
        readerKey,
        mode: readerMode,
        active: true,
      });

      if (readerMode === 'offline' && resolvedOwnerId) {
        queueOfflineReadingSync({
          sessionId: buildReadingSessionId(resourceId, readerKey),
          schoolId,
          ownerId: resolvedOwnerId,
          resourceId,
          readerKey,
          registrationCode,
          isRead: isReadRef.current,
          lastReadPage: currentPageRef.current,
          lastReadAtMs: nowMs,
        });
      }

      if (readerMode === 'online' && resolvedOwnerId) {
        void upsertLibraryReadingSession({
          schoolId,
          ownerId: resolvedOwnerId,
          resourceId,
          readerKey,
          registrationCode,
          mode: 'online',
          isReading: true,
          isRead: isReadRef.current,
          lastReadPage: currentPageRef.current,
          lastReadAtMs: nowMs,
        });
      }
    };

    const endSession = () => {
      setLocalActiveReadingSession({
        schoolId,
        resourceId,
        readerKey,
        mode: readerMode,
        active: false,
      });
      if (resolvedOwnerId && typeof navigator !== 'undefined' && navigator.onLine) {
        void closeLibraryReadingSession({
          schoolId,
          ownerId: resolvedOwnerId,
          resourceId,
          readerKey,
          registrationCode,
          mode: readerMode,
          isRead: isReadRef.current,
          lastReadPage: currentPageRef.current,
          lastReadAtMs: Date.now(),
        });
      }
    };

    pushHeartbeat();
    const interval = window.setInterval(pushHeartbeat, 20_000);
    window.addEventListener('pagehide', endSession);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('pagehide', endSession);
      endSession();
    };
  }, [readerKey, readerMode, registrationCode, resolvedOwnerId, resource?.id, resource?.schoolId]);

  // Load PDF or Image bytes from IndexedDB cache or Firestore chunks
  useEffect(() => {
    let cancelled = false;
    let activePdf: PDFDocumentProxy | null = null;
    let activeBlobUrl: string | null = null;

    setPdfDoc(null);
    setPdfPageTexts({});
    setImageObjectUrl(null);
    setBinaryError('');

    if (!resource || !hasBinaryChunks) {
      setLoadingBinary(false);
      return;
    }

    async function loadBinaryMaterial() {
      if (!resource) return;
      setLoadingBinary(true);
      try {
        let bytes: Uint8Array | null = null;
        if ('fileBytes' in resource && resource.fileBytes instanceof Uint8Array) {
          bytes = resource.fileBytes;
        }

        if (!bytes) {
          const cachedList = await getOfflineDigitalResources(resource.schoolId);
          const match = cachedList.find((r) => r.id === resource.id);
          if (match?.fileBytes instanceof Uint8Array) {
            bytes = match.fileBytes;
          }
        }

        if (!bytes && resource.chunkCount && resource.chunkCount > 0) {
          bytes = await fetchDigitalResourceBytes(resource.schoolId, resource.id);
        }

        if (cancelled) return;

        if (!bytes || bytes.length === 0) {
          setBinaryError(
            isOnline
              ? 'Uploaded file data could not be found. Ask your school librarian to re-upload this material.'
              : 'This uploaded file has not been saved for offline reading on this device yet. Connect to the internet once and click Save Offline.'
          );
          setLoadingBinary(false);
          return;
        }

        if (storageFormat === 'pdf') {
          const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
          const loadedPdf = await loadingTask.promise;
          if (cancelled) {
            await loadingTask.destroy();
            return;
          }
          activePdf = loadedPdf;
          setPdfDoc(loadedPdf);
          setLoadingBinary(false);

          // Extract page text in background for in-book search
          const extracted: Record<number, string> = {};
          const maxIndexPages = Math.min(loadedPdf.numPages, 60);
          for (let p = 1; p <= maxIndexPages; p += 1) {
            if (cancelled) break;
            try {
              const page = await loadedPdf.getPage(p);
              const tc = await page.getTextContent();
              extracted[p] = tc.items
                .map((it) => ('str' in it ? String(it.str) : ''))
                .join(' ')
                .toLowerCase();
            } catch {
              // Ignore single-page extraction issues
            }
          }
          if (!cancelled) {
            setPdfPageTexts(extracted);
          }
        } else if (storageFormat === 'image') {
          const blob = new Blob([bytes.slice()], {
            type: resource.mimeType || 'image/png',
          });
          activeBlobUrl = URL.createObjectURL(blob);
          setImageObjectUrl(activeBlobUrl);
          setLoadingBinary(false);
        }
      } catch (err) {
        if (!cancelled) {
          setBinaryError(
            err instanceof Error
              ? err.message
              : 'Unable to open this reading material right now.'
          );
          setLoadingBinary(false);
        }
      }
    }

    loadBinaryMaterial();

    return () => {
      cancelled = true;
      if (activePdf) {
        activePdf.loadingTask.destroy().catch(() => undefined);
      }
      if (activeBlobUrl) {
        URL.revokeObjectURL(activeBlobUrl);
      }
    };
  }, [hasBinaryChunks, isOnline, resource, storageFormat]);

  // Resume saved lastReadPage when a multi-page PDF loads
  useEffect(() => {
    if (!resource || !pdfDoc) return;
    if (resumedPdfRef.current === resource.id) return;
    resumedPdfRef.current = resource.id;
    const saved = Math.min(pdfDoc.numPages, Math.max(1, lastReadPage || 1));
    if (saved > 1) {
      window.setTimeout(() => {
        const el = document.getElementById(`pdf-page-${saved}`);
        el?.scrollIntoView({ behavior: 'auto', block: 'start' });
      }, 120);
    }
  }, [lastReadPage, pdfDoc, resource]);

  const handlePageInView = useCallback(
    (pageNumber: number) => {
      if (!resource || !pdfDoc) return;
      if (currentPageRef.current === pageNumber) return;
      currentPageRef.current = pageNumber;
      setCurrentPage(pageNumber);
      recordResourceReadingPage(
        scopeKey,
        resource.schoolId,
        resource.id,
        pageNumber,
        pdfDoc.numPages,
        readerMode
      );
      onProgressChange?.(resource.id, pageNumber, pdfDoc.numPages, readerMode);

      if (readerMode === 'offline' && resolvedOwnerId) {
        queueOfflineReadingSync({
          sessionId: buildReadingSessionId(resource.id, readerKey),
          schoolId: resource.schoolId,
          ownerId: resolvedOwnerId,
          resourceId: resource.id,
          readerKey,
          registrationCode,
          isRead: isReadRef.current,
          lastReadPage: pageNumber,
          lastReadAtMs: Date.now(),
        });
      }
    },
    [
      onProgressChange,
      pdfDoc,
      readerKey,
      readerMode,
      registrationCode,
      resolvedOwnerId,
      resource,
      scopeKey,
    ]
  );

  const sections = useMemo(() => {
    if (!resource || hasBinaryChunks) return [];
    return parseStructuredSections(resource.content, resource.title);
  }, [hasBinaryChunks, resource]);

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

  const matchingPdfPages = useMemo(() => {
    const q = inBookSearch.trim().toLowerCase();
    if (!q || !pdfDoc) return [];
    const matches: number[] = [];
    for (let p = 1; p <= pdfDoc.numPages; p += 1) {
      if (pdfPageTexts[p]?.includes(q)) {
        matches.push(p);
      }
    }
    return matches;
  }, [inBookSearch, pdfDoc, pdfPageTexts]);

  if (!resource) return null;

  const textScaleClass =
    textSize === 'compact'
      ? 'text-xs leading-6'
      : textSize === 'large'
      ? 'text-base leading-8'
      : 'text-sm leading-7';

  const scrollToPdfPage = (pageNum: number) => {
    const target = document.getElementById(`pdf-page-${pageNum}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div
      className="no-print-reader fixed inset-0 z-[60] w-screen h-[100dvh] flex flex-col bg-white dark:bg-[#161B22] select-none overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="digital-reader-title"
      onContextMenu={(e) => e.preventDefault()}
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      {/* Top Edge-to-Edge Reader Toolbar */}
      <header className="px-3 sm:px-6 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/95 dark:bg-slate-900/90 flex items-center justify-between gap-2.5 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="h-9 w-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
            {storageFormat === 'pdf' ? (
              <FileText className="w-4 h-4" aria-hidden="true" />
            ) : (
              <BookOpen className="w-4 h-4" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <h2
              id="digital-reader-title"
              className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate"
            >
              {resource.title}
            </h2>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate font-mono tabular-nums">
              {resource.category} · {resource.subject} · {resource.formLevel}
              {resource.examYear ? ` · ${resource.examYear}` : ''}
              {resource.fileSizeBytes ? ` · ${formatFileSizeLabel(resource.fileSizeBytes)}` : ''}
              {!isOnline ? ' · Offline' : ''}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {onToggleRead && (
            <button
              type="button"
              onClick={() => onToggleRead(resource)}
              aria-pressed={isRead}
              className={`inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer border transition-colors ${
                isRead
                  ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-[#161B22] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isRead ? 'Marked Read' : 'Mark as Read'}</span>
            </button>
          )}

          {onToggleOffline && resource.allowOffline && (
            <button
              type="button"
              onClick={() => onToggleOffline(resource)}
              disabled={savingOffline}
              className={`inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 ${
                isSavedOffline
                  ? 'border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/80'
                  : 'bg-emerald-700 hover:bg-emerald-800 text-white'
              }`}
            >
              {isSavedOffline ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Saved Offline</span>
                  <Trash2 className="w-3 h-3 opacity-70" aria-hidden="true" />
                </>
              ) : (
                <>
                  <CloudOff className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">{savingOffline ? 'Saving...' : 'Save Offline'}</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Exit digital reader"
            className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
            <span>Exit</span>
          </button>
        </div>
      </header>

      {/* Sub-Toolbar: Search, Live Reader Telemetry & Reading Comfort */}
      <div className="px-3 sm:px-6 py-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#161B22] flex flex-wrap items-center justify-between gap-2.5 shrink-0">
        {storageFormat !== 'image' ? (
          <div className="relative flex-1 min-w-[180px] max-w-md">
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
        ) : (
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {resource.fileName || resource.title}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
            {pdfDoc ? `Page ${currentPage}/${pdfDoc.numPages} · ` : ''}
            {onlineReadersCount} online · {offlineReadersCount} offline reading
          </span>

          {pdfDoc && pdfDoc.numPages > 1 && (
            <select
              aria-label="Jump to PDF page"
              value={String(currentPage)}
              onChange={(e) => {
                const p = Number(e.target.value);
                if (p >= 1) scrollToPdfPage(p);
              }}
              className="min-h-[36px] px-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200"
            >
              {Array.from({ length: pdfDoc.numPages }, (_, i) => i + 1).map((p) => (
                <option key={p} value={p}>
                  Page {p} of {pdfDoc.numPages}
                </option>
              ))}
            </select>
          )}

          {!hasBinaryChunks && sections.length > 1 && (
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

          {hasBinaryChunks ? (
            <div className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-900 p-0.5 gap-0.5">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.7, Number((z - 0.15).toFixed(2))))}
                aria-label="Zoom out"
                className="min-h-[30px] px-2 rounded-md text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-[#1E2530] cursor-pointer"
              >
                <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <span className="px-2 font-mono tabular-nums text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(2.0, Number((z + 0.15).toFixed(2))))}
                aria-label="Zoom in"
                className="min-h-[30px] px-2 rounded-md text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-[#1E2530] cursor-pointer"
              >
                <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
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
          )}
        </div>
      </div>

      {/* Full-Screen Main Reader Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {!hasBinaryChunks && sections.length > 1 && (
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
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 bg-[#FCFCFA] dark:bg-[#0D1117]">
          <article className="w-full space-y-5">
            {resource.summary && (
              <div className="rounded-xl bg-slate-100/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 px-4 py-3 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                {resource.summary}
              </div>
            )}

            {hasBinaryChunks ? (
              loadingBinary ? (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#161B22] py-16 px-4 text-center">
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    Loading {storageFormat === 'pdf' ? 'PDF document' : 'study image'}...
                  </div>
                </div>
              ) : binaryError ? (
                <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-6 text-center text-xs text-amber-800 dark:text-amber-200">
                  {binaryError}
                </div>
              ) : pdfDoc ? (
                <div className="space-y-6">
                  {inBookSearch.trim().length > 0 && (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#161B22] px-4 py-2.5 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-slate-600 dark:text-slate-300 font-medium">
                        {matchingPdfPages.length > 0
                          ? `Matches on ${matchingPdfPages.length} ${matchingPdfPages.length === 1 ? 'page' : 'pages'}:`
                          : `No text matches for "${inBookSearch.trim()}" (scanned pages cannot be text-searched).`}
                      </span>
                      {matchingPdfPages.slice(0, 12).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => scrollToPdfPage(p)}
                          className="px-2 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-mono font-semibold hover:underline cursor-pointer"
                        >
                          p.{p}
                        </button>
                      ))}
                    </div>
                  )}
                  {Array.from({ length: pdfDoc.numPages }, (_, idx) => idx + 1).map((pageNo) => (
                    <PdfPageCanvas
                      key={pageNo}
                      pdfDoc={pdfDoc}
                      pageNumber={pageNo}
                      zoom={zoom}
                      onPageInView={handlePageInView}
                    />
                  ))}
                </div>
              ) : imageObjectUrl ? (
                <div className="flex justify-center overflow-x-auto">
                  <div
                    onContextMenu={(e) => e.preventDefault()}
                    className="relative rounded-xl border border-slate-200 dark:border-slate-800 bg-white overflow-hidden shadow-sm inline-block"
                  >
                    <img
                      src={imageObjectUrl}
                      alt={resource.title}
                      draggable={false}
                      style={{
                        width: `${Math.round(680 * zoom)}px`,
                        maxWidth: '100%',
                        height: 'auto',
                      }}
                      className="block pointer-events-none select-none"
                    />
                  </div>
                </div>
              ) : null
            ) : filteredSections.length === 0 ? (
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
          </article>
        </div>
      </div>
    </div>
  );
};
