import { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import Dashboard from './pages/Dashboard';
import ShelfView from './pages/ShelfView';
import NotesView from './pages/NotesView';
import ReviewsView from './pages/ReviewsView';
import SearchView from './pages/SearchView';
import SettingsView from './pages/SettingsView';
import Toaster from './components/Toast';
import { getApiKey } from './services/weread';
import type { BookItem } from './types/weread';

 export type ViewType = 'home' | 'dashboard' | 'shelf' | 'notes' | 'reviews' | 'settings';
 export type ThemeType = 'default' | 'dark' | 'eye' | 'green' | 'paper' | 'mist' | 'apricot' | 'rose';
 export type FontType = 'sans' | 'serif' | 'wenkai' | 'yousong' | 'laosong' | 'notosans' | 'mashan' | 'zcool';
 export type FontSize = 'auto' | 'sm' | 'md' | 'lg' | 'xl' | number;
 export type ExportStyleType = 'classic' | 'paper' | 'dark';

export interface HighlightTarget {
  type: 'highlight' | 'thought' | 'review-tab';
  id?: string;
  keyword?: string;
}

const STORAGE_KEY = 'weread-current-view';
const THEME_KEY = 'weread-theme';
const FONT_KEY = 'weread-font';
const FONT_SIZE_KEY = 'weread-font-size';
const FONT_SIZE_PRESETS = { sm: 14, md: 16, lg: 18, xl: 20 } as const;
const VALID_VIEWS: ViewType[] = ['home', 'dashboard', 'shelf', 'notes', 'reviews', 'settings'];
const VALID_THEMES: ThemeType[] = ['default', 'dark', 'eye', 'green', 'paper', 'mist', 'apricot', 'rose'];
const VALID_FONTS: FontType[] = ['sans', 'serif', 'wenkai', 'yousong', 'laosong', 'notosans', 'mashan', 'zcool'];
const VERSION_KEY = 'weread-app-version';

function App() {
  // 版本更新检测：检测到新版本时提示用户手动刷新，避免打断进行中的操作
  const [updateAvailable, setUpdateAvailable] = useState(() => {
    const stored = localStorage.getItem(VERSION_KEY);
    return !!stored && stored !== __APP_VERSION__;
  });
  useEffect(() => {
    if (!updateAvailable) {
      localStorage.setItem(VERSION_KEY, __APP_VERSION__);
    }
  }, [updateAvailable]);
  const [currentView, setCurrentView] = useState<ViewType>(() => {
    // URL hash 优先于 localStorage，支持刷新/分享链接直达对应视图
    const fromHash = location.hash.replace(/^#\/?/, '') as ViewType | null;
    if (!getApiKey()) return 'settings';
    if (fromHash && VALID_VIEWS.includes(fromHash)) return fromHash;
    const saved = localStorage.getItem(STORAGE_KEY) as ViewType | null;
    return saved && VALID_VIEWS.includes(saved) ? saved : 'dashboard';
  });
  const [theme, setTheme] = useState<ThemeType>(() => {
    const saved = localStorage.getItem(THEME_KEY) as ThemeType | null;
    return saved && VALID_THEMES.includes(saved) ? saved : 'default';
  });
   const [font, setFont] = useState<FontType>(() => {
     const saved = localStorage.getItem(FONT_KEY);
     return saved && VALID_FONTS.includes(saved as FontType) ? saved as FontType : 'wenkai';
   });
   const [fontSize, setFontSize] = useState<FontSize>(() => {
     const saved = localStorage.getItem(FONT_SIZE_KEY);
     if (!saved) return 'auto';
     if (saved === 'auto') return 'auto';
     const n = parseInt(saved, 10);
     return n >= 10 && n <= 20 ? n : 'auto';
   });
   const [exportStyle, setExportStyle] = useState<ExportStyleType>(() => {
     const saved = localStorage.getItem('weread-export-style');
     const VALID_EXPORT_STYLES: ExportStyleType[] = ['classic', 'paper', 'dark'];
     return saved && VALID_EXPORT_STYLES.includes(saved as ExportStyleType) ? saved as ExportStyleType : 'classic';
   });
  const [selectedBook, setSelectedBook] = useState<BookItem | null>(null);
  const [notesBackLabel, setNotesBackLabel] = useState('返回笔记列表');
  const [notesSource, setNotesSource] = useState<ViewType | null>(null);
  const [highlightTarget, setHighlightTarget] = useState<HighlightTarget | null>(null);
  const [keyExpired, setKeyExpired] = useState(() => !getApiKey() && !!localStorage.getItem('weread-key-was-configured'));
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, currentView);
    // 视图同步到 hash，浏览器前进/后退可在视图间导航
    const target = `#/${currentView}`;
    if (location.hash !== target) {
      history.pushState(null, '', target);
    }
  }, [currentView]);

  useEffect(() => {
    const onPopState = () => {
      const fromHash = location.hash.replace(/^#\/?/, '') as ViewType | null;
      if (fromHash && VALID_VIEWS.includes(fromHash)) {
        setCurrentView(fromHash);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.className = `theme-${theme}`;
  }, [theme]);

   useEffect(() => {
     localStorage.setItem(FONT_KEY, font);
     document.body.classList.remove(...VALID_FONTS.map(item => `font-${item}`));
     if (font !== 'sans') {
       document.body.classList.add(`font-${font}`);
     }
   }, [font]);

   useEffect(() => {
     localStorage.setItem(FONT_SIZE_KEY, String(fontSize));
     const val = fontSize === 'auto' ? 'clamp(13px, 1.6vw, 16px)'
       : typeof fontSize === 'string' ? `${FONT_SIZE_PRESETS[fontSize as keyof typeof FONT_SIZE_PRESETS]}px`
       : `${fontSize}px`;
     document.documentElement.style.setProperty('--font-size-base', val);
   }, [fontSize]);

   useEffect(() => {
     localStorage.setItem('weread-export-style', exportStyle);
   }, [exportStyle]);

  const [hasKey, setHasKey] = useState(() => !!getApiKey());
  const syncApiKeyState = useCallback(() => {
    const nextHasKey = !!getApiKey();
    setHasKey(nextHasKey);
    if (nextHasKey) {
      setKeyExpired(false);
      return;
    }

    const wasConfigured = localStorage.getItem('weread-key-was-configured');
    setKeyExpired(!!wasConfigured);
    if (currentView !== 'settings') {
      setCurrentView('settings');
    }
  }, [currentView]);

  useEffect(() => {
    window.addEventListener('storage', syncApiKeyState);
    const id = setInterval(syncApiKeyState, 1000);
    return () => {
      window.removeEventListener('storage', syncApiKeyState);
      clearInterval(id);
    };
  }, [syncApiKeyState]);

  const handleSelectBook = (book: BookItem, target?: HighlightTarget) => {
    setSelectedBook(book);
    setHighlightTarget(target || null);
    const backLabels: Record<string, string> = { shelf: '返回书架列表', home: '返回搜索结果' };
    setNotesBackLabel(backLabels[currentView] || '返回笔记列表');
    setNotesSource(currentView === 'notes' ? null : currentView);
    setCurrentView('notes');
  };

  const handleNavigate = (view: ViewType) => {
    if (view === 'notes') {
      setSelectedBook(null);
      setHighlightTarget(null);
    }
    setCurrentView(view);
  };

  const views = [
    { key: 'home' as ViewType, element: <SearchView onSelectBook={handleSelectBook} /> },
    { key: 'dashboard' as ViewType, element: <Dashboard hasKey={hasKey} /> },
    { key: 'shelf' as ViewType, element: <ShelfView onSelectBook={handleSelectBook} /> },
    { key: 'notes' as ViewType, element: <NotesView selectedBook={selectedBook} onBack={() => { setSelectedBook(null); setNotesBackLabel('返回笔记列表'); if (notesSource) { setCurrentView(notesSource); setNotesSource(null); } }} onSelectBook={handleSelectBook} highlightTarget={highlightTarget} exportStyle={exportStyle} backLabel={notesBackLabel} /> },
    { key: 'reviews' as ViewType, element: <ReviewsView /> },
    { key: 'settings' as ViewType, element: <SettingsView theme={theme} onThemeChange={setTheme} font={font} onFontChange={setFont} fontSize={fontSize} onFontSizeChange={setFontSize} keyExpired={keyExpired} exportStyle={exportStyle} onExportStyleChange={setExportStyle} onNavigate={handleNavigate} onApiKeyChange={syncApiKeyState} /> },
  ];

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <Header currentView={currentView} onNavigate={handleNavigate} hasKey={hasKey} />
      <main className="flex-1 max-w-6xl w-full mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 lg:py-8">
        {views.map(({ key, element }) => {
          // 设置页始终挂载;其余视图依赖 API Key。未配置 Key 时不挂载它们,
          // 否则初次渲染就会发起请求并缓存"请先设置 Key"的错误状态,
          // 导致 Key 配置后切到这些 tab 仍显示陈旧报错。
          if (key !== 'settings' && !hasKey) return null;
          return (
            <div key={key} style={{ display: currentView === key ? 'block' : 'none' }}>
              {element}
            </div>
          );
        })}
      </main>
      <Footer />
      <Toaster />
      {updateAvailable && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[99999] px-4 py-3 rounded-xl shadow-lg border flex items-center gap-3 text-sm"
          style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}>
          <span>发现新版本</span>
          <button
            onClick={() => window.location.reload()}
            className="px-3 py-1 rounded-lg text-white font-medium"
            style={{ backgroundColor: 'var(--accent-color)' }}
          >
            刷新页面
          </button>
          <button
            onClick={() => setUpdateAvailable(false)}
            className="text-xs"
            style={{ color: 'var(--text-muted)' }}
            aria-label="关闭更新提示"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
