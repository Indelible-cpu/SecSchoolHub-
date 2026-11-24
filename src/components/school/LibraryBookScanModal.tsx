import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  BookPlus,
  Camera,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  ScanBarcode,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { auth } from '../../firebase';
import { saveLibraryBook } from '../../school/firestoreService';
import { LIBRARY_MATERIAL_CATEGORIES } from '../../school/malawi';
import type { LibraryBook, LibraryMaterialCategory, School } from '../../school/types';
import { ModalBackdrop } from './ModalBackdrop';

interface BarcodeDetectorInstance {
  detect: (
    source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement | ImageBitmap
  ) => Promise<Array<{ rawValue?: string }>>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance;
}

interface DetectedBookPayload {
  isbn: string;
  title: string;
  author: string;
  subject: string;
  materialType: LibraryMaterialCategory;
  notes: string;
  source: 'openlibrary' | 'googlebooks' | 'gemini_vision';
}

interface LibraryBookScanModalProps {
  open: boolean;
  school: School;
  ownerId: string;
  libraryBooks: LibraryBook[];
  allSubjectChoices: string[];
  initialIsbn?: string;
  onClose: () => void;
}

function normalizeToken(raw?: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/[^0-9Xx]/g, '')
    .toUpperCase();
}

function suggestShelfPrefix(subject: string): string {
  const tok =
    subject
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .slice(0, 3) || 'GEN';
  return `LIB-${tok}`;
}

function extractIsbnCandidate(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { isbn?: string };
      if (parsed && typeof parsed.isbn === 'string') {
        return normalizeToken(parsed.isbn);
      }
    } catch {
      // Ignore JSON parse errors
    }
  }
  const clean = normalizeToken(trimmed);
  const match13 = clean.match(/(97[89]\d{10})/);
  if (match13) return match13[1];
  if (/^\d{9}[\dX]$/.test(clean) || /^\d{13}$/.test(clean)) return clean;
  return clean;
}

