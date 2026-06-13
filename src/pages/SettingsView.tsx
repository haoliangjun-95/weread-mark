import { useState } from 'react';
import aboutContent from '../assets/关于微痕.md?raw';
import wdLogo from '../assets/wd.png';
import authorQr from '../assets/author.jpg';
import wechatGroupQr from '../assets/wechat-group.jpg';
import { getApiKey, setApiKey, validateApiKey } from '../services/weread';
import type { ViewType, ThemeType, FontType, FontSize, ExportStyleType } from '../App';

interface SettingsViewProps {
  theme: ThemeType;
  onThemeChange: (theme: ThemeType) => void;
  font: FontType;
  onFontChange: (font: FontType) => void;
  fontSize: FontSize;
  onFontSizeChange: (size: FontSize) => void;
  keyExpired?: boolean;
  exportStyle: ExportStyleType;
  onExportStyleChange: (style: ExportStyleType) => void;
  onNavigate: (view: ViewType) => void;
  onApiKeyChange: () => void;
}

const themes: { key: ThemeType; label: string; desc: string; icon: string; bg: string; border: string; activeBg: string; activeBorder: string; swatch: string }[] = [
  { key: 'default', label: '默认', desc: '清新蓝白', icon: '☀️', bg: '#ffffff', border: '#dfe7f0', activeBg: '#e8f1ff', activeBorder: '#2367d9', swatch: '#2367d9' },
  { key: 'dark', label: '深色', desc: '深邃暗夜', icon: '🌙', bg: '#182133', border: '#263449', activeBg: '#203a5e', activeBorder: '#5aa2ff', swatch: '#5aa2ff' },
  { key: 'eye', label: '护眼', desc: '暖茶书卷', icon: '◐', bg: '#fffaf0', border: '#e4d7ba', activeBg: '#eee5d0', activeBorder: '#736145', swatch: '#736145' },
  { key: 'green', label: '浅绿', desc: '纸页浅茵', icon: '◍', bg: '#f7fff5', border: '#cfe4d0', activeBg: '#d8eadc', activeBorder: '#4f7b62', swatch: '#4f7b62' },
  { key: 'paper', label: '纸白', desc: '清透纸页', icon: '□', bg: '#fbfaf7', border: '#dedbd3', activeBg: '#f2f0ea', activeBorder: '#70706a', swatch: '#f7f6f1' },
  { key: 'mist', label: '冷灰', desc: '薄雾纸纹', icon: '◌', bg: '#f2f5f4', border: '#d4dcdd', activeBg: '#e4ecee', activeBorder: '#587178', swatch: '#dfe9eb' },
  { key: 'apricot', label: '杏暖', desc: '落日书页', icon: '◒', bg: '#fff1df', border: '#efd0ac', activeBg: '#ffe3bd', activeBorder: '#b87530', swatch: '#f4a65f' },
  { key: 'rose', label: '月粉', desc: '柔粉月光', icon: '○', bg: '#f9e8e6', border: '#e8c8c9', activeBg: '#f3d7d8', activeBorder: '#ad6c73', swatch: '#d99a9f' },
];

const fonts: { key: FontType; label: string; preview: string }[] = [
  { key: 'wenkai', label: '霞鹜文楷', preview: 'LXGW WenKai' },
  { key: 'serif', label: '思源宋体', preview: 'Noto Serif SC' },
  { key: 'sans', label: '无衬线', preview: 'Inter' },
  { key: 'yousong', label: '方正悠宋', preview: 'FZYouSong' },
  { key: 'laosong', label: '京华老宋体', preview: 'JingHuaLaoSong' },
  { key: 'notosans', label: '思源黑体', preview: 'Noto Sans SC' },
  { key: 'mashan', label: '马山正楷', preview: 'Ma Shan Zheng' },
  { key: 'zcool', label: '站酷小薇体', preview: 'ZCOOL XiaoWei' },
];

