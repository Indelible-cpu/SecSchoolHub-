export const MAX_STUDENT_PHOTO_DIMENSION = 256;
export const MAX_STUDENT_PHOTO_DATA_URL_LENGTH = 150_000;
export const MAX_STUDENT_PHOTO_FILE_BYTES = 15 * 1024 * 1024;

const ALLOWED_STUDENT_PHOTO_REGEX =
  /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/**
 * Validates that a student photo string is either empty (cleared) or a bounded
 * base64 JPEG/PNG/WebP data URL matching Firestore rules limits (<= 160 KB).
 */
export function isValidStudentPhotoDataUrl(val: unknown): val is string {
  if (typeof val !== 'string') return false;
  if (val === '') return true;
  if (val.length < 22 || val.length > 160_000) return false;
  return ALLOWED_STUDENT_PHOTO_REGEX.test(val);
}

/**
 * Returns 1-2 uppercase initials for avatar fallbacks.
 */
export function getStudentInitials(fullName?: string): string {
  const parts = String(fullName ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'ST';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

function encodeSquareSourceToDataUrl(
  source: HTMLVideoElement | HTMLImageElement,
  srcWidth: number,
  srcHeight: number,
  options?: { mirrorHorizontal?: boolean }
): string {
  if (!srcWidth || !srcHeight) {
    throw new Error('Camera frame or image has zero dimensions.');
  }

  // Center-crop to a 1:1 square portrait
  const cropSide = Math.min(srcWidth, srcHeight);
  const sx = Math.max(0, Math.round((srcWidth - cropSide) / 2));
  const sy = Math.max(0, Math.round((srcHeight - cropSide) / 2));

  const dimensions = [MAX_STUDENT_PHOTO_DIMENSION, 224, 192, 160];
  const qualities = [0.86, 0.78, 0.68, 0.56];
  const canvas = document.createElement('canvas');

  for (const targetSize of dimensions) {
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D rendering is not supported on this device.');
    }

    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetSize, targetSize);
    if (options?.mirrorHorizontal) {
      ctx.translate(targetSize, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(source, sx, sy, cropSide, cropSide, 0, 0, targetSize, targetSize);
    ctx.restore();

    for (const quality of qualities) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= MAX_STUDENT_PHOTO_DATA_URL_LENGTH) {
        return dataUrl;
      }
    }
  }

  throw new Error('Student photo is too large after compression. Try capturing with a simpler background.');
}

/**
 * Captures the current live video frame into a center-cropped, bounded square JPEG data URL.
 */
export function captureStudentPhotoFromVideo(
  video: HTMLVideoElement,
  options?: { mirrorHorizontal?: boolean }
): string {
  if (video.readyState < video.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
    throw new Error('Camera video stream is not ready yet. Wait a moment and try again.');
  }
  return encodeSquareSourceToDataUrl(video, video.videoWidth, video.videoHeight, options);
}

/**
 * Converts a user-selected image file into a center-cropped, bounded square JPEG data URL.
 */
export async function processStudentPhotoFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please select a valid image file (PNG, JPG, or WebP).');
  }
  if (file.type === 'image/svg+xml') {
    throw new Error('SVG files are not permitted for student portraits. Use PNG, JPG, or WebP.');
  }
  if (file.size > MAX_STUDENT_PHOTO_FILE_BYTES) {
    throw new Error('Selected photo is too large (max 15 MB before compression).');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode the selected image file.'));
      el.src = objectUrl;
    });
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    return encodeSquareSourceToDataUrl(img, width, height);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
