import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getStudentInitials,
  isValidStudentPhotoDataUrl,
} from '../src/school/studentPhotoHelper';

describe('studentPhotoHelper', () => {
  it('accepts empty string (photo cleared) and valid bounded JPEG/PNG/WebP data URLs', () => {
    assert.equal(isValidStudentPhotoDataUrl(''), true);
    assert.equal(
      isValidStudentPhotoDataUrl('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD='),
      true
    );
    assert.equal(
      isValidStudentPhotoDataUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'),
      true
    );
    assert.equal(
      isValidStudentPhotoDataUrl('data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA='),
      true
    );
  });

  it('rejects SVG data URLs, remote URLs, non-strings, and oversized payloads', () => {
    assert.equal(isValidStudentPhotoDataUrl(null), false);
    assert.equal(isValidStudentPhotoDataUrl(undefined), false);
    assert.equal(
      isValidStudentPhotoDataUrl('data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+'),
      false
    );
    assert.equal(isValidStudentPhotoDataUrl('https://example.com/photo.jpg'), false);
    assert.equal(isValidStudentPhotoDataUrl('javascript:alert(1)'), false);
    assert.equal(isValidStudentPhotoDataUrl('data:image/jpeg;base64,bad*chars!'), false);

    const oversized = `data:image/jpeg;base64,${'A'.repeat(160_000)}`;
    assert.equal(isValidStudentPhotoDataUrl(oversized), false);
  });

  it('computes clean 1-2 character uppercase student initials', () => {
    assert.equal(getStudentInitials('Chifundo Tembo'), 'CT');
    assert.equal(getStudentInitials('Grace Mary Banda'), 'GB');
    assert.equal(getStudentInitials('Kondwani'), 'KO');
    assert.equal(getStudentInitials(''), 'ST');
  });
});
