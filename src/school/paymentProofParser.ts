import type { FeeSubmissionFileFormat } from './types';

export const MAX_FEE_PROOF_BYTES = 8 * 1024 * 1024; // 8 MB (<= 18 chunks of 450 KB)

export interface ParsedPaymentProofFile {
  fileFormat: FeeSubmissionFileFormat;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  fileBytes: Uint8Array;
}

export async function parsePaymentProofFile(file: File): Promise<ParsedPaymentProofFile> {
  if (file.size === 0) {
    throw new Error('The selected file is empty.');
  }
  if (file.size > MAX_FEE_PROOF_BYTES) {
    throw new Error('Payment proof must be 8 MB or smaller.');
  }

  const lowerName = file.name.toLowerCase();
  const mime = (file.type || '').toLowerCase();
  const cleanName = file.name.trim().slice(0, 160) || 'payment-reference';

  if (lowerName.endsWith('.pdf') || mime === 'application/pdf') {
    const buffer = await file.arrayBuffer();
    return {
      fileFormat: 'pdf',
      fileName: cleanName,
      mimeType: 'application/pdf',
      fileSizeBytes: file.size,
      fileBytes: new Uint8Array(buffer),
    };
  }

  if (
    mime.startsWith('image/') ||
    /\.(png|jpe?g|webp)$/i.test(lowerName)
  ) {
    const buffer = await file.arrayBuffer();
    const detectedMime =
      mime && mime.startsWith('image/')
        ? mime.slice(0, 100)
        : lowerName.endsWith('.png')
        ? 'image/png'
        : lowerName.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';

    return {
      fileFormat: 'image',
      fileName: cleanName,
      mimeType: detectedMime,
      fileSizeBytes: file.size,
      fileBytes: new Uint8Array(buffer),
    };
  }

  throw new Error('Upload a PDF (.pdf) or image (.png, .jpg, .jpeg, .webp) payment slip or screenshot.');
}
