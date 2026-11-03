// Calendar dates are plain YYYY-MM-DD values (the community calendar), so they are formatted
// as UTC dates to avoid the browser's own time zone shifting them by a day.
const fmt = (opts) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...opts });
const toDate = (iso) => new Date(`${iso}T00:00:00Z`);

export const shortDate = (iso) => fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(toDate(iso));
export const dayMonth = (iso) => fmt({ month: 'short', day: 'numeric' }).format(toDate(iso));
export const longDate = (iso) => fmt({ weekday: 'long', month: 'long', day: 'numeric' }).format(toDate(iso));

export function range(start, end) {
  if (start === end) return shortDate(start);
  const s = toDate(start);
  const e = toDate(end);
  if (s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear()) {
    return `${fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(s)} – ${fmt({ weekday: 'short', day: 'numeric' }).format(e)}`;
  }
  return `${shortDate(start)} – ${shortDate(end)}`;
}

export function addDays(iso, n) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const daysInclusive = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000) + 1;

export function when(timestamp) {
  const d = new Date(timestamp);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400 && new Date().getDate() === d.getDate()) return `today at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function relativeDay(n) {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export const RATINGS = [
  { value: 'like-new', label: 'Like new', hint: 'Spotless, works perfectly' },
  { value: 'good', label: 'Good', hint: 'Normal use, all there' },
  { value: 'worn', label: 'Some wear', hint: 'Scuffs or small issues' },
  { value: 'damaged', label: 'Damaged', hint: 'Broken or missing parts' },
];
export const ratingLabel = (v) => RATINGS.find((r) => r.value === v)?.label ?? '';
