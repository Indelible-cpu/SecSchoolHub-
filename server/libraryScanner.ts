import { GoogleGenAI, Type } from '@google/genai';

export const VALID_MATERIAL_TYPES = [
  'Textbook',
  'Set Book',
  'Reference Book',
  'Past Papers',
  'Reader / Novel',
  'Science Manual',
] as const;

export type LibraryMaterialType = (typeof VALID_MATERIAL_TYPES)[number];

export interface ScannedBookMetadata {
  isbn: string;
  title: string;
  author: string;
  subject: string;
  materialType: LibraryMaterialType;
  notes: string;
  source: 'openlibrary' | 'googlebooks' | 'gemini_vision';
}

export function normalizeIsbn(raw: unknown): string {
  const str = String(raw ?? '').trim();
  if (!str) return '';

  // Check SecSchoolHub JSON QR format
  if (str.startsWith('{')) {
    try {
      const parsed = JSON.parse(str) as { isbn?: string };
      if (parsed && typeof parsed.isbn === 'string') {
        return normalizeIsbn(parsed.isbn);
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  // Extract digits/X only
  const stripped = str.replace(/[^0-9Xx]/g, '').toUpperCase();
  if (stripped.length === 13 && (stripped.startsWith('978') || stripped.startsWith('979'))) {
    return stripped;
  }
  if (stripped.length === 10) {
    return stripped;
  }
  // Sometimes barcode scanners include extra prefixes around a 13-digit ISBN
  const match13 = stripped.match(/(97[89]\d{10})/);
  if (match13) return match13[1];
  return stripped.slice(0, 13);
}

export function isValidIsbn(isbn: string): boolean {
  const clean = normalizeIsbn(isbn);
  if (/^\d{13}$/.test(clean)) return true;
  if (/^\d{9}[\dX]$/.test(clean)) return true;
  return false;
}

export function matchCurriculumSubject(
  rawSubjects: string[],
  title: string,
  allowedSubjects: string[]
): string {
  const haystack = `${rawSubjects.join(' ')} ${title}`.toLowerCase();
  const candidates = allowedSubjects.length > 0 ? allowedSubjects : [];

  for (const subj of candidates) {
    const low = subj.toLowerCase();
    if (haystack.includes(low)) return subj;
  }

  const keywordMap: Array<[RegExp, string]> = [
    [/\b(biology|life\s+science|anatomy|botany|zoology)\b/i, 'Biology'],
    [/\b(math|mathematics|algebra|geometry|calculus|trigonometry)\b/i, 'Mathematics'],
    [/\b(physics|chemistry|physical\s+science)\b/i, 'Physical Science'],
    [/\b(chichewa|nyanja)\b/i, 'Chichewa'],
    [/\b(english|literature|grammar|comprehension|novel|shakespeare|drama|poetry)\b/i, 'English'],
    [/\b(geography|earth\s+science|atlas|mapwork)\b/i, 'Geography'],
    [/\b(history|world\s+history|african\s+history)\b/i, 'History'],
    [/\b(agriculture|agronomy|farming|soil|livestock)\b/i, 'Agriculture'],
    [/\b(bible|christian|religious|theology|scripture)\b/i, 'Bible Knowledge'],
    [/\b(social\s+studies|life\s+skills|civics|ethics)\b/i, 'Social & Life Skills'],
    [/\b(business|commerce|accounting|economics|entrepreneur)\b/i, 'Business Studies'],
    [/\b(computer|computing|informatics|programming|ict)\b/i, 'Computer Studies'],
  ];

  for (const [pattern, mapped] of keywordMap) {
    if (pattern.test(haystack)) {
      const exact = candidates.find((s) => s.toLowerCase() === mapped.toLowerCase());
      return exact || mapped;
    }
  }

  return candidates[0] || 'General';
}

export function inferMaterialType(
  rawSubjects: string[],
  title: string,
  notes: string
): LibraryMaterialType {
  const combined = `${rawSubjects.join(' ')} ${title} ${notes}`.toLowerCase();
  if (/\b(past\s+papers?|exam\s+papers?|maneb|question\s+papers?)\b/.test(combined)) {
    return 'Past Papers';
  }
  if (/\b(lab|laboratory|practical\s+manuals?|experiments?|science\s+manuals?)\b/.test(combined)) {
    return 'Science Manual';
  }
  if (/\b(dictionar(y|ies)|encyclopedias?|atlas(es)?|reference|handbooks?|thesaurus)\b/.test(combined)) {
    return 'Reference Book';
  }
  if (/\b(set\s+books?|literature|plays?|drama|antholog(y|ies)|poems?)\b/.test(combined)) {
    return 'Set Book';
  }
  if (/\b(novels?|fiction|short\s+stories|readers?|tales)\b/.test(combined)) {
    return 'Reader / Novel';
  }
  return 'Textbook';
}

export async function lookupBookByIsbn(
  rawIsbn: string,
  allowedSubjects: string[] = []
): Promise<{ found: boolean; isbn: string; book?: ScannedBookMetadata }> {
  const isbn = normalizeIsbn(rawIsbn);
  if (!isValidIsbn(isbn)) {
    return { found: false, isbn };
  }

  // 1. Try Open Library Books API
  try {
    const bibKey = `ISBN:${isbn}`;
    const olRes = await fetch(
      `https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(bibKey)}&format=json&jscmd=data`,
      {
        headers: { Accept: 'application/json', 'User-Agent': 'SecSchoolHub/1.0' },
        signal: AbortSignal.timeout(5500),
      }
    );
    if (olRes.ok) {
      const data = (await olRes.json()) as Record<
        string,
        {
          title?: string;
          subtitle?: string;
          authors?: Array<{ name?: string }>;
          subjects?: Array<{ name?: string }>;
          publishers?: Array<{ name?: string }>;
          publish_date?: string;
        }
      >;
      const entry = data?.[bibKey];
      if (entry && entry.title) {
        const title = entry.subtitle ? `${entry.title}: ${entry.subtitle}` : entry.title;
        const author =
          (entry.authors || [])
            .map((a) => a.name?.trim())
            .filter(Boolean)
            .join(', ') || 'Unknown Author';
        const rawSubjects = (entry.subjects || []).map((s) => s.name || '').filter(Boolean);
        const publisher = (entry.publishers || [])[0]?.name?.trim();
        const notesParts = [
          publisher ? `Publisher: ${publisher}` : '',
          entry.publish_date ? `Published: ${entry.publish_date}` : '',
        ].filter(Boolean);
        const notes = notesParts.join(' · ').slice(0, 240);

        return {
          found: true,
          isbn,
          book: {
            isbn,
            title: title.slice(0, 140),
            author: author.slice(0, 120),
            subject: matchCurriculumSubject(rawSubjects, title, allowedSubjects),
            materialType: inferMaterialType(rawSubjects, title, notes),
            notes,
            source: 'openlibrary',
          },
        };
      }
    }
  } catch {
    // Fall through to Google Books API
  }

  // 2. Fallback to Google Books Volumes API
  try {
    const gbRes = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5500),
      }
    );
    if (gbRes.ok) {
      const gbData = (await gbRes.json()) as {
        items?: Array<{
          volumeInfo?: {
            title?: string;
            subtitle?: string;
            authors?: string[];
            categories?: string[];
            publisher?: string;
            publishedDate?: string;
          };
        }>;
      };
      const info = gbData?.items?.[0]?.volumeInfo;
      if (info && info.title) {
        const title = info.subtitle ? `${info.title}: ${info.subtitle}` : info.title;
        const author =
          (info.authors || []).map((a) => a.trim()).filter(Boolean).join(', ') || 'Unknown Author';
        const rawSubjects = (info.categories || []).filter(Boolean);
        const notesParts = [
          info.publisher ? `Publisher: ${info.publisher}` : '',
          info.publishedDate ? `Published: ${info.publishedDate}` : '',
        ].filter(Boolean);
        const notes = notesParts.join(' · ').slice(0, 240);

        return {
          found: true,
          isbn,
          book: {
            isbn,
            title: title.slice(0, 140),
            author: author.slice(0, 120),
            subject: matchCurriculumSubject(rawSubjects, title, allowedSubjects),
            materialType: inferMaterialType(rawSubjects, title, notes),
            notes,
            source: 'googlebooks',
          },
        };
      }
    }
  } catch {
    // Ignore upstream failure and report not found
  }

  return { found: false, isbn };
}

