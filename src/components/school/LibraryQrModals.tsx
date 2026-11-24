import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { jsPDF } from 'jspdf';
import {
  Camera,
  CheckCircle2,
  Download,
  FileText,
  QrCode,
  RefreshCw,
  RotateCcw,
  ScanBarcode,
  Search,
  Upload,
  X,
} from 'lucide-react';
import {
  LibraryBook,
  LibraryItemCondition,
  LibraryLoan,
  School,
  Student,
} from '../../school/types';
import { ModalBackdrop } from './ModalBackdrop';
import {
  addDaysToIsoDate,
  getLibraryDaysOverdue,
  isLibraryLoanOverdue,
  LIBRARY_RETURN_CONDITIONS,
} from '../../school/malawi';
import {
  markLibraryLoanReturned,
  saveLibraryBook,
  saveLibraryLoan,
} from '../../school/firestoreService';
import {
  buildBookQrPayload,
  compactScanToken,
  findBookForLoan,
  parseScannedQrToBook,
  resolveScannedBarcodeOrQr,
  type ScanCirculationMode,
  suggestCopyCodeForBook,
} from '../../school/libraryScannerUtils';

export { buildBookQrPayload, parseScannedQrToBook };

function createLibraryCodeReader(): BrowserMultiFormatReader {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.QR_CODE,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.ITF,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 180,
    delayBetweenScanSuccess: 700,
  });
}

interface LibraryBookQrModalProps {
  open: boolean;
  school: School;
  book: LibraryBook | null;
  availableCopies: number;
  totalCopies: number;
  onClose: () => void;
  onOpenScannerWithBook?: (book: LibraryBook) => void;
}