const exportStyles: { key: ExportStyleType; label: string; desc: string; icon: string; cardBg: string; textPrimary: string; textSecondary: string; accent: string }[] = [
  { key: 'classic', label: '经典白', desc: '通用清爽', icon: '□', cardBg: '#ffffff', textPrimary: '#242424', textSecondary: '#737373', accent: '#4f5965' },
  { key: 'paper', label: '暖纸', desc: '阅读质感', icon: '◒', cardBg: '#faf3e8', textPrimary: '#4f3928', textSecondary: '#86694e', accent: '#b98547' },
  { key: 'dark', label: '深色', desc: '暗色分享', icon: '●', cardBg: '#171f2e', textPrimary: '#e8edf3', textSecondary: '#aab6c5', accent: '#70a8ff' },
];

const quotes = [
  { text: '世界上任何书籍都不能带给你好运，但是它们能让你悄悄成为你自己。', author: '赫尔曼·黑塞' },
  { text: '阅读是一座随身携带的避难所。', author: '威廉·萨默塞特·毛姆' },
  { text: '阅读是砍向我们内心冰封大海的斧头。', author: '弗兰兹·卡夫卡' },
];

const cardStyle = {
  backgroundColor: 'var(--card-bg)',
  borderColor: 'var(--card-border)',
  boxShadow: 'var(--shadow-sm)',
};

const subtlePanelStyle = {
  backgroundColor: 'color-mix(in srgb, var(--bg-secondary) 72%, var(--card-bg))',
  borderColor: 'var(--border-light)',
};

function SectionTitle({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-6 border-b pb-4" style={{ borderColor: 'var(--border-light)' }}>
      <h3 className="text-base font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
        {title}
      </h3>
      {desc && (
        <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {desc}
        </p>
      )}
    </div>
  );
}

function SelectedBadge({ color }: { color: string }) {
  return (
    <span
      aria-label="已选"
      title="已选"
      className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold"
      style={{ backgroundColor: color, color: 'var(--accent-contrast)' }}
    >
      ✓
    </span>
  );
}

