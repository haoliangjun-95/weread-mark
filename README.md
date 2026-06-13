# 微痕 — 微信读书数据可视化

微信读书数据可视化 Web 界面，基于 React + TypeScript + Vite + Tailwind CSS 构建。提供阅读看板、书架管理、笔记浏览、书评检索、全文搜索和个性化设置功能。

> 感谢微信读书团队让有趣的灵魂在茫茫人海中相遇！

演示页面： https://weread.haoliangjun.com/

## 功能特性

- 🔑 **API Key 管理** — 页面内配置、实时验证、本地存储
- 🔍 **搜索** — 全文搜索划线/想法、流式渲染结果
- 📊 **阅读看板** — 阅读统计、趋势图表、导出图片/PDF
- 📚 **书架** — 卡片网格布局、分类筛选、滚动加载
- 📝 **笔记** — 划线/想法/书评详情、导出图片/PDF
- ⭐ **书评墙** — 书评流式扫描、全屏阅读弹窗
- ⚙️ **设置** — 8 种主题、8 种字体、字号调节

> 📸 [查看完整功能介绍和截图 →](docs/功能介绍.md)

## 小小支持
如果这个项目对你有帮助，可以打赏一杯咖啡或者一瓶可乐，你的鼓励是更新动力!

<img src="docs/assets/wxzsm.png" width="240"  alt="赞赏码">

## 安装配置

```bash
npm install
npm run dev
```

浏览器打开 http://localhost:5173，在设置页输入微信读书 API Key。

> 获取 API Key：前往 [微信读书](https://weread.qq.com/) 获取。

## 构建部署

```bash
npm run build
```

构建输出在 `dist/` 目录，资源使用相对路径（`base: './'`），可部署到任意目录。

### Nginx 部署

```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /path/to/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass https://i.weread.qq.com;
        proxy_set_header Host i.weread.qq.com;
    }

    location /cover-proxy-cdn/ {
        proxy_pass https://cdn.weread.qq.com/;
        proxy_set_header Host cdn.weread.qq.com;
    }

    location /cover-proxy-qcloud/ {
        proxy_pass https://weread-1258476243.file.myqcloud.com/;
        proxy_set_header Host weread-1258476243.file.myqcloud.com;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

## 项目结构

```
src/
  components/      # 可复用 UI 组件（Header）
  pages/           # 页面组件
    SearchView.tsx   # 全文搜索
    Dashboard.tsx    # 阅读看板（含导出功能）
    ShelfView.tsx    # 书架（我的书架 + 已读完书架）
    NotesView.tsx    # 笔记列表与详情（支持导出图片/PDF）
    ReviewsView.tsx  # 书评墙（支持导出图片/PDF）
    SettingsView.tsx  # 设置（主题/字体/字号/导出样式/箴言/关于）
  services/
    weread.ts        # 微信读书 API 调用层 + Key 管理
  types/
    weread.ts        # API 响应类型定义
  utils/
    filters.tsx      # 共享 FilterBar、useInfiniteScroll
    exportImage.ts   # 导出图片功能（支持多风格，保留 HTML 格式）
    exportPdf.ts     # 导出 PDF 功能（含书籍封面）
  App.tsx            # 全局状态管理（主题/字体/字号/导出样式）
  index.css         # 全局样式 + 主题变量 + 动画
```

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `VITE_WEREAD_API_URL` | API 网关地址 | `/api/agent/gateway` |
| `VITE_SKILL_VERSION` | Skill 版本 | `1.0.3` |
| `VITE_ICP_RECORD_NO` | ICP 备案号（留空则不显示） | - |
| `VITE_ICP_RECORD_URL` | ICP 备案链接 | - |

## 技术栈

- React 19 + TypeScript
- Vite 8 + Tailwind CSS v4
- Recharts（数据可视化）
- html2canvas（图片导出）

## 开源协议

本项目基于 [MIT License](LICENSE) 开源，详见 [LICENSE](LICENSE) 文件。