export const LibraryBookQrModal: React.FC<LibraryBookQrModalProps> = ({
  open,
  school,
  book,
  availableCopies,
  totalCopies,
  onClose,
  onOpenScannerWithBook,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrError, setQrError] = useState('');

  useEffect(() => {
    if (!open || !book) {
      setQrDataUrl('');
      setQrError('');
      return;
    }

    let cancelled = false;
    const payload = buildBookQrPayload(school.id, book);
    QRCode.toDataURL(payload, {
      width: 280,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) {
          setQrDataUrl(url);
          setQrError('');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setQrError(err instanceof Error ? err.message : 'Unable to generate QR code.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [book, open, school.id]);

  if (!open || !book) return null;

  const handleDownloadPng = () => {
    if (!qrDataUrl) return;
    const slug = (book.shelfCode || book.isbn || book.id)
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 40);
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `${slug}_QR.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadPdfLabel = () => {
    if (!qrDataUrl) return;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a6' });
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(8, 8, 89, 132, 3, 3);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(school.name.slice(0, 36), 52.5, 17, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('School Library Book QR Label', 52.5, 22, { align: 'center' });

    doc.addImage(qrDataUrl, 'PNG', 22.5, 28, 60, 60);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    const titleLines = doc.splitTextToSize(book.title, 76);
    doc.text(titleLines.slice(0, 2), 52.5, 96, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`Author: ${book.author}`.slice(0, 42), 52.5, 108, { align: 'center' });
    doc.text(`ISBN: ${book.isbn}`, 52.5, 115, { align: 'center' });
    doc.text(
      `Shelf: ${book.shelfCode || 'General'}  |  Subject: ${book.subject || 'General'}`,
      52.5,
      122,
      { align: 'center' }
    );
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('Scan with SecSchoolHub Library Scanner', 52.5, 133, { align: 'center' });

    const slug = (book.shelfCode || book.isbn || book.id)
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 40);
    doc.save(`${slug}_Label.pdf`);
  };

  return (
    <ModalBackdrop
      open={Boolean(book)}
      onClose={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
      ariaLabelledBy="book-qr-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="book-qr-modal-title"
              className="text-base font-semibold text-slate-900 dark:text-white"
            >
              Library Book QR Code
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close QR dialog"
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col items-center text-center space-y-3 py-2">
          {qrError ? (
            <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-4 py-3 text-xs text-rose-800 dark:text-rose-200">
              {qrError}
            </div>
          ) : qrDataUrl ? (
            <div className="p-3 rounded-2xl bg-white border border-slate-200 shadow-xs">
              <img
                src={qrDataUrl}
                alt={`QR code for ${book.title}`}
                className="w-52 h-52 object-contain"
              />
            </div>
          ) : (
            <div className="w-52 h-52 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
          )}

          <div className="space-y-1">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">
              {book.title}
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-300">
              by {book.author}
            </div>
            <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              ISBN {book.isbn} · {book.shelfCode || 'General'} · {availableCopies}/{totalCopies}{' '}
              available
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadPng}
              disabled={!qrDataUrl}
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>PNG</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPdfLabel}
              disabled={!qrDataUrl}
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" aria-hidden="true" />
              <span>PDF Label</span>
            </button>
          </div>

          {onOpenScannerWithBook && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenScannerWithBook(book);
              }}
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              <QrCode className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Check In / Out</span>
            </button>
          )}
        </div>
      </div>
    </ModalBackdrop>
  );
};

interface SessionActivityItem {
  id: string;
  action: 'Checked Out' | 'Returned';
  detail: string;
}

interface LibraryQrScannerModalProps {
  open: boolean;
  school: School;
  ownerId: string;
  libraryBooks: LibraryBook[];
  libraryLoans: LibraryLoan[];
  students: Student[];
  canWriteLibrary: boolean;
  initialBook?: LibraryBook | null;
  initialMode?: ScanCirculationMode;
  onAddNewBookFromScan?: (scannedCode: string) => void;
  onClose: () => void;
}

export const LibraryQrScannerModal: React.FC<LibraryQrScannerModalProps> = ({
  open,
  school,
  ownerId,
  libraryBooks,
  libraryLoans,
  students,
  canWriteLibrary,
  initialBook = null,
  initialMode = 'auto',
  onAddNewBookFromScan,
  onClose,
}) => {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const lastDecodedRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });
  const manualInputRef = useRef<HTMLInputElement | null>(null);

  const [scanMode, setScanMode] = useState<ScanCirculationMode>(initialMode);
  const [matchedBookId, setMatchedBookId] = useState<string | null>(initialBook?.id || null);
  const [highlightedLoanId, setHighlightedLoanId] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [scanNotice, setScanNotice] = useState('');
  const [lastUnmatchedRaw, setLastUnmatchedRaw] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [sessionLog, setSessionLog] = useState<SessionActivityItem[]>([]);

  // Quick checkout form state
  const [studentFilter, setStudentFilter] = useState('');
  const [checkoutStudentId, setCheckoutStudentId] = useState('');
  const [checkoutCopyCode, setCheckoutCopyCode] = useState('');
  const [checkoutDueDate, setCheckoutDueDate] = useState(() => addDaysToIsoDate(todayIso, 14));
  const [submittingCheckout, setSubmittingCheckout] = useState(false);

  // Quick return condition state per loan
  const [returnConditionMap, setReturnConditionMap] = useState<
    Record<string, LibraryItemCondition>
  >({});
  const [returningLoanId, setReturningLoanId] = useState<string | null>(null);

  // Quick total copies adjustment
  const [stockCopiesInput, setStockCopiesInput] = useState(1);
  const [updatingStock, setUpdatingStock] = useState(false);

  const activeStudents = useMemo(
    () =>
      students
        .filter((s) => s.status === 'Active')
        .sort(
          (a, b) =>
            a.formLevel - b.formLevel ||
            a.stream.localeCompare(b.stream) ||
            a.fullName.localeCompare(b.fullName)
        ),
    [students]
  );

  const filteredCheckoutStudents = useMemo(() => {
    const q = studentFilter.trim().toLowerCase();
    if (!q) return activeStudents;
    return activeStudents.filter(
      (s) =>
        s.fullName.toLowerCase().includes(q) ||
        (s.admissionNo || '').toLowerCase().includes(q) ||
        (s.registrationCode || '').toLowerCase().includes(q) ||
        `form ${s.formLevel}${s.stream}`.toLowerCase().includes(q)
    );
  }, [activeStudents, studentFilter]);

  const highlightedLoan = useMemo(
    () =>
      highlightedLoanId
        ? libraryLoans.find((l) => l.id === highlightedLoanId && l.status === 'Checked Out') || null
        : null,
    [highlightedLoanId, libraryLoans]
  );

  const matchedBook = useMemo(() => {
    if (matchedBookId) {
      return libraryBooks.find((b) => b.id === matchedBookId) || null;
    }
    if (highlightedLoan) {
      return findBookForLoan(highlightedLoan, libraryBooks);
    }
    return null;
  }, [highlightedLoan, libraryBooks, matchedBookId]);

  const matchedBookLoans = useMemo(() => {
    if (!matchedBook && !highlightedLoan) return [];
    const targetTitle = (matchedBook?.title || highlightedLoan?.bookTitle || '').trim().toLowerCase();
    const targetIsbn = compactScanToken(matchedBook?.isbn);
    return libraryLoans
      .filter((loan) => {
        if (loan.status !== 'Checked Out') return false;
        if (highlightedLoan && loan.id === highlightedLoan.id) return true;
        const titleMatch = targetTitle && loan.bookTitle.trim().toLowerCase() === targetTitle;
        const noteMatch =
          targetIsbn.length >= 6 && compactScanToken(loan.notes).includes(targetIsbn);
        return Boolean(titleMatch || noteMatch);
      })
      .sort((a, b) => {
        if (a.id === highlightedLoanId) return -1;
        if (b.id === highlightedLoanId) return 1;
        return a.dueDate.localeCompare(b.dueDate);
      });
  }, [highlightedLoan, highlightedLoanId, libraryLoans, matchedBook]);

  const checkedOutCount = useMemo(
    () =>
      matchedBookLoans.reduce(
        (sum, loan) => sum + Math.max(1, Number(loan.quantity) || 1),
        0
      ),
    [matchedBookLoans]
  );

  const availableCopies = matchedBook
    ? Math.max(0, (Number(matchedBook.totalCopies) || 1) - checkedOutCount)
    : 0;

  const stopCamera = useCallback(() => {
    if (scannerControlsRef.current) {
      try {
        scannerControlsRef.current.stop();
      } catch {
        // Ignore stop errors on already-stopped tracks
      }
      scannerControlsRef.current = null;
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

  const handleDecodedValue = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return false;

      const resolved = resolveScannedBarcodeOrQr(
        trimmed,
        libraryBooks,
        libraryLoans,
        activeStudents
      );

      if (resolved.kind === 'student') {
        setCheckoutStudentId(resolved.student.id);
        setStudentFilter('');
        setScanNotice('');
        setLastUnmatchedRaw('');
        setActionError('');
        setActionSuccess(
          `Borrower locked: ${resolved.student.fullName} (Form ${resolved.student.formLevel}${resolved.student.stream}). Scan a book next to check out.`
        );
        if (scanMode === 'auto') {
          setScanMode('check_out');
        }
        return true;
      }

      if (resolved.kind === 'loan_and_book') {
        stopCamera();
        setHighlightedLoanId(resolved.loan.id);
        setMatchedBookId(resolved.book?.id || null);
        setLastUnmatchedRaw('');
        setScanNotice('');
        setActionError('');
        setActionSuccess('');
        if (resolved.book) {
          setStockCopiesInput(resolved.book.totalCopies || 1);
          setCheckoutCopyCode(suggestCopyCodeForBook(resolved.book, libraryLoans));
        }
        return true;
      }

      if (resolved.kind === 'book') {
        stopCamera();
        setHighlightedLoanId(null);
        setMatchedBookId(resolved.book.id);
        setLastUnmatchedRaw('');
        setScanNotice('');
        setActionError('');
        setActionSuccess('');
        setStockCopiesInput(resolved.book.totalCopies || 1);
        setCheckoutCopyCode(suggestCopyCodeForBook(resolved.book, libraryLoans));
        return true;
      }

      setLastUnmatchedRaw(trimmed);
      setScanNotice(
        `Scanned "${trimmed.slice(0, 48)}" — no matching book copy, ISBN, or student found.`
      );
      return false;
    },
    [activeStudents, libraryBooks, libraryLoans, scanMode, stopCamera]
  );

  const startCamera = useCallback(async () => {
    setCameraError('');
    setScanNotice('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Camera access is unavailable here. Upload a barcode/QR photo or scan with a USB reader below.'
      );
      return;
    }

    stopCamera();
    setCameraStarting(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        stopCamera();
        return;
      }

      const reader = createLibraryCodeReader();
      setCameraStarting(false);
      setCameraActive(true);

      const controls = await reader.decodeFromStream(stream, video, (result) => {
        if (!result) return;
        const text = result.getText()?.trim();
        if (!text) return;
        const now = Date.now();
        if (
          lastDecodedRef.current.value === text &&
          now - lastDecodedRef.current.at < 1200
        ) {
          return;
        }
        lastDecodedRef.current = { value: text, at: now };
        handleDecodedValue(text);
      });

      scannerControlsRef.current = controls;
    } catch (err) {
      stopCamera();
      const msg = err instanceof Error ? err.message : '';
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('notallowed')) {
        setCameraError(
          'Camera permission was denied. Allow camera access or use photo upload / USB barcode input below.'
        );
      } else {
        setCameraError(
          'No live camera detected. Upload a barcode/QR image or scan using a USB reader below.'
        );
      }
    }
  }, [handleDecodedValue, stopCamera]);

  // Sync open / initialBook / initialMode lifecycle
  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }

    setScanMode(initialMode);
    setActionError('');
    setActionSuccess('');
    setScanNotice('');
    setLastUnmatchedRaw('');
    setManualInput('');
    setStudentFilter('');
    setHighlightedLoanId(null);
    setCheckoutDueDate(addDaysToIsoDate(todayIso, 14));
    if (activeStudents.length > 0 && !checkoutStudentId) {
      setCheckoutStudentId(activeStudents[0].id);
    }

    if (initialBook) {
      stopCamera();
      setMatchedBookId(initialBook.id);
      setStockCopiesInput(initialBook.totalCopies || 1);
      setCheckoutCopyCode(suggestCopyCodeForBook(initialBook, libraryLoans));
    } else {
      setMatchedBookId(null);
      startCamera();
    }

    return () => {
      stopCamera();
    };
  }, [open, initialBook, initialMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeStudents.length > 0 && !activeStudents.some((s) => s.id === checkoutStudentId)) {
      setCheckoutStudentId(activeStudents[0].id);
    }
  }, [activeStudents, checkoutStudentId]);

  if (!open) return null;

  const resumeScanning = (keepSuccessMessage = false) => {
    setMatchedBookId(null);
    setHighlightedLoanId(null);
    setManualInput('');
    setScanNotice('');
    setActionError('');
    if (!keepSuccessMessage) {
      setActionSuccess('');
    }
    startCamera();
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setScanNotice('');
    setActionError('');
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl) return;

      // 1. Try ZXing multi-format reader (supports 1D ISBN/EAN/Code128 barcodes + QR codes)
      try {
        const zxing = createLibraryCodeReader();
        const result = await zxing.decodeFromImageUrl(dataUrl);
        const text = result?.getText()?.trim();
        if (text) {
          handleDecodedValue(text);
          return;
        }
      } catch {
        // Fall through to jsQR fallback
      }

      // 2. Fallback to jsQR
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(data.data, data.width, data.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (!decoded || !decoded.data) {
          setScanNotice(
            'No barcode or QR code could be read from that image. Hold the label flatter in bright light or enter the code below.'
          );
          return;
        }
        handleDecodedValue(decoded.data);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    handleDecodedValue(manualInput.trim());
    setManualInput('');
  };

  const handleQuickReturn = async (loan: LibraryLoan, andScanNext = false) => {
    if (!canWriteLibrary) return;
    const condition = returnConditionMap[loan.id] || 'Good';
    setReturningLoanId(loan.id);
    setActionError('');
    setActionSuccess('');
    try {
      await markLibraryLoanReturned(school.id, loan.id, {
        returnedDate: todayIso,
        conditionOnReturn: condition,
        notes: loan.notes || '',
      });
      const summaryMsg = `Returned "${loan.bookTitle}" (${loan.bookCode}) from ${loan.studentName} in ${condition} condition.`;
      setSessionLog((prev) => [
        { id: `${Date.now()}_${loan.id}`, action: 'Returned', detail: `${loan.bookCode} · ${loan.studentName}` },
        ...prev.slice(0, 5),
      ]);
      setActionSuccess(summaryMsg);
      if (andScanNext) {
        resumeScanning(true);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to mark book as returned.');
    } finally {
      setReturningLoanId(null);
    }
  };

  const submitCheckout = async (andScanNext: boolean) => {
    if (!matchedBook || !canWriteLibrary) return;
    const student = students.find((s) => s.id === checkoutStudentId);
    if (!student) {
      setActionError('Select a student before checking out a copy.');
      return;
    }
    if (!checkoutCopyCode.trim()) {
      setActionError('Enter a copy/asset code (e.g. LIB-BIO-001).');
      return;
    }
    if (checkoutDueDate < todayIso) {
      setActionError('Due date cannot be earlier than today.');
      return;
    }

    setSubmittingCheckout(true);
    setActionError('');
    setActionSuccess('');
    try {
      const codeUpper = checkoutCopyCode.trim().toUpperCase();
      await saveLibraryLoan(school.id, ownerId, {
        studentId: student.id,
        studentName: student.fullName,
        admissionNo: student.admissionNo || 'N/A',
        formLevel: student.formLevel,
        stream: student.stream || 'A',
        bookTitle: matchedBook.title,
        materialType: matchedBook.materialType,
        subject: matchedBook.subject || 'General',
        bookCode: codeUpper,
        quantity: 1,
        checkoutDate: todayIso,
        dueDate: checkoutDueDate,
        returnedDate: '',
        status: 'Checked Out',
        conditionOnReturn: 'Good',
        notes: `ISBN ${matchedBook.isbn} · Barcode/QR Scan Checkout`,
      });
      setSessionLog((prev) => [
        { id: `${Date.now()}_${codeUpper}`, action: 'Checked Out', detail: `${codeUpper} → ${student.fullName}` },
        ...prev.slice(0, 5),
      ]);
      setActionSuccess(
        `Checked out copy ${codeUpper} of "${matchedBook.title}" to ${student.fullName} (due ${checkoutDueDate}).`
      );
      if (andScanNext) {
        resumeScanning(true);
      } else {
        setCheckoutCopyCode(
          suggestCopyCodeForBook(matchedBook, [
            ...libraryLoans,
            {
              id: 'tmp',
              ownerId,
              studentId: student.id,
              studentName: student.fullName,
              admissionNo: student.admissionNo || 'N/A',
              formLevel: student.formLevel,
              stream: student.stream || 'A',
              bookTitle: matchedBook.title,
              materialType: matchedBook.materialType,
              subject: matchedBook.subject,
              bookCode: codeUpper,
              quantity: 1,
              checkoutDate: todayIso,
              dueDate: checkoutDueDate,
              returnedDate: '',
              status: 'Checked Out',
              conditionOnReturn: 'Good',
              notes: '',
            },
          ])
        );
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to check out book.');
    } finally {
      setSubmittingCheckout(false);
    }
  };

  const handleUpdateTotalCopies = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchedBook || !canWriteLibrary) return;
    const cleanTotal = Math.min(500, Math.max(1, Math.round(Number(stockCopiesInput) || 1)));
    setUpdatingStock(true);
    setActionError('');
    setActionSuccess('');
    try {
      await saveLibraryBook(
        school.id,
        ownerId,
        {
          isbn: matchedBook.isbn,
          title: matchedBook.title,
          author: matchedBook.author,
          subject: matchedBook.subject,
          materialType: matchedBook.materialType,
          shelfCode: matchedBook.shelfCode,
          totalCopies: cleanTotal,
          notes: matchedBook.notes,
        },
        matchedBook.id
      );
      setActionSuccess(`Updated total inventory stock for "${matchedBook.title}" to ${cleanTotal} copies.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update stock count.');
    } finally {
      setUpdatingStock(false);
    }
  };

  const hasResolvedItem = Boolean(matchedBook || highlightedLoan);
  const showCheckInSection = scanMode !== 'check_out' || Boolean(highlightedLoan);
  const showCheckOutSection = canWriteLibrary && Boolean(matchedBook) && scanMode !== 'check_in';

  return (
    <ModalBackdrop
      open={open}
      onClose={() => {
        stopCamera();
        onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
      ariaLabelledBy="qr-scanner-modal-title"
    >
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-xl space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2
              id="qr-scanner-modal-title"
              className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2"
            >
              <ScanBarcode className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
              <span>
                {hasResolvedItem
                  ? 'Scanned Book Circulation'
                  : 'Scan Book Barcode or QR Code'}
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Supports ISBN/EAN-13 book barcodes, Code 128 copy labels, SecSchoolHub book QRs, and student codes.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            aria-label="Close scanner"
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Segmented Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
            {(
              [
                { id: 'auto', label: 'Auto (In & Out)' },
                { id: 'check_in', label: 'Quick Check In' },
                { id: 'check_out', label: 'Quick Check Out' },
              ] as { id: ScanCirculationMode; label: string }[]
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setScanMode(opt.id)}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  scanMode === opt.id
                    ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {sessionLog.length > 0 && (
            <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              Session: {sessionLog.length} processed
            </span>
          )}
        </div>

        {actionError && (
          <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
            {actionError}
          </div>
        )}

        {actionSuccess && (
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 px-3.5 py-2.5 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* Scanner Viewport (when no book/loan is locked in yet) */}
        {!hasResolvedItem && (
          <div className="space-y-4">
            <div className="relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video flex items-center justify-center">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
              />

              {cameraActive && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="w-60 h-32 sm:w-72 sm:h-40 rounded-xl border-2 border-emerald-400/90 shadow-[0_0_0_9999px_rgba(2,6,23,0.45)]" />
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
                      onClick={startCamera}
                      className="inline-flex items-center gap-1.5 min-h-[38px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Retry Camera</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {scanNotice && (
              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
                <span>{scanNotice}</span>
                {canWriteLibrary && onAddNewBookFromScan && lastUnmatchedRaw && (
                  <button
                    type="button"
                    onClick={() => {
                      stopCamera();
                      onClose();
                      onAddNewBookFromScan(lastUnmatchedRaw);
                    }}
                    className="font-semibold text-emerald-800 dark:text-emerald-300 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Scan &amp; Add as New Book →
                  </button>
                )}
              </div>
            )}

            {/* Fallbacks: USB Barcode Scanner Input & Photo Upload */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <form onSubmit={handleManualSubmit} className="sm:col-span-8 flex gap-2">
                <div className="flex-1">
                  <label
                    htmlFor="qr-manual-lookup"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    USB Barcode Reader / ISBN / Copy Code
                  </label>
                  <input
                    ref={manualInputRef}
                    id="qr-manual-lookup"
                    type="text"
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    placeholder="Scan barcode, copy code (LIB-BIO-001), or ISBN..."
                    className="w-full min-h-[40px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
                  />
                </div>
                <button
                  type="submit"
                  className="self-end min-h-[40px] px-4 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Find
                </button>
              </form>

              <div className="sm:col-span-4">
                <label className="w-full min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer">
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Upload Barcode / QR</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleImageUpload}
                    className="sr-only"
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Matched Book / Loan Status & Quick Check-In / Check-Out Controls */}
        {hasResolvedItem && (
          <div className="space-y-5">
            {matchedBook ? (
              <div className="rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    {matchedBook.title}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    by {matchedBook.author} · {matchedBook.subject || 'General'} ·{' '}
                    {matchedBook.materialType}
                  </div>
                  <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    ISBN {matchedBook.isbn} · Shelf: {matchedBook.shelfCode || 'General'}
                  </div>
                </div>

                <div className="sm:text-right shrink-0 space-y-1">
                  <div
                    className={`text-sm font-bold font-mono tabular-nums ${
                      availableCopies > 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {availableCopies} / {matchedBook.totalCopies} available
                  </div>
                  <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {checkedOutCount} currently checked out
                  </div>
                </div>
              </div>
            ) : highlightedLoan ? (
              <div className="rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-4 space-y-1">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  {highlightedLoan.bookTitle}
                </div>
                <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  Copy {highlightedLoan.bookCode} · Borrowed by {highlightedLoan.studentName}
                </div>
              </div>
            ) : null}

            {/* 1. Quick Check-In for Active Checked-Out Loans */}
            {showCheckInSection && (
              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Active Loans to Check In ({matchedBookLoans.length})
                </h3>
                {matchedBookLoans.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 px-4 py-4 text-xs text-slate-500 dark:text-slate-400">
                    No copies of this book are currently checked out to students.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    {matchedBookLoans.map((loan) => {
                      const overdue = isLibraryLoanOverdue(loan, todayIso);
                      const daysLate = overdue ? getLibraryDaysOverdue(loan.dueDate, todayIso) : 0;
                      const busy = returningLoanId === loan.id;
                      const isDirectScanMatch = highlightedLoanId === loan.id;

                      return (
                        <div
                          key={loan.id}
                          className={`p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                            isDirectScanMatch
                              ? 'bg-emerald-50/60 dark:bg-emerald-950/25'
                              : 'bg-white dark:bg-[#161B22]'
                          }`}
                        >
                          <div className="space-y-0.5">
                            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                              {loan.studentName} · Form {loan.formLevel}
                              {loan.stream}
                            </div>
                            <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                              {loan.bookCode} · Due {loan.dueDate}
                              {overdue && (
                                <span className="text-rose-600 dark:text-rose-400 font-semibold">
                                  {' '}
                                  · {daysLate}d overdue
                                </span>
                              )}
                            </div>
                          </div>

                          {canWriteLibrary && (
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              <select
                                aria-label={`Return condition for ${loan.studentName}`}
                                value={returnConditionMap[loan.id] || 'Good'}
                                onChange={(e) =>
                                  setReturnConditionMap((prev) => ({
                                    ...prev,
                                    [loan.id]: e.target.value as LibraryItemCondition,
                                  }))
                                }
                                className="min-h-[34px] px-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200"
                              >
                                {LIBRARY_RETURN_CONDITIONS.map((cond) => (
                                  <option key={cond} value={cond}>
                                    {cond}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => handleQuickReturn(loan, false)}
                                disabled={busy}
                                className="min-h-[34px] px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
                              >
                                {busy ? 'Saving...' : 'Check In'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleQuickReturn(loan, true)}
                                disabled={busy}
                                className="min-h-[34px] px-3 rounded-lg border border-emerald-700/40 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
                              >
                                Check In &amp; Scan Next
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* 2. Quick Check-Out Copy to Student */}
            {showCheckOutSection && matchedBook && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitCheckout(false);
                }}
                className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Quick Check Out Copy
                  </h3>
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                    <button
                      type="button"
                      onClick={() => setCheckoutDueDate(addDaysToIsoDate(todayIso, 14))}
                      className="hover:underline cursor-pointer"
                    >
                      +14d
                    </button>
                    <button
                      type="button"
                      onClick={() => setCheckoutDueDate(addDaysToIsoDate(todayIso, 30))}
                      className="hover:underline cursor-pointer"
                    >
                      +30d
                    </button>
                    <button
                      type="button"
                      onClick={() => setCheckoutDueDate(addDaysToIsoDate(todayIso, 90))}
                      className="hover:underline cursor-pointer"
                    >
                      Term (+90d)
                    </button>
                  </div>
                </div>

                {activeStudents.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Add active students in the Students registry before checking out books.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {activeStudents.length > 8 && (
                      <div className="relative">
                        <Search
                          className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                          aria-hidden="true"
                        />
                        <input
                          type="text"
                          value={studentFilter}
                          onChange={(e) => {
                            setStudentFilter(e.target.value);
                            const q = e.target.value.trim().toLowerCase();
                            if (q) {
                              const first = activeStudents.find(
                                (s) =>
                                  s.fullName.toLowerCase().includes(q) ||
                                  (s.admissionNo || '').toLowerCase().includes(q) ||
                                  (s.registrationCode || '').toLowerCase().includes(q)
                              );
                              if (first) setCheckoutStudentId(first.id);
                            }
                          }}
                          placeholder="Filter borrower by name, admission #, or reg code..."
                          className="w-full min-h-[36px] pl-8 pr-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                      <div className="sm:col-span-6">
                        <label
                          htmlFor="qr-checkout-student"
                          className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
                        >
                          Student
                        </label>
                        <select
                          id="qr-checkout-student"
                          value={checkoutStudentId}
                          onChange={(e) => setCheckoutStudentId(e.target.value)}
                          className="w-full min-h-[38px] px-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100"
                        >
                          {filteredCheckoutStudents.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.fullName} — {s.admissionNo} (F{s.formLevel}
                              {s.stream})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-3">
                        <label
                          htmlFor="qr-checkout-code"
                          className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
                        >
                          Copy Code
                        </label>
                        <input
                          id="qr-checkout-code"
                          type="text"
                          required
                          maxLength={40}
                          value={checkoutCopyCode}
                          onChange={(e) => setCheckoutCopyCode(e.target.value.toUpperCase())}
                          className="w-full min-h-[38px] px-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-xs uppercase text-slate-900 dark:text-slate-100"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <label
                          htmlFor="qr-checkout-due"
                          className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
                        >
                          Due Date
                        </label>
                        <input
                          id="qr-checkout-due"
                          type="date"
                          required
                          value={checkoutDueDate}
                          onChange={(e) => setCheckoutDueDate(e.target.value)}
                          className="w-full min-h-[38px] px-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-[11px] text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap justify-end gap-2 pt-1">
                      <button
                        type="button"
                        disabled={submittingCheckout || availableCopies === 0}
                        onClick={() => void submitCheckout(true)}
                        className="min-h-[38px] px-3.5 rounded-xl border border-emerald-700/40 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-xs font-semibold disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Check Out &amp; Scan Next
                      </button>
                      <button
                        type="submit"
                        disabled={submittingCheckout || availableCopies === 0}
                        className="min-h-[38px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {submittingCheckout ? 'Saving...' : 'Check Out Copy'}
                      </button>
                    </div>
                  </div>
                )}
              </form>
            )}

            {/* 3. Adjust Total Catalog Stock & Scan Next */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              {canWriteLibrary && matchedBook ? (
                <form onSubmit={handleUpdateTotalCopies} className="flex items-center gap-2">
                  <label
                    htmlFor="qr-total-stock"
                    className="text-xs font-medium text-slate-600 dark:text-slate-400"
                  >
                    Catalog Stock:
                  </label>
                  <input
                    id="qr-total-stock"
                    type="number"
                    min={1}
                    max={500}
                    value={stockCopiesInput}
                    onChange={(e) =>
                      setStockCopiesInput(Math.max(1, Math.min(500, Number(e.target.value) || 1)))
                    }
                    className="w-20 min-h-[36px] px-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-xs text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    disabled={updatingStock}
                    className="min-h-[36px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
                  >
                    {updatingStock ? 'Updating...' : 'Update Stock'}
                  </button>
                </form>
              ) : (
                <div />
              )}

              <button
                type="button"
                onClick={() => resumeScanning(false)}
                className="inline-flex items-center justify-center gap-1.5 min-h-[38px] px-4 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold hover:opacity-90 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Scan Another Book</span>
              </button>
            </div>
          </div>
        )}

        {/* Compact Session Activity Strip */}
        {sessionLog.length > 0 && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              Recent Scans This Session
            </div>
            <div className="space-y-1 text-xs">
              {sessionLog.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 text-slate-700 dark:text-slate-300 font-mono text-[11px]"
                >
                  <span className="truncate">{item.detail}</span>
                  <span
                    className={
                      item.action === 'Returned'
                        ? 'text-emerald-700 dark:text-emerald-400 font-semibold shrink-0'
                        : 'text-amber-700 dark:text-amber-400 font-semibold shrink-0'
                    }
                  >
                    {item.action}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
};
