import type { Entry } from '#lib/server/store.ts';

// What an entry is called: its title, or for a post without one, its text.
export function displayTitle(entry: Pick<Entry, 'title' | 'text' | 'url'>): string {
  return entry.title || entry.text || entry.url;
}

// When an entry was posted: "Nov 14", with the year if it isn't this one.
export function dateLabel(ms: number, now = new Date()): string {
  const date = new Date(ms);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}
