import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  FlipHorizontal2,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  captureStudentPhotoFromVideo,
  getStudentInitials,
  isValidStudentPhotoDataUrl,
  processStudentPhotoFile,
} from '../../school/studentPhotoHelper';
import { ModalBackdrop } from './ModalBackdrop';

interface StudentPhotoCaptureModalProps {
  open: boolean;
  studentName: string;
  admissionNo?: string;
  initialPhotoUrl?: string;
  mode: 'immediate' | 'form';
  headerLabel?: string;
  saveButtonLabel?: string;
  saving?: boolean;
  saveError?: string;
  onSavePhoto: (photoDataUrl: string) => Promise<void> | void;
  onClose: () => void;
}

export const StudentPhotoCaptureModal: React.FC<StudentPhotoCaptureModalProps> = ({
  open,
  studentName,
  admissionNo,
  initialPhotoUrl = '',
  mode,
  headerLabel = 'Profile Photo Camera',
  saveButtonLabel,
  saving = false,
  saveError = '',
  onSavePhoto,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cancelledRef = useRef(false);

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [localError, setLocalError] = useState('');
  const [processingFile, setProcessingFile] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string>('');
  const [hasCapturedChange, setHasCapturedChange] = useState(false);
  const [videoDeviceCount, setVideoDeviceCount] = useState<number>(1);

  const stopCamera = useCallback(() => {
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

  const startCamera = useCallback(
    async (requestedFacing: 'user' | 'environment') => {
      setCameraError('');
      setLocalError('');

      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        setCameraError(
          'Live device camera is unavailable in this browser. Upload a portrait photo instead.'
        );
        return;
      }

      stopCamera();
      setCameraStarting(true);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: requestedFacing },
            width: { ideal: 720 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelledRef.current) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          return;
        }

        streamRef.current = stream;

        if (navigator.mediaDevices.enumerateDevices) {
          navigator.mediaDevices
            .enumerateDevices()
            .then((devices) => {
              if (!cancelledRef.current) {
                const count = devices.filter((d) => d.kind === 'videoinput').length;
                setVideoDeviceCount(count || 1);
              }
            })
            .catch(() => {
              // Ignore enumerateDevices permission issues
            });
        }

        const video = videoRef.current;
        if (!video) {
          stopCamera();
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (cancelledRef.current) {
          stopCamera();
          return;
        }
        setCameraStarting(false);
        setCameraActive(true);
      } catch (err) {
        stopCamera();
        const rawMsg = err instanceof Error ? err.message.toLowerCase() : '';
        const errName = err instanceof Error ? err.name.toLowerCase() : '';
        if (
          errName.includes('notallowed') ||
          errName.includes('permission') ||
          rawMsg.includes('permission') ||
          rawMsg.includes('denied')
        ) {
          setCameraError(
            'Camera permission was denied. Allow camera access in your browser settings or upload a photo from your device.'
          );
        } else if (errName.includes('notfound') || rawMsg.includes('requested device not found')) {
          setCameraError(
            'No camera hardware was detected on this device. You can upload a student portrait file below.'
          );
        } else if (errName.includes('notreadable') || rawMsg.includes('could not start video')) {
          setCameraError(
            'Camera is currently busy in another app or tab. Close the other camera session and retry, or upload a photo.'
          );
        } else {
          setCameraError(
            'Unable to start the device camera. Try retrying or upload a student portrait image.'
          );
        }
      }
    },
    [stopCamera]
  );

  useEffect(() => {
    if (!open) {
      cancelledRef.current = true;
      stopCamera();
      return;
    }

    cancelledRef.current = false;
    setLocalError('');
    setCameraError('');
    setHasCapturedChange(false);
    const validInitial =
      initialPhotoUrl && isValidStudentPhotoDataUrl(initialPhotoUrl) ? initialPhotoUrl : '';
    setCapturedPhoto(validInitial);

    if (!validInitial) {
      void startCamera(facingMode);
    }

    return () => {
      cancelledRef.current = true;
      stopCamera();
    };
    // Intentionally initialize only when open or initialPhotoUrl changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleCaptureSnapshot = () => {
    setLocalError('');
    const video = videoRef.current;
    if (!video) {
      setLocalError('Camera viewfinder is not ready.');
      return;
    }
    try {
      const dataUrl = captureStudentPhotoFromVideo(video);
      setCapturedPhoto(dataUrl);
      setHasCapturedChange(true);
      stopCamera();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to capture photo.');
    }
  };

  const handleRetake = () => {
    setCapturedPhoto('');
    setHasCapturedChange(false);
    setLocalError('');
    void startCamera(facingMode);
  };

  const handleSwitchCamera = () => {
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextFacing);
    if (!capturedPhoto || cameraActive) {
      void startCamera(nextFacing);
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLocalError('');
    setProcessingFile(true);
    try {
      const dataUrl = await processStudentPhotoFile(file);
      stopCamera();
      setCapturedPhoto(dataUrl);
      setHasCapturedChange(true);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to process selected image.');
    } finally {
      setProcessingFile(false);
    }
  };

  const handleRemovePhoto = async () => {
    setLocalError('');
    if (mode === 'immediate' && initialPhotoUrl) {
      await onSavePhoto('');
      return;
    }
    setCapturedPhoto('');
    setHasCapturedChange(true);
    void startCamera(facingMode);
  };

  const handleSave = async () => {
    if (!isValidStudentPhotoDataUrl(capturedPhoto)) {
      setLocalError('Captured photo format is invalid.');
      return;
    }
    setLocalError('');
    await onSavePhoto(capturedPhoto);
  };

  if (!open) return null;

  const displayError = saveError || localError;
  const showLiveFeed = !capturedPhoto || cameraActive || cameraStarting;

  return (
    <ModalBackdrop open={open} disabled={saving} onClose={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-xl max-h-[92vh] overflow-y-auto space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              {headerLabel}
            </div>
            <h2 className="mt-0.5 text-base font-bold text-slate-900 dark:text-slate-100">
              {studentName.trim() || 'Profile Portrait'}
            </h2>
            {admissionNo && (
              <p className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {admissionNo}
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            aria-label="Close camera modal"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Alerts */}
        {displayError && (
          <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
            {displayError}
          </div>
        )}
        {cameraError && showLiveFeed && (
          <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-200">
            {cameraError}
          </div>
        )}

        {/* Circular Viewfinder / Captured Portrait Frame */}
        <div className="relative mx-auto w-full max-w-[272px] aspect-square rounded-full overflow-hidden border-2 border-slate-200 dark:border-slate-700 bg-slate-950 flex items-center justify-center shadow-xs">
          {capturedPhoto && !cameraActive && !cameraStarting ? (
            <img
              src={capturedPhoto}
              alt={studentName || 'Profile portrait preview'}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover rounded-full"
            />
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`w-full h-full object-cover rounded-full ${cameraActive ? 'opacity-100' : 'opacity-0'}`}
              />
              {cameraActive && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-4 rounded-full border border-white/40"
                />
              )}
              {cameraStarting && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-200 text-xs">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                  <span>Starting device camera...</span>
                </div>
              )}
              {!cameraStarting && !cameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-6 text-center">
                  <div className="w-16 h-16 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-base font-bold text-slate-200">
                    {getStudentInitials(studentName)}
                  </div>
                  <p className="text-xs text-slate-300">
                    {cameraError
                      ? 'Camera unavailable — retry or upload a photo below.'
                      : 'Start camera to take a circular profile photo.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => void startCamera(facingMode)}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Enable Camera</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Hidden Fallback Upload Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFileSelected}
          className="hidden"
        />

        {/* Controls */}
        {showLiveFeed ? (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                disabled={!cameraActive || cameraStarting || saving}
                onClick={handleCaptureSnapshot}
                className="flex-1 min-w-[160px] inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-45 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Capture Photo</span>
              </button>

              {videoDeviceCount > 1 && (
                <button
                  type="button"
                  disabled={cameraStarting || saving}
                  onClick={handleSwitchCamera}
                  aria-label="Switch front or rear camera"
                  className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                >
                  <FlipHorizontal2 className="w-4 h-4" />
                  <span>{facingMode === 'user' ? 'Rear' : 'Front'}</span>
                </button>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                disabled={processingFile || saving}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{processingFile ? 'Processing...' : 'Upload File Instead'}</span>
              </button>

              {initialPhotoUrl && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    stopCamera();
                    setCapturedPhoto(initialPhotoUrl);
                    setHasCapturedChange(false);
                  }}
                  className="min-h-[40px] px-3 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Keep Current
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={handleRetake}
                className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{hasCapturedChange ? 'Retake Photo' : 'Open Camera'}</span>
              </button>

              <button
                type="button"
                disabled={processingFile || saving}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{processingFile ? 'Processing...' : 'Upload Image'}</span>
              </button>

              {capturedPhoto && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleRemovePhoto()}
                  className="inline-flex items-center gap-1.5 min-h-[42px] px-3 rounded-xl border border-rose-200 dark:border-rose-900/70 text-xs font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove</span>
                </button>
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={onClose}
                className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || (!hasCapturedChange && mode === 'immediate')}
                onClick={() => void handleSave()}
                className="inline-flex items-center gap-1.5 min-h-[42px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>
                      {saveButtonLabel || (mode === 'immediate' ? 'Save Profile Photo' : 'Use Photo')}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
};