export default function SettingsView({ theme, onThemeChange, font, onFontChange, fontSize, onFontSizeChange, keyExpired, exportStyle, onExportStyleChange, onNavigate, onApiKeyChange }: SettingsViewProps) {
  const [showAbout, setShowAbout] = useState(false);

  return (
    <div className="mx-auto max-w-6xl py-8 sm:py-10 lg:py-12">
      <div className="mb-8 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between" style={{ borderColor: 'var(--border-light)' }}>
        <div className="min-w-0">
          <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>个人偏好</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: 'var(--text-primary)' }}>
            设置
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            管理微信读书连接、界面主题、字体和导出图片样式。
          </p>
        </div>
        <div className="grid grid-cols-4 gap-1.5 sm:gap-2 text-center w-full sm:w-[26rem]">
          <div className="rounded-xl border px-3 py-2" style={subtlePanelStyle}>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>主题</p>
            <p className="mt-0.5 truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {themes.find(item => item.key === theme)?.label}
            </p>
          </div>
          <div className="rounded-xl border px-3 py-2" style={subtlePanelStyle}>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>字体</p>
            <p className="mt-0.5 truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {fonts.find(item => item.key === font)?.label}
            </p>
          </div>
          <div className="rounded-xl border px-3 py-2" style={subtlePanelStyle}>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>导出</p>
            <p className="mt-0.5 truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {exportStyles.find(item => item.key === exportStyle)?.label}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAbout(true)}
            className="rounded-xl border px-3 py-2 transition-all hover:-translate-y-0.5 hover:shadow-sm"
            style={subtlePanelStyle}
          >
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>关于</p>
            <p className="mt-0.5 truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              功能介绍
            </p>
          </button>
        </div>
      </div>

      {/* 移动端：API 配置置顶 */}
      <div className="lg:hidden mb-6">
        <ApiKeyCard keyExpired={keyExpired} onNavigate={onNavigate} onApiKeyChange={onApiKeyChange} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
        <aside className="space-y-5 order-2 lg:order-1 lg:sticky lg:top-24">
          {/* 桌面端：API 配置在侧栏顶部 */}
          <div className="hidden lg:block">
            <ApiKeyCard keyExpired={keyExpired} onNavigate={onNavigate} onApiKeyChange={onApiKeyChange} />
          </div>

          <section className="rounded-2xl border p-5" style={cardStyle}>
            <SectionTitle title="关于微痕" desc="让阅读留下温柔的痕迹" />
            <div className="space-y-3 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              <p>
                基于
                <a
                  href="https://github.com/Tencent/WeChatReading"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mx-1 underline decoration-dotted underline-offset-2"
                  style={{ color: 'var(--accent-color)' }}
                >
                  微信读书开放能力
                </a>
                构建，告别零散记录，一站式整合你在微信读书中的划线摘录、即时想法、原创书评，同时汇总阅读时长、阅读频次等统计信息，让所有阅读内容有序沉淀、便于回顾。
              </p>
              <div className="flex items-center gap-4 pb-4" style={{ borderColor: 'var(--border-light)' }}>
                <img src={wdLogo} alt="微信读书" className="h-14 w-auto flex-shrink-0" />
                <div>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>感谢微信读书团队让有趣的灵魂在茫茫人海中相遇！</p>
                </div>
              </div>
              <div className="border-t pt-4 mt-2" style={{ borderColor: 'var(--border-light)' }}>
                <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>扫码加作者 · 交流群</p>
                <div className="flex gap-4">
                  <div className="flex-1 text-center">
                    <img src={authorQr} alt="作者二维码" className="w-40 h-40 mx-auto rounded-xl shadow-sm object-contain" />
                    <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>作者</p>
                  </div>
                  <div className="flex-1 text-center">
                    <img src={wechatGroupQr} alt="交流群二维码" className="w-40 h-40 mx-auto rounded-xl shadow-sm object-contain" />
                    <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>交流群</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border p-5" style={cardStyle}>
            <SectionTitle title="阅读箴言" desc="书中自有黄金屋" />
            <div className="space-y-4">
              {quotes.map((q, i) => (
                <div key={i} className="border-b pb-4 last:border-b-0 last:pb-0" style={{ borderColor: 'var(--border-light)' }}>
                  <p className="text-sm leading-relaxed italic" style={{ color: 'var(--text-secondary)' }}>
                    "{q.text}"
                  </p>
                  <p className="text-xs mt-2 text-right" style={{ color: 'var(--text-muted)' }}>
                    —— {q.author}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </aside>

        <main className="space-y-6 order-1 lg:order-2">
          <section className="rounded-2xl border p-6 sm:p-7" style={cardStyle}>
            <SectionTitle title="外观设置" desc="调整界面主题和全局字体，改动会立即生效。" />

            <div className="space-y-8">
              <div>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>主题</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>当前：{themes.find(item => item.key === theme)?.label}</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                  {themes.map(t => {
                    const active = theme === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => onThemeChange(t.key)}
                        className="relative min-h-32 rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
                        style={{
                          backgroundColor: active ? t.activeBg : t.bg,
                          borderColor: active ? t.activeBorder : t.border,
                          color: active ? t.activeBorder : 'var(--text-secondary)',
                          boxShadow: active ? `0 12px 30px -20px ${t.activeBorder}` : 'none',
                        }}
                      >
                        {active && <SelectedBadge color={t.activeBorder} />}
                        <span className="flex items-center gap-3 pr-7">
                          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border text-lg" style={{ backgroundColor: t.swatch, borderColor: t.border, color: t.key === 'paper' ? '#555650' : '#fff' }}>
                            {t.icon}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-bold">{t.label}</span>
                            <span className="mt-0.5 block text-[11px] leading-relaxed" style={{ color: active ? t.activeBorder : 'var(--text-muted)' }}>
                              {t.desc}
                            </span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t pt-7" style={{ borderColor: 'var(--border-light)' }}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>字体</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>当前：{fonts.find(item => item.key === font)?.label}</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                  {fonts.map(f => {
                    const active = font === f.key;
                    return (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => onFontChange(f.key)}
                        className="relative min-h-28 rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
                        style={{
                          backgroundColor: active ? 'var(--accent-light)' : 'var(--bg-secondary)',
                          borderColor: active ? 'var(--accent-color)' : 'var(--border-light)',
                          color: active ? 'var(--accent-text)' : 'var(--text-secondary)',
                          boxShadow: active ? 'var(--shadow-md)' : 'none',
                        }}
                      >
                        {active && <SelectedBadge color="var(--accent-color)" />}
                        <span className="block pr-8 text-sm font-bold" style={{ fontFamily: f.preview }}>{f.label}</span>
                        <span className="mt-3 block text-[11px] leading-relaxed" style={{ fontFamily: f.preview, color: 'var(--text-muted)' }}>
                          读书须用意，一字值千金。
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t pt-7" style={{ borderColor: 'var(--border-light)' }}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>字号</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {fontSize === 'auto' ? '自动 · 自适应' : `${fontSize}px`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {[{ key: 'auto', label: '自动' }, { key: 'sm', label: '标准' }, { key: 'md', label: '中' }, { key: 'lg', label: '大' }, { key: 'xl', label: '超大' }].map(opt => {
                    const active = fontSize === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => onFontSizeChange(opt.key as FontSize)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                        style={{
                          backgroundColor: active ? 'var(--accent-light)' : 'var(--bg-secondary)',
                          borderColor: active ? 'var(--accent-color)' : 'var(--border-light)',
                          color: active ? 'var(--accent-text)' : 'var(--text-secondary)',
                          border: '1px solid',
                        }}
                      >{opt.label}</button>
                    );
                  })}
                  <span className="text-xs mx-1" style={{ color: 'var(--text-muted)' }}>自定义</span>
                  <input
                    type="number"
                    min={10}
                    max={20}
                    value={(() => {
                      if (typeof fontSize === 'number') return fontSize;
                      if (fontSize === 'auto') return Math.round(Math.min(16, Math.max(13, 1.6 * window.innerWidth / 100)));
                      const map: Record<string, number> = { sm: 14, md: 16, lg: 18, xl: 20 };
                      return map[fontSize] ?? 14;
                    })()}
                    onChange={e => {
                      const v = parseInt(e.target.value, 10);
                      if (v >= 10 && v <= 20) onFontSizeChange(v);
                    }}
                    className="w-14 rounded-lg border px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-2"
                    style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--input-bg)', color: 'var(--text-primary)' }}
                  />
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>px</span>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border p-6 sm:p-7" style={cardStyle}>
            <SectionTitle title="导出图片样式" desc="用于笔记导出图片，不影响应用界面主题。" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              {exportStyles.map(s => {
                const active = exportStyle === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => onExportStyleChange(s.key)}
                    className="relative min-h-36 rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
                    style={{
                      backgroundColor: s.cardBg,
                      borderColor: active ? s.accent : 'transparent',
                      boxShadow: active ? `0 0 0 3px ${s.accent}24` : 'var(--shadow-sm)',
                    }}
                  >
                    {active && <SelectedBadge color={s.accent} />}
                    <span className="flex items-center justify-between gap-2 pr-8">
                      <span className="text-2xl leading-none">{s.icon}</span>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.accent }} />
                    </span>
                    <span className="mt-4 block text-sm font-bold" style={{ color: s.textPrimary }}>{s.label}</span>
                    <span className="mt-1 block text-[11px]" style={{ color: s.textSecondary }}>{s.desc}</span>
                    <span className="mt-4 block rounded-lg border px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: `${s.accent}55`, color: s.textPrimary }}>
                      导出后的笔记卡片
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </main>
      </div>
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
    </div>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div className="max-h-[82vh] w-full max-w-3xl overflow-hidden rounded-2xl border shadow-2xl" style={cardStyle} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-4 border-b px-5 py-4" style={{ borderColor: 'var(--border-light)' }}>
          <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>关于微痕</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div className="max-h-[calc(82vh-65px)] overflow-y-auto px-5 py-4">
          <MarkdownContent content={aboutContent} />
        </div>
      </div>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split('\n');

  return (
    <div className="space-y-3 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
      {lines.map((line, index) => {
        if (!line.trim()) return <div key={index} className="h-1" />;
        if (line === '---') return <hr key={index} className="my-4 border-t" style={{ borderColor: 'var(--border-light)' }} />;
        if (line.startsWith('# ')) return <h1 key={index} className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{line.slice(2)}</h1>;
        if (line.startsWith('## ')) return <h2 key={index} className="pt-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{line.slice(3)}</h2>;
        if (line.startsWith('### ')) return <h3 key={index} className="pt-1 text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{line.slice(4)}</h3>;
        if (line.startsWith('> ')) return <blockquote key={index} className="rounded-xl border-l-4 px-4 py-2" style={{ borderColor: 'var(--accent-color)', backgroundColor: 'var(--bg-secondary)' }}>{renderInlineMarkdown(line.slice(2))}</blockquote>;
        if (line.startsWith('- ')) return <p key={index} className="pl-4">• {renderInlineMarkdown(line.slice(2))}</p>;
        if (/^\d+\.\s/.test(line)) return <p key={index} className="pl-4">{renderInlineMarkdown(line)}</p>;
        return <p key={index}>{renderInlineMarkdown(line)}</p>;
      })}
    </div>
  );
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index} style={{ color: 'var(--text-primary)' }}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="rounded px-1 py-0.5 text-xs" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>{part.slice(1, -1)}</code>;
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) return <a key={index} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2" style={{ color: 'var(--accent-color)' }}>{linkMatch[1]}</a>;
    return part;
  });
}

