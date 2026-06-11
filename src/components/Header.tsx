import type { ViewType } from '../App';
import logo from '../assets/logo.png';

interface HeaderProps {
    currentView: ViewType;
    onNavigate: (view: ViewType) => void;
    hasKey: boolean;
}

const navItems: { key: ViewType; label: string; icon: string }[] = [
    { key: 'home', label: '搜索', icon: '🔍' },
    { key: 'shelf', label: '书架', icon: '📚' },
    { key: 'reviews', label: '书评墙', icon: '⭐' },
    { key: 'dashboard', label: '看板', icon: '📊' },
    { key: 'notes', label: '笔记', icon: '📝' },
    { key: 'settings', label: '设置', icon: '⚙️' },
];

export default function Header({ currentView, onNavigate, hasKey }: HeaderProps) {
    return (
        <header className="sticky top-0 z-50 backdrop-blur-md" style={{
            backgroundColor: 'var(--header-bg)',
            boxShadow: 'var(--shadow-sm)',
        }}>
            <div className="max-w-6xl mx-auto px-3 sm:px-4 lg:px-6 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <div className="flex items-center justify-between gap-2 h-14 sm:h-16">
                    <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
                        <img src={logo} alt="微痕" className="h-7 sm:h-8 w-auto flex-shrink-0" />
                        <h1 className="text-sm sm:text-xl font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                            微痕
                        </h1>
                        <span className="hidden sm:inline-flex text-[10px] px-1.5 py-0.5 rounded-full font-mono flex-shrink-0" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
              v{__APP_VERSION__}
            </span>
                    </div>
                    <div className="flex items-center gap-1">
                        <nav className="hidden md:flex gap-1 flex-shrink-0">
                            {navItems.map((item) => {
                                const disabled = !hasKey && item.key !== 'settings';
                                return (
                                    <button
                                        key={item.key}
                                        onClick={() => onNavigate(item.key)}
                                        disabled={disabled}
                                        title={disabled ? '请先在设置页配置 API Key' : item.label}
                                        className="px-3 lg:px-4 py-2 rounded-xl text-sm font-medium transition-all"
                                        style={{
                                            backgroundColor: currentView === item.key ? 'var(--accent-color)' : 'transparent',
                                            color: currentView === item.key ? 'var(--accent-contrast)' : disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
                                            boxShadow: currentView === item.key ? 'var(--shadow-sm)' : 'none',
                                            cursor: disabled ? 'not-allowed' : 'pointer',
                                            opacity: disabled ? 'var(--disabled-opacity)' : '1',
                                        }}
                                    >
                                        <span className="mr-1.5">{item.icon}</span>
                                        {item.label}
                                    </button>
                                );
                            })}
                        </nav>
                        <nav className="md:hidden flex gap-0.5 overflow-x-auto flex-shrink-0">
                            {navItems.map((item) => {
                                const disabled = !hasKey && item.key !== 'settings';
                                return (
                                    <button
                                        key={item.key}
                                        onClick={() => onNavigate(item.key)}
                                        disabled={disabled}
                                        aria-label={item.label}
                                        title={disabled ? '请先在设置页配置 API Key' : item.label}
                                        className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-all"
                                        style={{
                                            backgroundColor: currentView === item.key ? 'var(--accent-color)' : 'transparent',
                                            color: currentView === item.key ? 'var(--accent-contrast)' : disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
                                            boxShadow: currentView === item.key ? 'var(--shadow-sm)' : 'none',
                                            cursor: disabled ? 'not-allowed' : 'pointer',
                                            opacity: disabled ? 'var(--disabled-opacity)' : '1',
                                        }}
                                    >
                                        {item.icon}
                                    </button>
                                );
                            })}
                        </nav>
                    </div>
                </div>
            </div>
        </header>
    );
}