import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth/mammoth.browser.min.js';
import type { DigitalStorageFormat } from './types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const MAX_DIGITAL_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export interface ParsedDigitalUpload {
  storageFormat: DigitalStorageFormat;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  content: string;
  fileBytes: Uint8Array | null;
  pageCount?: number;
  suggestedTitle: string;
}

export function formatFileSizeLabel(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const sliceSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += sliceSize) {
    const chunk = bytes.subarray(i, Math.min(i + sliceSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function cleanSuggestedTitle(fileName: string): string {
  const withoutExt = fileName.replace(/\.[^.]+$/, '');
  return withoutExt.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
}

export async function parseUploadedDigitalMaterial(file: File): Promise<ParsedDigitalUpload> {
  if (file.size === 0) {
    throw new Error('The selected file is empty.');
  }
  if (file.size > MAX_DIGITAL_UPLOAD_BYTES) {
    throw new Error('File is larger than 10 MB. Compress the PDF or split large volumes.');
  }

  const lowerName = file.name.toLowerCase();
  const mime = (file.type || '').toLowerCase();
  const suggestedTitle = cleanSuggestedTitle(file.name);

  // 1. PDF Document -> binary chunks + page-text preview
  if (lowerName.endsWith('.pdf') || mime === 'application/pdf') {
    const buffer = await file.arrayBuffer();
    const fileBytes = new Uint8Array(buffer);
    let pageCount = 0;
    let previewText = '';

    try {
      const loadingTask = pdfjsLib.getDocument({ data: fileBytes.slice() });
      const pdf = await loadingTask.promise;
      pageCount = pdf.numPages;
      const pagesToExtract = Math.min(pdf.numPages, 8);
      const pageTexts: string[] = [];
      for (let pageNo = 1; pageNo <= pagesToExtract; pageNo += 1) {
        const page = await pdf.getPage(pageNo);
        const textContent = await page.getTextContent();
        const line = textContent.items
          .map((item) => ('str' in item ? String(item.str) : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (line) {
          pageTexts.push(`## Page ${pageNo}\n${line}`);
        }
      }
      previewText = pageTexts.join('\n\n').slice(0, 28000);
      await loadingTask.destroy();
    } catch {
      // Scanned or protected PDF structure: binary rendering in reader will still proceed
      previewText = '';
    }

    return {
      storageFormat: 'pdf',
      fileName: file.name,
      mimeType: 'application/pdf',
      fileSizeBytes: file.size,
      content: previewText,
      fileBytes,
      pageCount: pageCount || undefined,
      suggestedTitle,
    };
  }

  // 2. Word Document (.docx) -> clean structured text extraction
  if (
    lowerName.endsWith('.docx') ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const buffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    const rawText = String(result.value || '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (rawText.length < 20) {
      throw new Error(
        'This Word document contains too little readable text (or only embedded scans). Export it as PDF and upload the PDF instead.'
      );
    }

    const formatted = rawText.includes('## ')
      ? rawText
      : `## ${suggestedTitle || 'Document Content'}\n${rawText}`;

    return {
      storageFormat: 'text',
      fileName: file.name,
      mimeType:
        mime || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSizeBytes: file.size,
      content: formatted.slice(0, 30000),
      fileBytes: null,
      suggestedTitle,
    };
  }

  // 3. Plain Text / Markdown (.txt, .md)
  if (
    lowerName.endsWith('.txt') ||
    lowerName.endsWith('.md') ||
    mime === 'text/plain' ||
    mime === 'text/markdown'
  ) {
    const rawText = (await file.text()).replace(/\r\n/g, '\n').trim();
    if (rawText.length < 20) {
      throw new Error('Text file must contain at least 20 characters of reading content.');
    }
    const formatted = rawText.includes('## ')
      ? rawText
      : `## ${suggestedTitle || 'Reading Material'}\n${rawText}`;

    return {
      storageFormat: 'text',
      fileName: file.name,
      mimeType: mime || 'text/plain',
      fileSizeBytes: file.size,
      content: formatted.slice(0, 30000),
      fileBytes: null,
      suggestedTitle,
    };
  }

  // 4. Scanned Image / Study Sheet (.png, .jpg, .jpeg, .webp)
  if (
    mime.startsWith('image/') ||
    /\.(png|jpe?g|webp)$/i.test(lowerName)
  ) {
    const buffer = await file.arrayBuffer();
    const fileBytes = new Uint8Array(buffer);
    const detectedMime =
      mime ||
      (lowerName.endsWith('.png')
        ? 'image/png'
        : lowerName.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg');
    return {
      storageFormat: 'image',
      fileName: file.name,
      mimeType: detectedMime,
      fileSizeBytes: file.size,
      content: '',
      fileBytes,
      suggestedTitle,
    };
  }

  throw new Error(
    'Unsupported file format. Upload a PDF (.pdf), Word (.docx), Text/Markdown (.txt, .md), or Image (.png, .jpg, .webp).'
  );
}
