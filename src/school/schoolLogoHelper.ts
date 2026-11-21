const MAX_RAW_LOGO_BYTES = 3 * 1024 * 1024;
const MAX_LOGO_DIMENSION = 256;
const MAX_LOGO_DATA_URL_LENGTH = 150000;

const SUPPORTED_LOGO_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
]);

export async function processSchoolLogoFile(file: File): Promise<string> {
  const mime = (file.type || '').toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const validExt = ['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext);

  if (!SUPPORTED_LOGO_MIME.has(mime) && !validExt) {
    throw new Error('Select a PNG, JPG, WebP, or SVG logo image.');
  }
  if (file.size === 0) {
    throw new Error('The selected logo file is empty.');
  }
  if (file.size > MAX_RAW_LOGO_BYTES) {
    throw new Error('Logo image must be 3 MB or smaller.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not read the selected image file.'));
      image.src = objectUrl;
    });

    const srcWidth = img.naturalWidth || img.width || MAX_LOGO_DIMENSION;
    const srcHeight = img.naturalHeight || img.height || MAX_LOGO_DIMENSION;
    const scale = Math.min(1, MAX_LOGO_DIMENSION / Math.max(srcWidth, srcHeight));
    const width = Math.max(1, Math.round(srcWidth * scale));
    const height = Math.max(1, Math.round(srcHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to prepare image canvas for logo.');
    }
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    let dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length > MAX_LOGO_DATA_URL_LENGTH) {
      dataUrl = canvas.toDataURL('image/webp', 0.88);
    }
    if (dataUrl.length > MAX_LOGO_DATA_URL_LENGTH) {
      const compactCanvas = document.createElement('canvas');
      const compactScale = Math.min(1, 160 / Math.max(srcWidth, srcHeight));
      compactCanvas.width = Math.max(1, Math.round(srcWidth * compactScale));
      compactCanvas.height = Math.max(1, Math.round(srcHeight * compactScale));
      const compactCtx = compactCanvas.getContext('2d');
      if (compactCtx) {
        compactCtx.fillStyle = '#FFFFFF';
        compactCtx.fillRect(0, 0, compactCanvas.width, compactCanvas.height);
        compactCtx.drawImage(img, 0, 0, compactCanvas.width, compactCanvas.height);
        dataUrl = compactCanvas.toDataURL('image/jpeg', 0.85);
      }
    }

    if (dataUrl.length > MAX_LOGO_DATA_URL_LENGTH) {
      throw new Error('Processed logo is still too large. Choose a simpler square logo image.');
    }

    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
