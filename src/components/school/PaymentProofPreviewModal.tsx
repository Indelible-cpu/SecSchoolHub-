import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { FileText, Image as ImageIcon, X, ZoomIn, ZoomOut } from 'lucide-react';
import { fetchFeeSubmissionBytes } from '../../school/firestoreService';
import { formatFileSizeLabel } from '../../school/digitalMaterialParser';
import { formatMWK } from '../../school/malawi';
import type { StudentFeeSubmission } from '../../school/types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PaymentProofPreviewModalProps {
  submission: StudentFeeSubmission | null;
  onClose: () => void;
}

const ProofPdfPageCanvas: React.FC<{
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
}> = ({ pdfDoc, pageNumber, zoom }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

    async function renderPage() {
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
        // Ignore cancelled renders
      }
    }

    setRendered(false);
    renderPage();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // Ignore cancel errors
      }
    };
  }, [pageNumber, pdfDoc, zoom]);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
        Page {pageNumber} of {pdfDoc.numPages}
      </div>
      <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white shadow-sm min-h-[200px] flex items-center justify-center max-w-full overflow-x-auto">
        <canvas ref={canvasRef} className="block max-w-full h-auto" />
        {!rendered && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-xs text-slate-500">
            Rendering page {pageNumber}...
          </div>
        )}
      </div>
    </div>
  );
};

export const PaymentProofPreviewModal: React.FC<PaymentProofPreviewModalProps> = ({
  submission,
  onClose,
}) => {
  const [zoom, setZoom] = useState(1.1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    setZoom(1.1);
  }, [submission?.id]);

  useEffect(() => {
    if (!submission) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, submission]);

  useEffect(() => {
    let cancelled = false;
    let activePdf: PDFDocumentProxy | null = null;
    let activeBlobUrl: string | null = null;

    setPdfDoc(null);
    setImageUrl(null);
    setError('');

    if (!submission) {
      setLoading(false);
      return;
    }

    async function loadBytes() {
      if (!submission) return;
      setLoading(true);
      try {
        const bytes = await fetchFeeSubmissionBytes(submission.registrationCode, submission.id);
        if (cancelled) return;
        if (!bytes || bytes.length === 0) {
          setError('Payment proof file chunks could not be loaded.');
          setLoading(false);
          return;
        }

        if (submission.fileFormat === 'pdf') {
          const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
          const loadedPdf = await loadingTask.promise;
          if (cancelled) {
            await loadingTask.destroy();
            return;
          }
          activePdf = loadedPdf;
          setPdfDoc(loadedPdf);
        } else {
          const blob = new Blob([bytes.slice()], {
            type: submission.mimeType || 'image/jpeg',
          });
          activeBlobUrl = URL.createObjectURL(blob);
          setImageUrl(activeBlobUrl);
        }
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load payment proof.');
          setLoading(false);
        }
      }
    }

    loadBytes();

    return () => {
      cancelled = true;
      if (activePdf) {
        activePdf.loadingTask.destroy().catch(() => undefined);
      }
      if (activeBlobUrl) {
        URL.revokeObjectURL(activeBlobUrl);
      }
    };
  }, [submission]);

  if (!submission) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="proof-preview-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-4xl h-[90vh] flex flex-col rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <header className="px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/80 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
              {submission.fileFormat === 'pdf' ? (
                <FileText className="w-4 h-4" aria-hidden="true" />
              ) : (
                <ImageIcon className="w-4 h-4" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0">
              <h2
                id="proof-preview-title"
                className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate"
              >
                {submission.studentName} · {formatMWK(submission.amount)}
              </h2>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                {submission.method}
                {submission.reference ? ` · Ref ${submission.reference}` : ''} · {submission.fileName} (
                {formatFileSizeLabel(submission.fileSizeBytes)})
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 gap-0.5">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.15).toFixed(2))))}
                aria-label="Zoom out"
                className="min-h-[32px] px-2 rounded-md text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-[#1E2530] cursor-pointer"
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
                className="min-h-[32px] px-2 rounded-md text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-[#1E2530] cursor-pointer"
              >
                <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
              <span>Exit</span>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#FCFCFA] dark:bg-[#0D1117]">
          {loading ? (
            <div className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
              Loading payment proof...
            </div>
          ) : error ? (
            <div className="max-w-md mx-auto rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-5 text-center text-xs text-amber-800 dark:text-amber-200">
              {error}
            </div>
          ) : pdfDoc ? (
            <div className="space-y-5 max-w-3xl mx-auto">
              {Array.from({ length: pdfDoc.numPages }, (_, idx) => idx + 1).map((pageNo) => (
                <ProofPdfPageCanvas
                  key={pageNo}
                  pdfDoc={pdfDoc}
                  pageNumber={pageNo}
                  zoom={zoom}
                />
              ))}
            </div>
          ) : imageUrl ? (
            <div className="flex justify-center overflow-x-auto">
              <img
                src={imageUrl}
                alt={`Payment proof for ${submission.studentName}`}
                style={{ width: `${Math.round(640 * zoom)}px`, maxWidth: '100%', height: 'auto' }}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white shadow-sm block"
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
