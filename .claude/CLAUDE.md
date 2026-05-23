# TAPD 项目监控面板

## 项目概述
TAPD 项目洞察面板 — 拉取 TAPD 迭代数据，展示需求/缺陷状态、延期风险、人员负载。

## 运行方式
- `python3 build.py` — 拉取最新 TAPD 数据，生成 data.js
- `python3 server.py` — 启动本地预览，访问 http://localhost:8080

## 文件结构
| 文件 | 作用 | 手动编辑？ |
|------|------|:--:|
| fetch.py | 调用 TAPD API，分析迭代数据 | ✅ |
| build.py | 调用 fetch.py，生成 data.js | ✅ |
| server.py | 本地预览 HTTP 服务器 | ✅ |
| index.html | 前端页面结构 | ✅ |
| app.js | 前端核心逻辑（依赖 Chart.js CDN） | ✅ |
| style.css | 样式 | ✅ |
| data.js | 预加载数据（build.py 自动生成） | ❌ |

## TAPD 领域知识

### 需求状态映射 (STORY_STATUS)
`new→新建 / developing→开发中 / suspended→挂起 / resolved→已实现 / product_experience→策划已验收 / status_1→关闭 / status_6→测试验收中 / status_7→策划验收中 / status_11→BUG修复中 / status_12→三方已确认`

### 缺陷状态映射 (BUG_STATUS)
`new→新建 / planning→修复中 / resolved→已解决 / verified→测试复现 / PMM_audited→测试验收中 / reopened→重新打开 / suspended→挂起 / rejected→已拒绝 / closed→已关闭`

### 关闭态定义
- 需求关闭: `resolved`, `status_1`
- 缺陷关闭: `closed`, `resolved`, `rejected`

### 分析维度
- **延期需求**: due < 今天 且状态非关闭
- **滞后关闭**: due < 今天 且已关闭 且 completed > due
- **严重缺陷**: severity=fatal|serious 且状态非关闭
- **人员负载**: 每人未关闭的需求数 + 缺陷数 + 延期数
- **未分配**: owner 为空的需求/缺陷

## ⚠️ 安全注意事项
- fetch.py 第 10 行包含 TAPD API 认证凭据，不可提交到公开仓库
- data.js 是自动生成文件，不应手动编辑