import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { fetchShelf, fetchReadingStats, fetchAllNotebooks } from '../services/weread';

interface ChartData {
  monthlyTrend: { month: string; time: number }[];
  yearlyTrend: { year: string; time: number }[];
  dailyTrend: { date: string; time: number }[];
  authorData: { name: string; count: number; readTime: string }[];
  categoryData: { name: string; value: number; readingCount: number }[];
  timeDist: { hour: number; time: number }[];
  readLongest: { name: string; time: number }[];
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}小时${minutes > 0 ? minutes + '分钟' : ''}`;
  }
  return `${minutes}分钟`;
}

function getDayAverageReadTime(totalSeconds: number, days: number): number {
  if (days <= 0) return 0;
  return totalSeconds / days;
}

type TimeMode = 'weekly' | 'monthly' | 'annually' | 'overall';

interface DashboardProps {
  hasKey: boolean;
}

export default function Dashboard({ hasKey }: DashboardProps) {
  const [finishedCount, setFinishedCount] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  const [readDays, setReadDays] = useState(0);
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedYearMonthlyTrend, setSelectedYearMonthlyTrend] = useState<{ month: string; time: number }[]>([]);
  const [last7DaysTrend, setLast7DaysTrend] = useState<{ date: string; time: number }[]>([]);
  const [last30DaysTrend, setLast30DaysTrend] = useState<{ date: string; time: number }[]>([]);
  const [thisMonthTrend, setThisMonthTrend] = useState<{ date: string; time: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeMode, setTimeMode] = useState<TimeMode>('annually');
  const [timeDistDataSource, setTimeDistDataSource] = useState<'current' | 'overall' | 'none'>('none');
  const chartTheme = {
    grid: 'var(--chart-grid)',
    line: 'var(--chart-line)',
    bar: 'var(--chart-bar)',
    barAlt: 'var(--chart-bar-alt)',
    barMuted: 'var(--chart-bar-muted)',
    text: 'var(--text-muted)',
  };
  const tooltipStyle = {
    borderRadius: '12px',
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--tooltip-bg)',
    color: 'var(--text-primary)',
    boxShadow: 'var(--shadow-md)',
  };

  const loadData = useCallback(async () => {
    if (!hasKey) {
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Fetch recent 2 months of data for daily trend
      const now = new Date();
      const monthPromises: Promise<{ readTimes: Record<string, number> }>[] = [];
      for (let i = 0; i < 2; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const baseTime = d.getTime() / 1000;
        monthPromises.push(
          fetchReadingStats('monthly', baseTime).then(res => ({ readTimes: res.readTimes || {} }))
        );
      }

       // 获取当前统计数据
       let currentStatsPromise;
       if (timeMode === 'annually') {
         // 对于年份模式，使用选中的年份
         const baseTime = new Date(selectedYear, 0, 1).getTime() / 1000;
         currentStatsPromise = fetchReadingStats('annually', baseTime);
       } else {
         currentStatsPromise = fetchReadingStats(timeMode);
       }

       const [shelfData, currentStats, annuallyStats, overallStats, notebooksData, ...monthResults] = await Promise.all([
         fetchShelf(),
         currentStatsPromise,
         fetchReadingStats('annually'),
         timeMode === 'overall' ? Promise.resolve(null) : fetchReadingStats('overall').catch(() => null),
         timeMode === 'overall' ? fetchAllNotebooks().catch(() => null) : Promise.resolve(null),
         ...monthPromises,
       ]);

      // Merge recent months' readTimes for daily trend
      const recentReadTimes: Record<string, number> = {};
      const monthData = monthResults.slice(-2);
      monthData.forEach(res => {
        if (res.readTimes) {
          Object.entries(res.readTimes).forEach(([k, v]) => {
            recentReadTimes[k] = (recentReadTimes[k] || 0) + Number(v);
          });
        }
      });

      const finishedBooks = (shelfData.books || []).filter(b => b.finishReading === 1).length;
      const finishedAlbums = (shelfData.albums || [])
        .filter(a => a?.albumInfo?.finish === 1).length;
      const shelfFinished = finishedBooks + finishedAlbums;

       let finishedFromStat = 0;
       const finishStatItem = (currentStats.readStat || []).find(item => item.stat === '读完');
       if (finishStatItem?.counts) {
         const match = String(finishStatItem.counts).match(/\d+/);
         if (match) finishedFromStat = parseInt(match[0], 10);
       }

       // overall 模式：与「书架 → 已读完」完全一致，使用 notebooks 中 markedStatus === 4 且有 book 的数量
       // 其它周期（weekly/monthly/annually）：使用 readStat 中「读完」的周期统计值
       let finalFinished: number;
       if (timeMode === 'overall' && notebooksData) {
         finalFinished = (notebooksData.books || [])
           .filter(item => item.markedStatus === 4 && item.book).length;
       } else {
         finalFinished = Math.max(shelfFinished, finishedFromStat);
       }

       setFinishedCount(finalFinished);
       setTotalTime(currentStats.totalReadTime || 0);
       setReadDays(currentStats.readDays || 0);

       // 如果是年份模式，获取该年的月度数据
       if (timeMode === 'annually') {
         const monthlyTrendPromises: Promise<{ month: string; time: number }>[] = [];
         for (let m = 0; m < 12; m++) {
           const baseTime = new Date(selectedYear, m, 1).getTime() / 1000;
           monthlyTrendPromises.push(
             fetchReadingStats('monthly', baseTime).then(data => ({
               month: `${selectedYear}-${String(m + 1).padStart(2, '0')}`,
               time: Math.round((data.totalReadTime || 0) / 3600),
             })).catch(() => ({
               month: `${selectedYear}-${String(m + 1).padStart(2, '0')}`,
               time: 0,
             }))
           );
         }
         const monthlyTrendData = await Promise.all(monthlyTrendPromises);
         // 只保留有数据的月份
         const filteredMonthlyTrend = monthlyTrendData.filter(d => d.time > 0);
         setSelectedYearMonthlyTrend(filteredMonthlyTrend);
       } else {
         setSelectedYearMonthlyTrend([]);
       }

      const chart: ChartData = {
        monthlyTrend: [],
        yearlyTrend: [],
        dailyTrend: [],
        authorData: [],
        categoryData: [],
        timeDist: [],
        readLongest: [],
      };

       // Yearly trend: fetch data for years 2020 to current year
       const currentYear = new Date().getFullYear();
       const yearPromises: Promise<{ year: number; totalReadTime: number }>[] = [];
       for (let y = Math.max(2020, currentYear - 10); y <= currentYear; y++) {
         const baseTime = new Date(y, 0, 1).getTime() / 1000;
         yearPromises.push(
           fetchReadingStats('annually', baseTime).then(d => ({
             year: y,
             totalReadTime: d.totalReadTime || 0,
           })).catch(() => ({
             year: y,
             totalReadTime: 0,
           }))
         );
       }

       const yearData = await Promise.all(yearPromises);

       // 设置可用年份列表
       let yearsWithData = yearData
         .filter(s => s.totalReadTime > 0)
         .map(s => s.year);
       
       // 如果没有可用年份，添加当前年份
       if (yearsWithData.length === 0) {
         yearsWithData = [currentYear];
         setSelectedYear(currentYear);
       } else if (!yearsWithData.includes(selectedYear)) {
         // 如果当前选中的年份不在可用列表中，选中最新的年份
         setSelectedYear(Math.max(...yearsWithData));
       }
       
       setAvailableYears(yearsWithData);

       chart.yearlyTrend = yearData
         .filter(s => s.totalReadTime > 0)
         .map(s => ({
           year: `${s.year}`,
           time: Math.round(s.totalReadTime / 3600),
         }));

	      // Monthly trend: last 6 months (Dec 2025 to May 2026)
	      const monthTrendPromises: Promise<{ month: string; time: number }>[] = [];
	      for (let i = 5; i >= 0; i--) {
	        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
	        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	        const baseTime = Math.floor(d.getTime() / 1000);
	        monthTrendPromises.push(
	          fetchReadingStats('monthly', baseTime).then(data => ({
	            month: monthKey,
	            time: Math.round((data.totalReadTime || 0) / 3600),
	          })).catch(() => ({
	            month: monthKey,
	            time: 0,
	          }))
	        );
	      }
	      chart.monthlyTrend = await Promise.all(monthTrendPromises);

       // Daily trend data preparation
       const dailySource = Object.keys(recentReadTimes).length > 0 ? recentReadTimes : (annuallyStats.readTimes || {});
       if (Object.keys(dailySource).length > 0) {
         // 最近30天数据
         const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
         const thirtyDaysAgoSec = Math.floor(thirtyDaysAgo.getTime() / 1000);

         // Pre-fill all dates in the last 30 days with 0
         const thirtyDateKeys: string[] = [];
         for (let i = 0; i < 30; i++) {
           const d = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
           const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
           thirtyDateKeys.push(dateKey);
         }

         const thirtyDailyMap: Record<string, number> = {};
         thirtyDateKeys.forEach(key => { thirtyDailyMap[key] = 0; });

         Object.entries(dailySource)
           .filter(([timestamp]) => Number(timestamp) >= thirtyDaysAgoSec)
           .forEach(([timestamp, secs]) => {
             const date = new Date(Number(timestamp) * 1000);
             const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
             if (dateKey in thirtyDailyMap) {
               thirtyDailyMap[dateKey] = thirtyDailyMap[dateKey] + Number(secs);
             }
           });

          const thirtyDaysTrendData = thirtyDateKeys.map(dateKey => ({
            date: dateKey,
            time: Math.round(thirtyDailyMap[dateKey] / (timeMode === 'weekly' ? 60 : 3600))
          }));
          setLast30DaysTrend(thirtyDaysTrendData);

         // 最近7天数据
         const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
         const sevenDaysAgoSec = Math.floor(sevenDaysAgo.getTime() / 1000);

         // Pre-fill all dates in the last 7 days with 0
         const sevenDateKeys: string[] = [];
         for (let i = 0; i < 7; i++) {
           const d = new Date(sevenDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
           const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
           sevenDateKeys.push(dateKey);
         }

         const sevenDailyMap: Record<string, number> = {};
         sevenDateKeys.forEach(key => { sevenDailyMap[key] = 0; });

         Object.entries(dailySource)
           .filter(([timestamp]) => Number(timestamp) >= sevenDaysAgoSec)
           .forEach(([timestamp, secs]) => {
             const date = new Date(Number(timestamp) * 1000);
             const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
             if (dateKey in sevenDailyMap) {
               sevenDailyMap[dateKey] = sevenDailyMap[dateKey] + Number(secs);
             }
           });

          const sevenDaysTrendData = sevenDateKeys.map(dateKey => ({ 
            date: dateKey, 
            time: Math.round(sevenDailyMap[dateKey] / (timeMode === 'weekly' ? 60 : 3600)) 
          }));
          setLast7DaysTrend(sevenDaysTrendData);

         // 用于图表的默认数据
         chart.dailyTrend = thirtyDaysTrendData;

         // 本月数据
         const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
         const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
         const thisMonthStartSec = Math.floor(thisMonthStart.getTime() / 1000);

         // Pre-fill all dates in this month with 0
         const thisMonthDateKeys: string[] = [];
         const daysInMonth = thisMonthEnd.getDate();
         for (let i = 1; i <= daysInMonth; i++) {
           const d = new Date(now.getFullYear(), now.getMonth(), i);
           const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
           thisMonthDateKeys.push(dateKey);
         }

         const thisMonthDailyMap: Record<string, number> = {};
         thisMonthDateKeys.forEach(key => { thisMonthDailyMap[key] = 0; });

         Object.entries(dailySource)
           .filter(([timestamp]) => Number(timestamp) >= thisMonthStartSec)
           .forEach(([timestamp, secs]) => {
             const date = new Date(Number(timestamp) * 1000);
             const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
             if (dateKey in thisMonthDailyMap) {
               thisMonthDailyMap[dateKey] = thisMonthDailyMap[dateKey] + Number(secs);
             }
           });

         const thisMonthTrendData = thisMonthDateKeys.map(dateKey => ({ 
           date: dateKey, 
           time: Math.round(thisMonthDailyMap[dateKey] / 60) 
         }));
         setThisMonthTrend(thisMonthTrendData);
       }

         // Category data (for list display)
         if (currentStats.preferCategory) {
           chart.categoryData = currentStats.preferCategory
             .slice(0, 8)
             .filter(cat => (cat.readingCount || 0) > 0 && (cat.readingTime || 0) > 0) // 过滤掉0本或0小时
             .map(cat => ({
               name: cat.categoryTitle,
               value: cat.readingTime || 0,
               readingCount: cat.readingCount || 0,
             }));
         }

         // 阅读时段分布数据
         // 数据源优先级：
         // 1. 当前筛选条件的数据（本周/本月/选中年份/总计的 preferTime）
         //    - 年份模式：使用当前选中年份的数据
         // 2. 降级：使用总计数据（overallStats.preferTime）
         if (currentStats.preferTime && currentStats.preferTime.length > 0) {
           chart.timeDist = currentStats.preferTime.map((val, idx) => ({
             hour: (idx + 6) % 24,
             time: Math.round(val / 3600), // 总是按小时统计
           }));
           setTimeDistDataSource('current');
         } else if (overallStats?.preferTime && overallStats.preferTime.length > 0) {
           chart.timeDist = overallStats.preferTime.map((val, idx) => ({
             hour: (idx + 6) % 24,
             time: Math.round(val / 3600), // 总是按小时统计
           }));
           setTimeDistDataSource('overall');
         } else {
           setTimeDistDataSource('none');
         }

       // Read longest
       if (currentStats.readLongest) {
         chart.readLongest = currentStats.readLongest
           .slice(0, 10)
           .filter(item => (item.readTime || 0) > 0) // 过滤掉0阅读时长
           .map(item => ({
             name: item.book?.title || item.albumInfo?.name || '未知',
             time: item.readTime || 0,
           }));
       }

       // Author preferences
       if (currentStats.preferAuthor) {
         chart.authorData = currentStats.preferAuthor
           .slice(0, 4)
           .filter(author => (author.count || 0) > 0) // 过滤掉0本书
           .map(author => ({
             name: author.name,
             count: author.count,
             readTime: author.readTime || '',
           }));
       }

      setChartData(chart);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载数据失败');
      setLoading(false);
    }
  }, [timeMode, selectedYear, hasKey]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      loadData();
    }, 0);
    return () => window.clearTimeout(id);
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-10 h-10 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin"></div>
        <div className="text-gray-500 text-sm">加载数据中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-500 mb-4">{error}</p>
        <button
          onClick={loadData}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          重试
        </button>
      </div>
    );
  }

  const cards = [
    { icon: '📚', label: '读完数量', value: `${finishedCount} 本`, accent: 'from-green-50 to-emerald-100/50', iconBg: 'bg-green-100 text-green-600' },
    { icon: '⏱', label: '总阅读时长', value: formatTime(totalTime), accent: 'from-blue-50 to-indigo-100/50', iconBg: 'bg-blue-100 text-blue-600' },
    { icon: '📊', label: '日均阅读', value: formatTime(getDayAverageReadTime(totalTime, readDays)), accent: 'from-purple-50 to-violet-100/50', iconBg: 'bg-purple-100 text-purple-600' },
  ];

  return (
    <>
       {/* Header */}
       <div className="mb-6 sm:mb-8">
         <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
           <div>
             <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
               {timeMode === 'weekly' ? '本周阅读看板' :
                timeMode === 'monthly' ? '本月阅读看板' :
                timeMode === 'annually' ? `${selectedYear}年阅读看板` : '总计阅读看板'}
             </h2>
             <p className="text-sm text-gray-500 mt-1">一站式查看你的阅读数据</p>
           </div>
           <div className="flex gap-2 items-center overflow-x-auto -mx-3 px-3 md:mx-0 md:px-0">
             <div className="flex gap-1 sm:gap-2 bg-gray-100 p-1 rounded-xl flex-shrink-0">
               {(['weekly', 'monthly'] as const).map((mode) => (
                 <button
                   key={mode}
                   onClick={() => setTimeMode(mode)}
                   className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all duration-200 whitespace-nowrap ${
                     timeMode === mode
                       ? 'bg-white text-blue-600 shadow-sm'
                       : 'text-gray-600 hover:text-gray-900'
                   }`}
                 >
                   {mode === 'weekly' ? '本周' : '本月'}
                 </button>
               ))}

               {timeMode !== 'annually' ? (
                 <button
                   onClick={() => setTimeMode('annually')}
                   className="px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium text-gray-600 hover:text-gray-900 transition-all duration-200 whitespace-nowrap"
                 >
                   年份
                 </button>
               ) : (
                 availableYears.length > 0 && (
                   <select
                     value={selectedYear}
                     onChange={(e) => setSelectedYear(Number(e.target.value))}
                     className="px-2 sm:px-3 py-2 border border-gray-300 rounded-lg bg-white text-xs sm:text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[88px] sm:min-w-[100px]"
                   >
                     {availableYears.map(year => (
                       <option key={year} value={year}>
                         {year}年
                       </option>
                     ))}
                   </select>
                 )
               )}

               <button
                 onClick={() => setTimeMode('overall')}
                 className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all duration-200 whitespace-nowrap ${
                   timeMode === 'overall'
                     ? 'bg-white text-blue-600 shadow-sm'
                     : 'text-gray-600 hover:text-gray-900'
                 }`}
               >
                 总计
               </button>
             </div>
           </div>
         </div>
       </div>

      <div>
       {/* Stat Cards */}
       <div className="grid grid-cols-3 gap-1.5 sm:gap-5 mb-6 sm:mb-8">
         {cards.map((card, idx) => (
           <div
             key={idx}
             className={`h-full bg-gradient-to-br ${card.accent} rounded-xl sm:rounded-2xl border p-2 sm:p-6 shadow-sm hover:shadow-md transition-all duration-200`}
           >
             <div className="flex items-center justify-center sm:justify-between gap-1 sm:gap-0 mb-0.5 sm:mb-3">
               <p className="text-[10px] sm:text-sm text-gray-500 truncate">{card.label}</p>
               <span className={`w-5 h-5 sm:w-8 sm:h-8 rounded-md sm:rounded-lg flex items-center justify-center text-[10px] sm:text-sm flex-shrink-0 ${card.iconBg}`}>
                 {card.icon}
               </span>
             </div>
             <p className="text-xs sm:text-2xl font-bold text-gray-900 text-center sm:text-left truncate">{card.value}</p>
           </div>
         ))}
       </div>

       {/* Charts */}
       {chartData && (
         <div className="space-y-6 sm:space-y-8">
            {/* 最近30天阅读趋势 (年份和总计模式) */}
            {((timeMode === 'annually' || timeMode === 'overall') && last30DaysTrend.length > 0) && (
              <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4 sm:mb-6">
                  <span className="text-xl">📉</span>
                  <h3 className="text-lg font-semibold text-gray-900">最近30天阅读趋势</h3>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={last30DaysTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: chartTheme.text }} axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} />
                    <YAxis tick={{ fontSize: 12, fill: chartTheme.text }} axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} label={{ value: '小时', position: 'insideLeft', angle: -90, fill: chartTheme.text }} />
                    <Tooltip
                      formatter={(value) => `${value}小时`}
                      labelFormatter={() => '阅读时长'}
                      contentStyle={tooltipStyle}
                    />
                    <Line type="monotone" dataKey="time" stroke={chartTheme.line} strokeWidth={2} dot={{ r: 3, fill: chartTheme.line, stroke: chartTheme.line }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* 最近7天阅读趋势 (仅在本周模式) */}
            {timeMode === 'weekly' && last7DaysTrend.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4 sm:mb-6">
                  <span className="text-xl">📉</span>
                  <h3 className="text-lg font-semibold text-gray-900">最近7天阅读趋势</h3>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={last7DaysTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: chartTheme.text }} axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} />
                    <YAxis tick={{ fontSize: 12, fill: chartTheme.text }} axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} label={{ value: '分钟', position: 'insideLeft', angle: -90, fill: chartTheme.text }} />
                    <Tooltip
                      formatter={(value) => `${value}分钟`}
                      labelFormatter={() => '阅读时长'}
                      contentStyle={tooltipStyle}
                    />
                    <Line type="monotone" dataKey="time" stroke={chartTheme.line} strokeWidth={2} dot={{ r: 3, fill: chartTheme.line, stroke: chartTheme.line }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* 本月阅读趋势 (仅在本月模式) */}
            {timeMode === 'monthly' && thisMonthTrend.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4 sm:mb-6">
                  <span className="text-xl">📉</span>
                  <h3 className="text-lg font-semibold text-gray-900">本月阅读趋势</h3>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={thisMonthTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: chartTheme.text }} axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} />
                    <YAxis tick={{ fontSize: 12, fill: chartTheme.text }} axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} label={{ value: '小时', position: 'insideLeft', angle: -90, fill: chartTheme.text }} />
                    <Tooltip
                      formatter={(value) => `${value}小时`}
                      labelFormatter={() => '阅读时长'}
                      contentStyle={tooltipStyle}
                    />
                    <Line type="monotone" dataKey="time" stroke={chartTheme.line} strokeWidth={2} dot={{ r: 3, fill: chartTheme.line, stroke: chartTheme.line }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

           {/* 年度阅读趋势 (仅在总计模式) */}
           {timeMode === 'overall' && chartData.yearlyTrend.length > 0 && (
             <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-6 shadow-sm">
               <div className="flex items-center gap-2 mb-4 sm:mb-6">
                 <span className="text-xl">📈</span>
                 <h3 className="text-lg font-semibold text-gray-900">年度阅读趋势</h3>
               </div>
               <ResponsiveContainer width="100%" height={300}>
                 <BarChart data={chartData.yearlyTrend}>
                   <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                   <XAxis dataKey="year" tick={{ fontSize: 12, fill: chartTheme.text }} axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} />
                   <YAxis tick={{ fontSize: 12, fill: chartTheme.text }} axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} label={{ value: '小时', position: 'insideLeft', angle: -90, fill: chartTheme.text }} />
                   <Tooltip
                     formatter={(value) => `${value}小时`}
                     contentStyle={tooltipStyle}
                   />
                   <Bar dataKey="time" fill={chartTheme.barAlt} radius={[8, 8, 0, 0]} />
                 </BarChart>
               </ResponsiveContainer>
             </div>
           )}

           {/* 选中年份的月度阅读趋势 (仅在年份模式显示) */}
           {timeMode === 'annually' && selectedYearMonthlyTrend.length > 0 && (
             <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-6 shadow-sm">
               <div className="flex items-center gap-2 mb-4 sm:mb-6">
                 <span className="text-xl">📈</span>
                 <h3 className="text-lg font-semibold text-gray-900">{selectedYear}年月度阅读趋势</h3>
               </div>
               <ResponsiveContainer width="100%" height={300}>
                 <BarChart data={selectedYearMonthlyTrend}>
                   <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                   <XAxis dataKey="month" tick={{ fontSize: 12, fill: chartTheme.text }} axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} />
                   <YAxis tick={{ fontSize: 12, fill: chartTheme.text }} axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} label={{ value: '小时', position: 'insideLeft', angle: -90, fill: chartTheme.text }} />
                   <Tooltip
                     formatter={(value) => `${value}小时`}
                     contentStyle={tooltipStyle}
                   />
                   <Bar dataKey="time" fill={chartTheme.bar} radius={[8, 8, 0, 0]} />
                 </BarChart>
               </ResponsiveContainer>
             </div>
           )}

           {/* Time Distribution & Author Preferences (side-by-side) - HIDE IN WEEKLY MODE */}
           {timeMode !== 'weekly' && (
             <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
               {/* Time Distribution Bar Chart (LEFT) */}
               <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-6 shadow-sm">
               <div className="flex items-center gap-2 mb-4 sm:mb-6">
                 <span className="text-xl">🕐</span>
                 <h3 className="text-lg font-semibold text-gray-900">阅读时段分布</h3>
                 {timeDistDataSource !== 'none' && (
                   <span className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap flex-shrink-0 ${
                     timeDistDataSource === 'current'
                       ? 'bg-blue-100 text-blue-700'
                       : 'bg-amber-100 text-amber-800'
                   }`}>
                     {timeDistDataSource === 'current' ? '当前模式数据' : '总计数据'}
                   </span>
                 )}
               </div>
                 {chartData.timeDist.length > 0 ? (
                   <ResponsiveContainer width="100%" height={300}>
                     <BarChart data={chartData.timeDist}>
                       <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                       <XAxis
                         dataKey="hour"
                         tick={{ fontSize: 12, fill: chartTheme.text }}
                         axisLine={{ stroke: chartTheme.grid }}
                         tickLine={{ stroke: chartTheme.grid }}
                         interval={2}
                         label={{ value: '时段', position: 'insideBottom', offset: -5, fill: chartTheme.text }}
                       />
                       <YAxis tick={{ fontSize: 12, fill: chartTheme.text }} axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} label={{ value: '小时', position: 'insideLeft', angle: -90, fill: chartTheme.text }} />
                       <Tooltip
                         formatter={(value) => `${value}小时`}
                         contentStyle={tooltipStyle}
                       />
                       <Bar dataKey="time" fill={chartTheme.barMuted} radius={[8, 8, 0, 0]} />
                     </BarChart>
                   </ResponsiveContainer>
                 ) : (
                   <div className="flex items-center justify-center h-[300px] text-gray-400">
                     暂无数据
                   </div>
                 )}
               </div>

               {/* Author Preferences (RIGHT) */}
               <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-6 shadow-sm">
                 <div className="flex items-center gap-2 mb-4 sm:mb-6">
                   <span className="text-xl">✍</span>
                   <h3 className="text-lg font-semibold text-gray-900">作者偏好</h3>
                   <span className="text-sm text-gray-400 ml-2">
                     {chartData.authorData.length > 0 ? `共 ${chartData.authorData.length} 位偏好作者` : ''}
                   </span>
                 </div>
                 {chartData.authorData.length > 0 ? (
                   <div className="space-y-1">
                     {chartData.authorData.map((author, idx) => (
                       <div
                         key={idx}
                         className="flex items-center justify-between py-3 px-4 rounded-xl hover:bg-gray-50 transition-colors"
                       >
                         <span className="text-gray-900 font-medium text-sm">{author.name}</span>
                         <span className="text-gray-600 text-sm font-medium">
                           {author.count}本/{author.readTime}
                         </span>
                       </div>
                     ))}
                   </div>
                 ) : (
                   <div className="flex items-center justify-center h-[200px] text-gray-400">
                     暂无数据
                   </div>
                 )}
               </div>
             </div>
           )}

          {/* Category List & Top Books (side-by-side) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
             {/* Category List (LEFT) */}
             <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-6 shadow-sm">
               <div className="flex items-center gap-2 mb-4 sm:mb-6">
                 <span className="text-xl">🏷</span>
                 <h3 className="text-lg font-semibold text-gray-900">阅读分类排行</h3>
               </div>
               {chartData.categoryData.length > 0 ? (
                 <div className="space-y-1">
                   {chartData.categoryData.map((cat, idx) => (
                     <div
                       key={idx}
                       className="flex items-center gap-4 p-3 rounded-xl hover:bg-gray-50 transition-colors"
                     >
                       <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                         idx === 0 ? 'bg-yellow-100 text-yellow-700' :
                         idx === 1 ? 'bg-gray-100 text-gray-600' :
                         idx === 2 ? 'bg-orange-100 text-orange-700' :
                         'bg-gray-50 text-gray-400'
                       }`}>
                         {idx + 1}
                       </span>
                       <div className="flex-1 min-w-0">
                         <p className="font-medium text-gray-900 truncate text-sm">{cat.name}</p>
                       </div>
                        <span className="text-sm font-medium text-gray-600 whitespace-nowrap">
                          {cat.readingCount}本/{(() => {
                            const seconds = cat.value || 0;
                            const isWeeklyMode = timeMode === 'weekly';
                            if (!isWeeklyMode && seconds < 3600) {
                              // 非本周模式，不足1小时，显示分钟
                              return `${Math.round(seconds / 60)}分钟`;
                            }
                            return `${Math.round(seconds / (isWeeklyMode ? 60 : 3600))}${isWeeklyMode ? '分钟' : '小时'}`;
                          })()}
                        </span>
                     </div>
                   ))}
                 </div>
               ) : (
                 <div className="flex items-center justify-center h-[300px] text-gray-400">
                   暂无数据
                 </div>
               )}
             </div>

            {/* Top 10 Books (RIGHT) */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4 sm:mb-6">
                <span className="text-xl">📚</span>
                <h3 className="text-lg font-semibold text-gray-900">阅读时长排行</h3>
              </div>
              {chartData.readLongest.length > 0 ? (
                <div className="space-y-1">
                  {chartData.readLongest.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-4 p-3 rounded-xl hover:bg-gray-50 transition-colors"
                    >
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        idx === 0 ? 'bg-yellow-100 text-yellow-700' :
                        idx === 1 ? 'bg-gray-100 text-gray-600' :
                        idx === 2 ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-50 text-gray-400'
                      }`}>
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate text-sm">{item.name}</p>
                      </div>
                      <span className="text-sm font-medium text-gray-600 whitespace-nowrap">
                        {formatTime(item.time)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-[300px] text-gray-400">
                  暂无数据
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  </>
  );
}
