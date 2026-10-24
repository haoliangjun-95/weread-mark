import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import type { ChartData } from './Dashboard';

export type TimeMode = 'weekly' | 'monthly' | 'annually' | 'overall';

interface DashboardChartsProps {
  timeMode: TimeMode;
  chartData: ChartData;
  last7DaysTrend: { date: string; time: number }[];
  last30DaysTrend: { date: string; time: number }[];
  thisMonthTrend: { date: string; time: number }[];
  selectedYearMonthlyTrend: { month: string; time: number }[];
  selectedYear: number;
  timeDistDataSource: 'current' | 'overall' | 'none';
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}小时${minutes > 0 ? minutes + '分钟' : ''}`;
  }
  return `${minutes}分钟`;
}

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

/**
 * 看板图表区（recharts 重依赖单独分包，经 Dashboard 懒加载，
 * 避免主包随首屏一起拉下全部图表库）。
 */
export default function DashboardCharts({
  timeMode, chartData, last7DaysTrend, last30DaysTrend, thisMonthTrend,
  selectedYearMonthlyTrend, selectedYear, timeDistDataSource,
}: DashboardChartsProps) {
  return (
         <div className="space-y-6 sm:space-y-8">
            {/* 最近30天阅读趋势：数据始终是「今天近30天」，与选中年份无关——
                往年视角下出现会语义错乱，仅当年与总计模式显示 */}
            {((timeMode === 'overall' || (timeMode === 'annually' && selectedYear === new Date().getFullYear()))
              && last30DaysTrend.length > 0) && (
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
  );
}
