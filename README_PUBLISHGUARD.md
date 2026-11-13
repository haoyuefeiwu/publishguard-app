# PublishGuard — KDP 零风控造书与上架防封 SaaS

基于 **ShipAny Next** 与实战提炼的 **26 项 Amazon KDP 合规防火墙** 构建的商业化出版 SaaS 平台。

## 核心商业定位

- **免费引流工具（`/tools/kdp-guard` & 首页首屏快检）**：支持书名 Apple Books / OpenLibrary 实时防撞车 + 26 项封号风险扫描（DSM-5 医疗诊断词、商业促销词、虚假出版商印记、平装低内容 Scorecard/矩形边框 CSS、电子书外链 429 死链、跨笔名同域名关联拦截），支持上传 `.epub` 二进制包扫描。
- **三步造书工作台（`/studio`）**：
  1. 立项与笔名防关联矩阵（`/studio/profiles` + `/studio/new`）；
  2. 12 节深度大纲 & 第 1 章免费试读 & 4 套去同质化封面骨架（`/studio/[id]`）；
  3. 一键扣费触发后台异步编译（`KDP_Ready_Bundle.zip`：18,000+ 词 EPUB 3 + 二分锁页 6×9 印刷级内页 PDF + 精确计算书脊全展开封面 PDF + 一键复制后台清单 JSON）。

## 本地快速启动指南（两种模式）

### 模式 A：PostgreSQL + 生产级 Worker（推荐）

```bash
cp .env.example .env.development
# 填入 DATABASE_URL (PostgreSQL)、OPENROUTER_API_KEY、AUTH_SECRET 等配置
pnpm install
pnpm db:setup
pnpm db:push
pnpm dev
```

新开终端启动 Python 出版 Worker（负责长文撰写、EPUB 3 编译与 Chrome Headless 印刷级 PDF 渲染）：

```bash
pip install -r worker/requirements.txt
python3 worker/main.py
```

### 模式 B：零外部数据库 SQLite 本地试跑

```bash
DATABASE_PROVIDER=sqlite DATABASE_URL=file:data/local.db pnpm db:setup
DATABASE_PROVIDER=sqlite DATABASE_URL=file:data/local.db pnpm db:push
DATABASE_PROVIDER=sqlite DATABASE_URL=file:data/local.db pnpm dev
# 另一终端启动兼容模式 Worker：
DATABASE_PROVIDER=sqlite DATABASE_URL=file:data/local.db python3 worker/main.py
```

## 自动化测试

- Python 出版与 26 项防封引擎测试：
  `pytest -v worker/test_engine.py worker/test_worker_queue.py`
- TypeScript 静态类型检查与 Next.js 生产构建：
  `pnpm exec tsc --noEmit && pnpm build`

## Docker Compose 一键部署（VPS / 云服务器）

```bash
docker compose -f compose.production.yml --profile migrate run --rm migrate
docker compose -f compose.production.yml up -d --build
```
