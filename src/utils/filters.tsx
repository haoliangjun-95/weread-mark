interface FilterBarProps {
  keyword: string;
  onKeywordChange: (v: string) => void;
  category: string;
  onCategoryChange: (v: string) => void;
  categories: string[];
  filteredCount: number;
}

export function FilterBar({ keyword, onKeywordChange, category, onCategoryChange, categories, filteredCount }: FilterBarProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:gap-3 mb-5">
      <div className="relative flex-1 min-w-0">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
        <input
          type="text"
          value={keyword}
          onChange={e => onKeywordChange(e.target.value)}
          placeholder="按书名或作者搜索"
          className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <select
          value={category}
          onChange={e => onCategoryChange(e.target.value)}
          className="flex-1 sm:flex-none px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent sm:min-w-[140px]"
        >
          <option value="all">全部分类</option>
          {categories.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {(keyword || category !== 'all') && (
          <div className="flex items-center gap-2 text-sm text-gray-500 whitespace-nowrap flex-shrink-0">
            <span>共 {filteredCount} 本</span>
            <button
              onClick={() => {
                onKeywordChange('');
                onCategoryChange('all');
              }}
              className="text-blue-600 hover:text-blue-700"
            >
              清除
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
