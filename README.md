# GitHub 日推荐 / 周推荐

一个面向 AI 开源项目的推荐页，聚合 `skills.sh`、`AgentSkillsRepo` 和 GitHub 仓库信号，输出 `日推荐 / 周推荐` 详情卡片流。

## 当前能力

- 聚合 GitHub repo 与 skill 生态信号，生成日推荐和周推荐
- 默认排除 `OpenClaw`
- 本地模式支持 24 小时自动刷新
- Vercel 模式支持 Functions + Blob 持久化 + Cron 每日刷新

## 本地运行

1. 安装依赖

   ```bash
   npm install
   ```

2. 配置环境变量

   ```bash
   cp .env.example .env
   ```

3. 启动服务

   ```bash
   npm start
   ```

4. 打开 [http://localhost:3000](http://localhost:3000)

## 手动刷新

```bash
npm run refresh
```

## 测试

```bash
npm test
```

## Vercel 一键部署准备

这个项目已经补齐了 Vercel 所需结构：

- `public/`：静态前端
- `api/`：Vercel Functions
- `vercel.json`：每日 Cron 配置
- `@vercel/blob`：用于持久化快照数据

### 部署前需要配置的环境变量

- `GITHUB_TOKEN`
  作用：提高 GitHub API 额度，避免抓取仓库信息时过快触发限流
- `BLOB_READ_WRITE_TOKEN`
  作用：让 Vercel Functions 把快照数据库写入 Vercel Blob，而不是写本地磁盘
- `BLOB_DB_PATH`
  默认值：`skill-recommender/skills-db.json`
- `REFRESH_INTERVAL_HOURS`
  默认值：`24`

### GitHub + Vercel 部署步骤

1. 把当前目录上传到你的 GitHub 仓库
2. 在 Vercel 中选择 `Add New Project`
3. 导入该 GitHub 仓库
4. 在 Vercel 项目环境变量中填入 `GITHUB_TOKEN`、`BLOB_READ_WRITE_TOKEN`
5. 部署完成后，Vercel 会自动识别：
   - 静态页面
   - `/api/projects`、`/api/status`、`/api/refresh`
   - `/api/cron/refresh` 的每日定时刷新

## 当前限制

- 这个目录目前还没有配置 GitHub 远端，因此“实际上传 GitHub”这一步还没执行
- Vercel 上的每日更新依赖 `BLOB_READ_WRITE_TOKEN`，如果不配置，部署后只能退回无持久化模式