async function resizeDataUrlToJpegBase64(
  source: HTMLVideoElement | HTMLImageElement,
  maxWidth = 1200
): Promise<{ base64: string; mimeType: 'image/jpeg' }> {
  const srcWidth =
    source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth || source.width;
  const srcHeight =
    source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight || source.height;
  const scale = srcWidth > maxWidth ? maxWidth / srcWidth : 1;
  const w = Math.max(1, Math.round(srcWidth * scale));
  const h = Math.max(1, Math.round(srcHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to prepare image canvas.');
  }
  ctx.drawImage(source, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return {
    base64: dataUrl.replace(/^data:image\/jpeg;base64,/, ''),
    mimeType: 'image/jpeg',
  };
}

export const LibraryBookScanModal: React.FC<LibraryBookScanModalProps> = ({
  open,
  school,
  ownerId,
  libraryBooks,
  allSubjectChoices,
  initialIsbn = '',
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const busyScanRef = useRef(false);

  const [step, setStep] = useState<'scan' | 'review'>('scan');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [scanStatusMsg, setScanStatusMsg] = useState('');
  const [scanErrorMsg, setScanErrorMsg] = useState('');
  const [isbnInput, setIsbnInput] = useState('');

  // Matched existing catalog book (for fast +copies workflow)
  const [existingMatch, setExistingMatch] = useState<LibraryBook | null>(null);
  const [addCopiesDelta, setAddCopiesDelta] = useState(1);
  const [updatingExisting, setUpdatingExisting] = useState(false);

  // Editable catalog form fields for new book
  const [formIsbn, setFormIsbn] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formAuthor, setFormAuthor] = useState('');
  const [formSubject, setFormSubject] = useState(allSubjectChoices[0] || 'English');
  const [formType, setFormType] = useState<LibraryMaterialCategory>('Textbook');
  const [formShelf, setFormShelf] = useState(() =>
    suggestShelfPrefix(allSubjectChoices[0] || 'English')
  );
  const [formCopies, setFormCopies] = useState(1);
  const [formNotes, setFormNotes] = useState('');
  const [savingBook, setSavingBook] = useState(false);
  const [batchSuccessBanner, setBatchSuccessBanner] = useState('');
  const [addedCountSession, setAddedCountSession] = useState(0);

  const barcodeDetectorSupported = useMemo(
    () => typeof window !== 'undefined' && 'BarcodeDetector' in window,
    []
  );

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setCameraStarting(false);
  }, []);

  const findExistingInCatalog = useCallback(
    (isbnCandidate: string, titleCandidate?: string): LibraryBook | null => {
      const cleanIsbn = normalizeToken(isbnCandidate);
      if (cleanIsbn.length >= 9) {
        const byIsbn = libraryBooks.find((b) => normalizeToken(b.isbn) === cleanIsbn);
        if (byIsbn) return byIsbn;
      }
      const cleanTitle = (titleCandidate || '').trim().toLowerCase();
      if (cleanTitle.length >= 4) {
        const byTitle = libraryBooks.find((b) => b.title.trim().toLowerCase() === cleanTitle);
        if (byTitle) return byTitle;
      }
      return null;
    },
    [libraryBooks]
  );

  const applyScannedBookToReview = useCallback(
    (payload: Partial<DetectedBookPayload> & { statusMsg?: string }) => {
      stopCamera();
      const matched = findExistingInCatalog(payload.isbn || '', payload.title);
      if (matched) {
        setExistingMatch(matched);
        setAddCopiesDelta(1);
        setScanStatusMsg(`Found matching catalog title: "${matched.title}".`);
        setStep('review');
        return;
      }

      setExistingMatch(null);
      const nextSubj = payload.subject || allSubjectChoices[0] || 'English';
      setFormIsbn(payload.isbn || '');
      setFormTitle(payload.title || '');
      setFormAuthor(payload.author || '');
      setFormSubject(
        allSubjectChoices.includes(nextSubj) ? nextSubj : allSubjectChoices[0] || 'General'
      );
      setFormType(payload.materialType || 'Textbook');
      setFormShelf(suggestShelfPrefix(nextSubj));
      setFormCopies(1);
      setFormNotes(payload.notes || '');
      if (payload.statusMsg) {
        setScanStatusMsg(payload.statusMsg);
      }
      setStep('review');
    },
    [allSubjectChoices, findExistingInCatalog, stopCamera]
  );

  const lookupIsbnFromServer = useCallback(
    async (rawCode: string) => {
      const isbn = extractIsbnCandidate(rawCode);
      if (isbn.length < 10) {
        setScanErrorMsg('Detected code is not a valid 10-digit or 13-digit ISBN.');
        return;
      }

      // Fast local duplicate check before network call
      const localMatch = findExistingInCatalog(isbn);
      if (localMatch) {
        applyScannedBookToReview({
          isbn,
          title: localMatch.title,
        });
        return;
      }

      setAnalyzing(true);
      setScanErrorMsg('');
      setScanStatusMsg(`Looking up ISBN ${isbn}...`);
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('Sign in required to look up ISBN.');
        const subjectsParam = encodeURIComponent(allSubjectChoices.slice(0, 20).join(','));
        const res = await fetch(
          `/api/library/isbn/${encodeURIComponent(isbn)}?subjects=${subjectsParam}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          found?: boolean;
          isbn?: string;
          book?: DetectedBookPayload;
          error?: string;
        };

        if (!res.ok) {
          throw new Error(data.error || `ISBN lookup failed (HTTP ${res.status}).`);
        }

        if (data.found && data.book) {
          const sourceLabel =
            data.book.source === 'openlibrary' ? 'Open Library' : 'Google Books';
          applyScannedBookToReview({
            ...data.book,
            statusMsg: `Autofilled from ${sourceLabel} using scanned ISBN ${data.book.isbn}.`,
          });
        } else {
          applyScannedBookToReview({
            isbn: data.isbn || isbn,
            statusMsg: `Scanned ISBN ${isbn}. Not found online — fill in Title and Author or capture the front cover.`,
          });
        }
      } catch (err) {
        setScanErrorMsg(
          err instanceof Error ? err.message : 'Unable to look up ISBN automatically.'
        );
      } finally {
        setAnalyzing(false);
        busyScanRef.current = false;
      }
    },
    [allSubjectChoices, applyScannedBookToReview, findExistingInCatalog]
  );

  const scanCoverImageViaServer = useCallback(
    async (base64: string, mimeType: 'image/jpeg') => {
      setAnalyzing(true);
      setScanErrorMsg('');
      setScanStatusMsg('Reading book cover details...');
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('Sign in required to scan book cover.');
        const res = await fetch('/api/library/scan-book', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            imageBase64: base64,
            mimeType,
            allowedSubjects: allSubjectChoices.slice(0, 20),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          book?: DetectedBookPayload;
          error?: string;
        };
        if (!res.ok || !data.book) {
          throw new Error(data.error || 'Could not extract book details from cover photo.');
        }

        applyScannedBookToReview({
          ...data.book,
          statusMsg: 'Book details extracted from cover scan. Review and confirm below.',
        });
      } catch (err) {
        setScanErrorMsg(
          err instanceof Error ? err.message : 'Failed to extract book details from image.'
        );
      } finally {
        setAnalyzing(false);
        busyScanRef.current = false;
      }
    },
    [allSubjectChoices, applyScannedBookToReview]
  );

  const startCamera = useCallback(async () => {
    setCameraError('');
    setScanErrorMsg('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Live camera is unavailable here. Upload a book photo or scan/enter the ISBN below.'
      );
      return;
    }

    stopCamera();
    setCameraStarting(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        stopCamera();
        return;
      }
      video.srcObject = stream;
      await video.play();
      setCameraStarting(false);
      setCameraActive(true);

      const BarcodeCtor = (
        window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }
      ).BarcodeDetector;

      const detector = BarcodeCtor
        ? new BarcodeCtor({
            formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'],
          })
        : null;

      let frameCounter = 0;

      const tick = async () => {
        const vid = videoRef.current;
        const canvas = canvasRef.current;
        if (!vid || !canvas || !streamRef.current) return;

        frameCounter += 1;
        if (
          !busyScanRef.current &&
          frameCounter % 6 === 0 &&
          vid.readyState === vid.HAVE_ENOUGH_DATA &&
          vid.videoWidth > 0 &&
          vid.videoHeight > 0
        ) {
          if (detector) {
            try {
              const found = await detector.detect(vid);
              const firstCode = found.find((f) => f.rawValue && f.rawValue.trim().length >= 8);
              if (firstCode?.rawValue) {
                busyScanRef.current = true;
                await lookupIsbnFromServer(firstCode.rawValue);
                return;
              }
            } catch {
              // Ignore per-frame BarcodeDetector error
            }
          }

          // Fallback QR check via jsQR
          canvas.width = vid.videoWidth;
          canvas.height = vid.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const qr = jsQR(imgData.data, imgData.width, imgData.height, {
              inversionAttempts: 'dontInvert',
            });
            if (qr && qr.data) {
              const candidate = extractIsbnCandidate(qr.data);
              if (candidate.length >= 10) {
                busyScanRef.current = true;
                await lookupIsbnFromServer(candidate);
                return;
              }
            }
          }
        }

        if (streamRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            void tick();
          });
        }
      };

      rafRef.current = requestAnimationFrame(() => {
        void tick();
      });
    } catch (err) {
      stopCamera();
      const msg = err instanceof Error ? err.message : '';
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('notallowed')) {
        setCameraError(
          'Camera access was denied. Allow camera permission or upload a book photo / enter ISBN below.'
        );
      } else {
        setCameraError(
          'No live camera detected. Upload a photo of the book cover/barcode or enter ISBN below.'
        );
      }
    }
  }, [lookupIsbnFromServer, stopCamera]);

  // Reset & start camera whenever modal opens
  useEffect(() => {
    if (!open) {
      stopCamera();
      busyScanRef.current = false;
      return;
    }

    busyScanRef.current = false;
    setStep('scan');
    setExistingMatch(null);
    setScanErrorMsg('');
    setScanStatusMsg('');
    setBatchSuccessBanner('');
    setAddedCountSession(0);
    setIsbnInput(initialIsbn || '');

    if (initialIsbn && extractIsbnCandidate(initialIsbn).length >= 10) {
      void lookupIsbnFromServer(initialIsbn);
    } else {
      void startCamera();
    }

    return () => {
      stopCamera();
    };
  }, [open, initialIsbn]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const handleCaptureCameraFrame = async () => {
    const vid = videoRef.current;
    if (!vid || !cameraActive || analyzing) return;
    try {
      const { base64, mimeType } = await resizeDataUrlToJpegBase64(vid);
      await scanCoverImageViaServer(base64, mimeType);
    } catch (err) {
      setScanErrorMsg(
        err instanceof Error ? err.message : 'Unable to capture camera frame.'
      );
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setScanErrorMsg('');
    setScanStatusMsg('Processing book image...');
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = async () => {
        try {
          // 1. Check BarcodeDetector on uploaded image if supported
          const BarcodeCtor = (
            window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }
          ).BarcodeDetector;
          if (BarcodeCtor) {
            try {
              const detector = new BarcodeCtor({
                formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'],
              });
              const hits = await detector.detect(img);
              const first = hits.find((h) => h.rawValue && extractIsbnCandidate(h.rawValue).length >= 10);
              if (first?.rawValue) {
                await lookupIsbnFromServer(first.rawValue);
                return;
              }
            } catch {
              // Fall through to cover recognition
            }
          }

          // 2. Fallback to AI cover/barcode text recognition
          const { base64, mimeType } = await resizeDataUrlToJpegBase64(img);
          await scanCoverImageViaServer(base64, mimeType);
        } catch (err) {
          setScanErrorMsg(
            err instanceof Error ? err.message : 'Unable to process uploaded book photo.'
          );
        }
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  };

  const handleManualIsbnSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isbnInput.trim() || analyzing) return;
    void lookupIsbnFromServer(isbnInput.trim());
  };

  const handleIncrementExistingStock = async () => {
    if (!existingMatch || updatingExisting) return;
    const nextTotal = Math.min(500, (Number(existingMatch.totalCopies) || 1) + addCopiesDelta);
    setUpdatingExisting(true);
    setScanErrorMsg('');
    try {
      await saveLibraryBook(
        school.id,
        ownerId,
        {
          isbn: existingMatch.isbn,
          title: existingMatch.title,
          author: existingMatch.author,
          subject: existingMatch.subject,
          materialType: existingMatch.materialType,
          shelfCode: existingMatch.shelfCode,
          totalCopies: nextTotal,
          notes: existingMatch.notes,
        },
        existingMatch.id
      );
      setBatchSuccessBanner(
        `Updated "${existingMatch.title}" stock to ${nextTotal} copies (+${addCopiesDelta}).`
      );
      setAddedCountSession((c) => c + 1);
      setExistingMatch(null);
      setIsbnInput('');
      setScanStatusMsg('');
      setStep('scan');
      void startCamera();
    } catch (err) {
      setScanErrorMsg(err instanceof Error ? err.message : 'Unable to update book copies.');
    } finally {
      setUpdatingExisting(false);
    }
  };

  const handleSaveNewScannedBook = async (scanAnother: boolean) => {
    if (savingBook) return;
    const cleanTitle = formTitle.trim();
    const cleanAuthor = formAuthor.trim();
    const cleanIsbn = formIsbn.trim() || `LIB-${Date.now().toString(36).toUpperCase()}`;

    if (cleanTitle.length < 2) {
      setScanErrorMsg('Enter the book title (at least 2 characters).');
      return;
    }
    if (cleanAuthor.length < 2) {
      setScanErrorMsg('Enter the author name (at least 2 characters).');
      return;
    }

    setSavingBook(true);
    setScanErrorMsg('');
    try {
      await saveLibraryBook(school.id, ownerId, {
        isbn: cleanIsbn,
        title: cleanTitle,
        author: cleanAuthor,
        subject: formSubject.trim() || 'General',
        materialType: formType,
        shelfCode: formShelf.trim().toUpperCase(),
        totalCopies: Math.min(500, Math.max(1, Math.round(Number(formCopies) || 1))),
        notes: formNotes.trim(),
      });

      if (scanAnother) {
        setBatchSuccessBanner(`Added "${cleanTitle}" (${formCopies} ${formCopies === 1 ? 'copy' : 'copies'}) to catalog.`);
        setAddedCountSession((c) => c + 1);
        setIsbnInput('');
        setScanStatusMsg('');
        setExistingMatch(null);
        setStep('scan');
        void startCamera();
      } else {
        stopCamera();
        onClose();
      }
    } catch (err) {
      setScanErrorMsg(err instanceof Error ? err.message : 'Unable to save book to inventory.');
    } finally {
      setSavingBook(false);
    }
  };

  return (
    <ModalBackdrop
      open={open}
      disabled={savingBook || updatingExisting}
      onClose={() => {
        stopCamera();
        onClose();
      }}
      ariaLabelledBy="scan-add-book-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="scan-add-book-title"
              className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2"
            >
              <ScanBarcode className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <span>Scan Book to Add to Catalog</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Point at the ISBN barcode or capture the book cover to auto-fill title, author, and subject.
            </p>
          </div>
          <button
            type="button"
            disabled={savingBook || updatingExisting}
            onClick={() => {
              stopCamera();
              onClose();
            }}
            aria-label="Close book scanner"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {batchSuccessBanner && (
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 px-3.5 py-2.5 text-xs text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <span>{batchSuccessBanner}</span>
            </span>
            {addedCountSession > 0 && (
              <span className="font-mono font-semibold shrink-0">
                {addedCountSession} added
              </span>
            )}
          </div>
        )}

        {scanErrorMsg && (
          <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
            {scanErrorMsg}
          </div>
        )}

        {step === 'scan' && (
          <div className="space-y-4">
            <div className="relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video flex items-center justify-center">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
              />
              <canvas ref={canvasRef} className="hidden" />

              {cameraActive && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <div className="w-60 h-28 sm:w-72 sm:h-32 rounded-xl border-2 border-emerald-400/90 shadow-[0_0_0_9999px_rgba(2,6,23,0.4)]" />
                  <span className="mt-2 px-2.5 py-0.5 rounded-md bg-slate-950/80 text-[11px] font-medium text-slate-200">
                    {analyzing
                      ? scanStatusMsg || 'Reading book...'
                      : barcodeDetectorSupported
                      ? 'Align ISBN barcode or click Capture Cover'
                      : 'Frame book cover or barcode, then click Capture Cover'}
                  </span>
                </div>
              )}

              {!cameraActive && (
                <div className="p-6 text-center space-y-3 max-w-sm">
                  <Camera className="w-8 h-8 text-slate-400 mx-auto" aria-hidden="true" />
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {cameraStarting
                      ? 'Starting device camera...'
                      : cameraError || 'Camera preview is paused.'}
                  </p>
                  {!cameraStarting && (
                    <button
                      type="button"
                      onClick={() => void startCamera()}
                      className="inline-flex items-center gap-1.5 min-h-[38px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Start Camera</span>
                    </button>
                  )}
                </div>
              )}

              {analyzing && (
                <div className="absolute inset-0 bg-slate-950/70 flex flex-col items-center justify-center gap-2 text-white text-xs font-medium">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-400" aria-hidden="true" />
                  <span>{scanStatusMsg || 'Scanning book details...'}</span>
                </div>
              )}
            </div>

            {/* Primary Camera Capture + Photo Upload Row */}
            <div className="flex flex-wrap items-center gap-2.5">
              {cameraActive && (
                <button
                  type="button"
                  disabled={analyzing}
                  onClick={() => void handleCaptureCameraFrame()}
                  className="flex-1 min-w-[180px] inline-flex items-center justify-center gap-1.5 min-h-[42px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{analyzing ? 'Reading Book...' : 'Capture Book Cover'}</span>
                </button>
              )}

              <label className="flex-1 min-w-[160px] min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer">
                <Upload className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                <span>Upload Cover / Barcode</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={analyzing}
                  onChange={handlePhotoUpload}
                  className="sr-only"
                />
              </label>
            </div>

            {/* USB Barcode Gun / Manual ISBN Lookup */}
            <form
              onSubmit={handleManualIsbnSubmit}
              className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-end gap-2"
            >
              <div className="flex-1 min-w-[200px]">
                <label
                  htmlFor="scan-isbn-lookup"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  USB Barcode Scanner or ISBN Lookup
                </label>
                <input
                  id="scan-isbn-lookup"
                  type="text"
                  value={isbnInput}
                  onChange={(e) => setIsbnInput(e.target.value)}
                  placeholder="Scan barcode or type 10/13-digit ISBN (e.g. 9780140177398)..."
                  className="w-full min-h-[40px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
                />
              </div>
              <button
                type="submit"
                disabled={analyzing || !isbnInput.trim()}
                className="min-h-[40px] px-4 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Lookup ISBN
              </button>
            </form>
          </div>
        )}

        {step === 'review' && existingMatch && (
          <div className="space-y-4">
            <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 p-4 space-y-2">
              <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                Book Already Exists in Catalog
              </div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                {existingMatch.title}
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-300">
                by {existingMatch.author} · {existingMatch.subject} · {existingMatch.materialType}
              </div>
              <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                ISBN {existingMatch.isbn} · Current stock: {existingMatch.totalCopies} copies
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2">
                <label
                  htmlFor="scan-add-copies"
                  className="text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Copies to Add:
                </label>
                <input
                  id="scan-add-copies"
                  type="number"
                  min={1}
                  max={200}
                  value={addCopiesDelta}
                  onChange={(e) =>
                    setAddCopiesDelta(Math.max(1, Math.min(200, Number(e.target.value) || 1)))
                  }
                  className="w-20 min-h-[38px] px-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm tabular-nums"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setExistingMatch(null);
                    setScanErrorMsg('');
                    setStep('scan');
                    void startCamera();
                  }}
                  className="min-h-[38px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
                >
                  Scan Another
                </button>
                <button
                  type="button"
                  disabled={updatingExisting}
                  onClick={() => void handleIncrementExistingStock()}
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {updatingExisting
                      ? 'Updating...'
                      : `Add +${addCopiesDelta} ${addCopiesDelta === 1 ? 'Copy' : 'Copies'}`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'review' && !existingMatch && (
          <div className="space-y-4">
            {scanStatusMsg && (
              <div className="rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2 text-xs text-slate-700 dark:text-slate-300">
                {scanStatusMsg}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-5">
                <label
                  htmlFor="scan-form-isbn"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  ISBN
                </label>
                <input
                  id="scan-form-isbn"
                  type="text"
                  maxLength={32}
                  value={formIsbn}
                  onChange={(e) => setFormIsbn(e.target.value)}
                  placeholder="Auto-generated if blank"
                  className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-7">
                <label
                  htmlFor="scan-form-title"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Book Title
                </label>
                <input
                  id="scan-form-title"
                  type="text"
                  required
                  maxLength={140}
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-8">
                <label
                  htmlFor="scan-form-author"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Author Name(s)
                </label>
                <input
                  id="scan-form-author"
                  type="text"
                  required
                  maxLength={120}
                  value={formAuthor}
                  onChange={(e) => setFormAuthor(e.target.value)}
                  className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-4">
                <label
                  htmlFor="scan-form-copies"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Total Copies
                </label>
                <input
                  id="scan-form-copies"
                  type="number"
                  min={1}
                  max={500}
                  value={formCopies}
                  onChange={(e) =>
                    setFormCopies(Math.max(1, Math.min(500, Number(e.target.value) || 1)))
                  }
                  className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm tabular-nums"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="scan-form-subject"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Subject
                </label>
                <select
                  id="scan-form-subject"
                  value={formSubject}
                  onChange={(e) => {
                    const next = e.target.value;
                    setFormSubject(next);
                    if (!formShelf || formShelf.startsWith('LIB-')) {
                      setFormShelf(suggestShelfPrefix(next));
                    }
                  }}
                  className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                >
                  {allSubjectChoices.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  {!allSubjectChoices.includes('General') && (
                    <option value="General">General</option>
                  )}
                </select>
              </div>

              <div>
                <label
                  htmlFor="scan-form-type"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Material Type
                </label>
                <select
                  id="scan-form-type"
                  value={formType}
                  onChange={(e) => setFormType(e.target.value as LibraryMaterialCategory)}
                  className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                >
                  {LIBRARY_MATERIAL_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="scan-form-shelf"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Shelf Prefix
                </label>
                <input
                  id="scan-form-shelf"
                  type="text"
                  maxLength={40}
                  value={formShelf}
                  onChange={(e) => setFormShelf(e.target.value.toUpperCase())}
                  className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm uppercase"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="scan-form-notes"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Notes (Optional)
              </label>
              <input
                id="scan-form-notes"
                type="text"
                maxLength={240}
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Edition, publisher, or Form 1–4 level..."
                className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              />
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                disabled={savingBook}
                onClick={() => {
                  setScanErrorMsg('');
                  setStep('scan');
                  void startCamera();
                }}
                className="min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
              >
                Rescan Book
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={savingBook}
                  onClick={() => void handleSaveNewScannedBook(true)}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/40 text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/80 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  <BookPlus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{savingBook ? 'Saving...' : 'Save & Scan Next'}</span>
                </button>
                <button
                  type="button"
                  disabled={savingBook}
                  onClick={() => void handleSaveNewScannedBook(false)}
                  className="min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  {savingBook ? 'Saving...' : 'Save & Close'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
};
