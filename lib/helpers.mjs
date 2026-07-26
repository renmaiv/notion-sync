/**
 * notion2astro/lib/helpers.mjs
 *
 * Framework-agnostic helpers shared by both the Astro components and the Notion
 * sync script. Import from either context — no browser or Astro globals used here.
 */

/**
 * Format an ISO date string (YYYY-MM-DD) into a human-readable label.
 * Override `locale` and `options` for your preferred format.
 *
 * @param {string} iso   - e.g. "2026-07-15"
 * @param {string} locale - e.g. "en-GB" (default)
 * @param {Intl.DateTimeFormatOptions} options
 * @returns {string}     - e.g. "15 Jul 2026"
 */
export function formatDate(iso, locale = 'en-GB', options = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '';
  const date = new Date(`${iso}T00:00:00Z`);
  if (isNaN(date)) return '';
  return date.toLocaleDateString(locale, { ...options, timeZone: 'UTC' });
}

/**
 * Returns "N min read" label from a minutes number.
 * @param {number} mins
 * @returns {string}
 */
export function readLabel(mins) {
  const n = Math.max(1, Math.round(Number(mins) || 1));
  return `${n} min read`;
}

/**
 * Returns true when the media URL points at a video file (.mp4).
 * @param {string} src
 * @returns {boolean}
 */
export function isVideo(src) {
  return typeof src === 'string' && src.toLowerCase().endsWith('.mp4');
}

/**
 * Resolve the status badge metadata for a card or article header.
 * Returns one of:
 *   { mode: 'date',  date: string }   – a formatted publish date
 *   { mode: 'meta',  icon: string, text: string }  – wip / ever-updating badge
 *   { mode: 'none' }                  – nothing to show
 *
 * @param {string} status         - article.status ("published", "wip", "ever-updating")
 * @param {string|null} iso       - article.datePublished
 * @param {object} icons          - optional icon overrides: { wip, everUpdating }
 */
export function statusMeta(status, iso, icons = {}) {
  if (iso) return { mode: 'date', date: formatDate(iso) };
  const s = String(status || '').toLowerCase();
  if (s === 'wip') {
    return {
      mode: 'meta',
      icon: icons.wip || '/notion2astro/wip.svg',
      text: 'Work in progress',
    };
  }
  if (s === 'ever-updating' || s === 'everupdating') {
    return {
      mode: 'meta',
      icon: icons.everUpdating || '/notion2astro/ever-updating.svg',
      text: 'Ever-updating',
    };
  }
  return { mode: 'none' };
}
