interface SkeletonCardProps {
  /** 标题行数量，默认按卡片高度自适应 */
  lines?: number;
  /** 是否显示头图/封面占位 */
  cover?: boolean;
}

/** 列表加载骨架屏：替代纯文字 loading，降低等待焦虑 */
export function SkeletonCard({ lines = 2, cover = false }: SkeletonCardProps) {
  return (
    <div
      className="rounded-2xl border p-4 sm:p-5"
      style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
      aria-hidden="true"
    >
      <div className="flex items-start gap-4">
        {cover && (
          <div
            className="w-[72px] h-[100px] rounded-lg flex-shrink-0 animate-pulse"
            style={{ backgroundColor: 'var(--bg-tertiary)' }}
          />
        )}
        <div className="flex-1 space-y-2.5">
          {Array.from({ length: lines }).map((_, i) => (
            <div
              key={i}
              className="h-4 rounded animate-pulse"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                width: i === 0 ? '70%' : i === lines - 1 ? '45%' : '90%',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 8, cover = false }: { count?: number; cover?: boolean }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} cover={cover} lines={3} />
      ))}
    </div>
  );
}
