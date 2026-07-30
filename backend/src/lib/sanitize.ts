/**
 * Input sanitization utilities.
 * Strips HTML tags and dangerous content from free-text fields before storage.
 * This prevents stored XSS if content is ever rendered in HTML contexts (emails, PDFs, etc.)
 *
 * Note: All API responses are consumed by React which auto-escapes, so the primary
 * risk is in non-React outputs (email, PDF reports, admin dashboards outside React).
 */

// Simple but effective — strip all HTML tags and control characters
export function sanitizeText(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove common script injection patterns
    .replace(/javascript\s*:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    // Remove null bytes (buffer overflow vector)
    .replace(/\0/g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

// For fields that allow more content — only strip the most dangerous patterns
export function sanitizeDescription(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\0/g, '')
    .trim();
}