export async function extractBookFromCoverImage(params: {
  imageBase64: string;
  mimeType: string;
  allowedSubjects?: string[];
}): Promise<ScannedBookMetadata> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'Book cover AI recognition requires GEMINI_API_KEY to be configured on the server. Scan the ISBN barcode or enter details manually.'
    );
  }

  const cleanMime =
    params.mimeType === 'image/png' || params.mimeType === 'image/webp'
      ? params.mimeType
      : 'image/jpeg';

  const base64Data = params.imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '').trim();
  if (!base64Data || base64Data.length < 100) {
    throw new Error('Captured book image is empty or invalid.');
  }

  const subjectsHint =
    params.allowedSubjects && params.allowedSubjects.length > 0
      ? params.allowedSubjects.slice(0, 20).join(', ')
      : 'English, Chichewa, Mathematics, Biology, Physical Science, Geography, History, Agriculture, Bible Knowledge, Social & Life Skills, Business Studies, Computer Studies';

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: cleanMime,
            data: base64Data,
          },
        },
        {
          text: `Inspect this photo of a book cover, back cover, title page, or barcode. Extract bibliographic metadata for a secondary school library catalog.
- Read any printed ISBN-10 or ISBN-13 digits accurately if visible (empty string if none).
- Extract the full book title (including subtitle/form level if printed on the cover).
- Extract the author name(s) or organization (empty string if not visible).
- Pick the best matching school subject from: ${subjectsHint} (or "General").
- Pick the materialType from: ${VALID_MATERIAL_TYPES.join(', ')}.
- Put concise edition, publisher, or Form 1-4 level details in notes.`,
        },
      ],
    },
    config: {
      systemInstruction:
        'You are a school library cataloging assistant. Extract exact visible book details concisely and accurately.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isbn: { type: Type.STRING, description: 'ISBN-10 or ISBN-13 digits/hyphens if visible, else empty string.' },
          title: { type: Type.STRING, description: 'Book title visible on the cover or page.' },
          author: { type: Type.STRING, description: 'Author or publisher name visible on the book.' },
          subject: { type: Type.STRING, description: 'Matching curriculum subject.' },
          materialType: { type: Type.STRING, description: 'One of Textbook, Set Book, Reference Book, Past Papers, Reader / Novel, Science Manual.' },
          notes: { type: Type.STRING, description: 'Concise edition, publisher, or Form level note.' },
        },
      },
    },
  });

  const rawText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawText) as {
    isbn?: string;
    title?: string;
    author?: string;
    subject?: string;
    materialType?: string;
    notes?: string;
  };

  const normalizedIsbn = normalizeIsbn(parsed.isbn || '');
  const validIsbn = isValidIsbn(normalizedIsbn) ? normalizedIsbn : '';

  // If Vision found a valid ISBN but missed title or author, try enriching via Open Library / Google Books
  if (validIsbn && (!parsed.title?.trim() || !parsed.author?.trim())) {
    const lookup = await lookupBookByIsbn(validIsbn, params.allowedSubjects || []);
    if (lookup.found && lookup.book) {
      return {
        isbn: validIsbn,
        title: (parsed.title?.trim() || lookup.book.title).slice(0, 140),
        author: (parsed.author?.trim() || lookup.book.author).slice(0, 120),
        subject: parsed.subject?.trim() || lookup.book.subject,
        materialType: lookup.book.materialType,
        notes: (parsed.notes?.trim() || lookup.book.notes).slice(0, 240),
        source: 'gemini_vision',
      };
    }
  }

  const title = (parsed.title || '').trim().slice(0, 140);
  if (!title) {
    throw new Error('Could not read a book title from that image. Hold the cover closer in bright light or scan the ISBN barcode.');
  }

  const rawType = (parsed.materialType || '').trim();
  const matchedType =
    VALID_MATERIAL_TYPES.find((t) => t.toLowerCase() === rawType.toLowerCase()) ||
    inferMaterialType([parsed.subject || ''], title, parsed.notes || '');

  return {
    isbn: validIsbn,
    title,
    author: (parsed.author || '').trim().slice(0, 120) || 'Unknown Author',
    subject: matchCurriculumSubject(
      [parsed.subject || ''],
      title,
      params.allowedSubjects || []
    ),
    materialType: matchedType,
    notes: (parsed.notes || '').trim().slice(0, 240),
    source: 'gemini_vision',
  };
}