function ApiKeyCard({ keyExpired, onNavigate, onApiKeyChange }: { keyExpired?: boolean; onNavigate: (view: ViewType) => void; onApiKeyChange: () => void }) {
  const [value, setValue] = useState(() => getApiKey());
  const [editing, setEditing] = useState(() => !getApiKey());
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);
  const [validating, setValidating] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  const storedKey = getApiKey();
  const masked = value ? value.slice(0, 6) + '••••' + value.slice(-4) : '';
  const hasKey = !!storedKey;
  const status = keyExpired
    ? { icon: '!', label: 'Key 已失效', bg: 'var(--error-bg)', color: 'var(--error-text)' }
    : hasKey
      ? { icon: '✓', label: '已配置', bg: 'var(--success-bg)', color: 'var(--success-text)' }
      : { icon: '!', label: '未配置', bg: 'var(--warning-bg)', color: 'var(--warning-text)' };

  const handleSave = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    setValidating(true);
    setKeyError(null);
    try {
      const result = await validateApiKey(trimmed);
      if (!result.valid) {
        setKeyError(result.error || 'API Key 验证失败');
        setValidating(false);
        return;
      }
    } catch {
      setKeyError('验证请求失败，请检查网络');
      setValidating(false);
      return;
    }

    setApiKey(trimmed);
    localStorage.setItem('weread-key-was-configured', '1');
    onApiKeyChange();
    setEditing(false);
    setSaved(true);
    setValidating(false);
    setTimeout(() => setSaved(false), 1500);
    onNavigate('dashboard');
  };

  const handleClear = () => {
    setApiKey('');
    onApiKeyChange();
    setValue('');
    setEditing(true);
    setShow(false);
  };

  return (
    <section className="rounded-2xl border p-5" style={cardStyle}>
      <div className="flex items-center justify-between mb-3 pb-3 border-b" style={{ borderColor: 'var(--border-light)' }}>
        <div>
          <h3 className="text-base font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>API 配置</h3>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>连接微信读书 Skills 服务</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold flex-shrink-0" style={{ backgroundColor: status.bg, color: status.color }}>
          <span className="flex h-4 w-4 items-center justify-center rounded-full text-[10px]" style={{ backgroundColor: status.color, color: 'var(--accent-contrast)' }}>
            {status.icon}
          </span>
          {status.label}
        </div>
      </div>
      <div className="space-y-4">

        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          请前往
          <a
            href="https://weread.qq.com/r/weread-skills"
            target="_blank"
            rel="noopener noreferrer"
            className="mx-1 underline decoration-dotted underline-offset-2"
            style={{ color: 'var(--accent-color)' }}
          >
            微信读书 Skills 官网
          </a>
          获取，格式为 wrk-xxxx。Key 仅保存在当前浏览器缓存中。
        </p>

        {(keyExpired || keyError) && (
          <div className="rounded-xl border px-3 py-2 text-xs leading-relaxed" style={{ borderColor: 'var(--error-text)', backgroundColor: 'var(--error-bg)', color: 'var(--error-text)' }}>
            {keyError ? (
              keyError.split('微信读书官网').map((part, i, arr) =>
                i < arr.length - 1 ? (
                  <span key={i}>
                    {part}
                    <a
                      href="https://weread.qq.com/r/weread-skills"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                      style={{ color: 'var(--accent-color)' }}
                    >
                      微信读书官网
                    </a>
                  </span>
                ) : (
                  part
                )
              )
            ) : (
              <>
                Key 已失效，请重新从
                <a
                  href="https://weread.qq.com/r/weread-skills"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mx-1 underline decoration-dotted underline-offset-2"
                  style={{ color: 'var(--accent-color)' }}
                >
                  微信读书官网
                </a>
                获取。
              </>
            )}
          </div>
        )}

        {editing ? (
          <div className="space-y-3">
            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                value={value}
                onChange={e => { setValue(e.target.value); setKeyError(null); }}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                placeholder="wrk-xxxxxxxxxxxx"
                className="h-11 w-full rounded-xl border pl-3 pr-11 text-sm font-mono focus:outline-none focus:ring-2"
                style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--input-bg)', color: 'var(--text-primary)' }}
              />
              <button
                type="button"
                onClick={() => setShow(s => !s)}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-xs"
                style={{ color: 'var(--text-muted)' }}
                aria-label={show ? '隐藏' : '显示'}
              >
                {show ? '🙈' : '👁'}
              </button>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={!value.trim() || validating}
                className="settings-primary-button h-11 flex-1 rounded-xl px-4 text-sm font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-50"
              >
                {validating ? '验证中...' : '保存'}
              </button>
              {hasKey && (
                <button
                  type="button"
                  onClick={() => { setValue(getApiKey()); setEditing(false); setShow(false); setKeyError(null); }}
                  className="h-11 rounded-xl border px-4 text-sm transition-colors"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
                >
                  取消
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <code
              className="block w-full truncate rounded-xl border px-3 py-2 text-xs font-mono"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-light)', color: 'var(--text-secondary)' }}
            >
              {show ? value : masked}
            </code>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setShow(s => !s)}
                className="text-xs font-medium"
                style={{ color: 'var(--text-muted)' }}
              >
                {show ? '隐藏' : '显示'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-xs font-medium"
                style={{ color: 'var(--accent-color)' }}
              >
                修改
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="text-xs font-medium"
                style={{ color: 'var(--error-text)' }}
              >
                清除
              </button>
              {saved && (
                <span className="text-xs" style={{ color: 'var(--success-text)' }}>✓ 已保存</span>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}