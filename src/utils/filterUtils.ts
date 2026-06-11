import { useEffect, useRef } from 'react';
import type { BookItem } from '../types/weread';

function topCategory(book?: BookItem): string | null {
  if (!book) return null;
  const raw = book.category || book.categories?.[0]?.title || '';
  if (!raw) return null;
  const first = raw.split(/[-/|｜·>]/)[0]?.trim();
  return first || null;
}

export function collectCategories(items: BookItem[]): string[] {
  const set = new Set<string>();
  items.forEach(b => {
    const c = topCategory(b);
    if (c) set.add(c);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh'));
}

export function applyFilters<T>(items: T[], getBook: (t: T) => BookItem, keyword: string, category: string): T[] {
  const kw = keyword.trim().toLowerCase();
  return items.filter(item => {
    const book = getBook(item);
    if (category !== 'all' && topCategory(book) !== category) return false;
    if (kw) {
      const title = (book.title || '').toLowerCase();
      const author = (book.author || '').toLowerCase();
      if (!title.includes(kw) && !author.includes(kw)) return false;
    }
    return true;
  });
}

export function useInfiniteScroll(hasMore: boolean, onLoadMore: () => void, displayCount: number) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) onLoadMore(); },
      { rootMargin: '300px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, displayCount]);
  return sentinelRef;
}
