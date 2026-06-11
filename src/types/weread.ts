// WeRead API Response Types

// Shelf Types
export interface ShelfData {
  books: BookItem[];
  albums: AlbumItem[];
  mp?: MpEntry;
  archive: ArchiveItem[];
  bookCount: number;
}

export interface BookItem {
  bookId: string;
  title: string;
  author: string;
  cover: string;
  category: string;
  categories?: { title: string }[];
  readUpdateTime: number;
  finishReading: number;
  updateTime: number;
  isTop: number;
  secret: number;
}

interface AlbumItem {
  albumInfo: {
    albumId: string;
    name: string;
    authorName: string;
    cover: string;
    trackCount: number;
    finishStatus: string;
    finish: number;
    payType: number;
    intro: string;
    updateTime: number;
  };
  albumInfoExtra: {
    secret: number;
    lecturePaid: number;
    lectureReadUpdateTime: number;
    isTop: number;
  };
}

interface MpEntry {
  name?: string;
}

interface ArchiveItem {
  name: string;
  bookIds: string[];
}

// Reading Stats Types
export interface ReadingStats {
  baseTime: number;
  readTimes: Record<string, number>;
  readDays: number;
  totalReadTime: number;
  dayAverageReadTime: number;
  compare?: number;
  readLongest: ReadLongestItem[];
  readStat: ReadStatItem[];
  preferCategory: PreferCategoryItem[];
  preferTime: number[];
  preferAuthor?: PreferAuthorItem[];
  preferPublisher?: PreferPublisherItem[];
  readRate?: number;
  wrReadTime?: number;
  wrListenTime?: number;
  rank?: RankInfo;
  preferBooks?: PreferBookItem[];
}

interface ReadLongestItem {
  book?: BookItem;
  albumInfo?: AlbumItem['albumInfo'];
  readTime: number;
  recordReadingTime?: number;
  tags?: string[];
}

interface ReadStatItem {
  stat: string;
  counts: string;
  scheme?: string;
}

interface PreferCategoryItem {
  categoryId: string;
  categoryTitle: string;
  parentCategoryId: string;
  parentCategoryTitle: string;
  val: number;
  readingTime: number;
  readingCount: number;
  categoryType: number;
}

interface PreferAuthorItem {
  authorId: string;
  name: string;
  count: number;
  readTime: string;
  user?: unknown;
}

interface PreferPublisherItem {
  name: string;
  count: number;
}

interface RankInfo {
  text: string;
  scheme?: string;
}

interface PreferBookItem {
  book: BookItem;
  reason?: string;
  preferType?: string;
}

// Notes Types
export interface NotebooksData {
  totalBookCount: number;
  totalNoteCount: number;
  hasMore: number;
  books: NotebookItem[];
}

export interface NotebookItem {
  bookId: string;
  book: BookItem;
  reviewCount: number;
  noteCount: number;
  bookmarkCount: number;
  readingProgress: number;
  markedStatus: number;
  sort: number;
}

export interface BookmarkItem {
  bookmarkId: string;
  bookId: string;
  chapterUid: number;
  markText: string;
  createTime: number;
  type: number;
  range: string;
  colorStyle: number;
}

export interface BookmarkListData {
  updated: BookmarkItem[];
  chapters: ChapterItem[];
  book: BookItem;
}

export interface ChapterItem {
  chapterUid: number;
  chapterIdx: number;
  title: string;
}

export interface ReviewItem {
  likesCount?: number;
  commentsCount?: number;
  review: {
    reviewId: string;
    content: string;
    htmlContent?: string;
    createTime: number;
    star: number;
    chapterName?: string;
    isFinish?: number;
    abstract?: string;
    range?: string;
    chapterUid?: number;
    type?: number;
  };
}

export interface ReviewsData {
  reviews: ReviewItem[];
  totalCount: number;
  hasMore: number;
  synckey: number;
}

// API Request Params
export interface ApiRequestParams {
  api_name: string;
  skill_version?: string;
  [key: string]: unknown;
}