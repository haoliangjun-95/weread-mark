import { useState, useEffect, useCallback } from 'react';
import type { BookItem } from '../types/weread';
import type { HighlightTarget } from '../App';
import OnThisDayCard from '../components/OnThisDayCard';
import StatsTrendCard from '../components/StatsTrendCard';
import { lazy, Suspense } from 'react';
import type { TimeMode } from './DashboardCharts';
const DashboardCharts = lazy(() => import('./DashboardCharts'));
import { fetchShelf, fetchReadingStats, fetchAllNotebooks } from '../services/weread';

export interface ChartData {
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

interface DashboardProps {
  hasKey: boolean;
  onSelectBook?: (book: BookItem, target?: HighlightTarget) => void;
}

export default function Dashboard({ hasKey, onSelectBook }: DashboardProps) {
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

       // overall 模式：与「书架 → 已读完」完全一致，使用 notebooks 中 markedStatus === 4 且有 book 的数量；
       // 传参带 selectedYear 的年份模式同样是周期口径，用 readStat 的周期值。
       // 周期值缺失时才回退书架累计数，且绝不与累计值取 max（会把周期 1 本显示成累计 8 本）
       let finalFinished: number;
       if (timeMode === 'overall' && notebooksData) {
         finalFinished = (notebooksData.books || [])
           .filter(item => item.markedStatus === 4 && item.book).length;
       } else if (finishedFromStat > 0) {
         finalFinished = finishedFromStat;
       } else {
         finalFinished = shelfFinished;
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
       {/* 往年今天（桌面版本地库，纯本地查询） */}
       {onSelectBook && <OnThisDayCard onSelectBook={onSelectBook} />}
       <StatsTrendCard />
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
               <p className="text-xs sm:text-sm text-gray-500 leading-snug">{card.label}</p>
               <span className={`w-5 h-5 sm:w-8 sm:h-8 rounded-md sm:rounded-lg flex items-center justify-center text-xs sm:text-sm flex-shrink-0 ${card.iconBg}`}>
                 {card.icon}
               </span>
             </div>
             {/* 数值不截断：长时长（如 128小时）完整换行显示 */}
             <p className="text-sm sm:text-2xl font-bold text-gray-900 text-center sm:text-left leading-tight break-words">{card.value}</p>
           </div>
         ))}
       </div>

      {/* Charts（recharts 懒加载分包） */}
      {chartData && (
        <Suspense fallback={<div className="flex h-40 items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>图表加载中...</div>}>
          <DashboardCharts
            timeMode={timeMode}
            chartData={chartData}
            last7DaysTrend={last7DaysTrend}
            last30DaysTrend={last30DaysTrend}
            thisMonthTrend={thisMonthTrend}
            selectedYearMonthlyTrend={selectedYearMonthlyTrend}
            selectedYear={selectedYear}
            timeDistDataSource={timeDistDataSource}
          />
        </Suspense>
      )}

    </div>
  </>
  );
}
