# GitHub 自动部署到 Cloudflare 说明

这个项目是 Cloudflare Workers 应用，使用 D1 数据库、Cron Trigger 和 Send Email 绑定。推荐使用本仓库自带的 GitHub Actions：代码推送到 GitHub 的 `main` 分支后，自动完成类型检查、测试、D1 远程迁移和 Worker 部署。

## 一、部署前准备

需要准备：

- 一个 Cloudflare 账号。
- 一个 GitHub 仓库。
- 本机已安装 Node.js 20 或更高版本。
- Cloudflare 账号已启用 Workers、D1、Email Routing/Email Service 相关能力。

先在本机安装依赖：

```bash
npm install
```

登录 Cloudflare：

```bash
npx wrangler login
```

## 二、创建 D1 数据库

创建生产数据库：

```bash
npx wrangler d1 create notice_reminders
```

命令输出里会有类似下面的配置：

```toml
[[d1_databases]]
binding = "DB"
database_name = "notice_reminders"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把真实的 `database_id` 填入 `wrangler.toml`，替换当前的 `REPLACE_WITH_D1_DATABASE_ID`。

## 三、配置发件邮箱

项目使用 `wrangler.toml` 里的 Send Email 绑定：

```toml
[[send_email]]
name = "EMAIL"
```

同时需要确认 `wrangler.toml` 中这两个变量是你的真实邮箱：

```toml
[vars]
REMINDER_EMAIL = "admin@example.com"
FROM_EMAIL = "reminders@example.com"
```

- `REMINDER_EMAIL`：接收提醒邮件的邮箱。
- `FROM_EMAIL`：Cloudflare 允许发送的发件邮箱，通常必须属于已验证域名或已配置的 Email Routing 地址。

如果没有配置好 Cloudflare 邮件发送能力，Worker 可以部署，但实际提醒邮件可能发送失败。

## 四、创建 Cloudflare API Token

打开 Cloudflare 控制台：`My Profile` -> `API Tokens` -> `Create Token`。

建议使用自定义 Token，并授予这些权限：

- `Account` -> `Workers Scripts` -> `Edit`
- `Account` -> `D1` -> `Edit`
- `Account` -> `Workers Tail` -> `Read`，可选，用于后续查日志

账号范围选择当前 Cloudflare Account。

同时找到你的 Account ID：Cloudflare 控制台右侧栏或 Workers 页面里可以看到。

## 五、配置 GitHub Secrets

进入 GitHub 仓库：`Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`。

添加三个 Secret：

| 名称 | 内容 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 第四步创建的 Cloudflare API Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `ADMIN_PASSWORD` | 登录提醒管理页面的管理员密码 |

不要把 `.dev.vars` 上传到 GitHub。当前 `.gitignore` 已经排除了 `.dev.vars`。

## 六、上传项目到 GitHub

如果当前目录还没有初始化 git，执行：

```bash
git init
git branch -M main
git add .
git commit -m "Initial Cloudflare Worker app"
git remote add origin https://github.com/<你的用户名>/<你的仓库名>.git
git push -u origin main
```

如果已经是 git 仓库，只需要提交并推送：

```bash
git add .
git commit -m "Add Cloudflare auto deployment"
git push
```

## 七、自动部署流程

本仓库已经包含 GitHub Actions 配置：

```text
.github/workflows/deploy.yml
```

当代码推送到 `main` 分支时，会自动执行：

1. 拉取代码。
2. 安装 Node.js 22。
3. 执行 `npm ci`。
4. 执行 `npm run typecheck`。
5. 执行 `npm test`。
6. 执行远程 D1 迁移：`npx wrangler d1 migrations apply notice_reminders --remote`。
7. 从 GitHub Secret 写入 Worker secret：`ADMIN_PASSWORD`。
8. 执行部署：`npx wrangler deploy --secrets-file .worker-secrets`。

也可以在 GitHub 页面手动触发：`Actions` -> `Deploy Cloudflare Worker` -> `Run workflow`。

## 八、首次部署后检查

部署完成后，在 GitHub Actions 日志里会看到 Worker 地址，通常类似：

```text
https://notice-reminder-worker.<你的 workers 子域>.workers.dev
```

打开地址后，用 `ADMIN_PASSWORD` 登录。

也可以在 Cloudflare 控制台检查：

- `Workers & Pages` 中存在 `notice-reminder-worker`。
- Worker 设置里存在 D1 绑定 `DB`。
- Worker 设置里存在 Send Email 绑定 `EMAIL`。
- Triggers 中存在 Cron：`* * * * *`。

## 九、常见问题

### 1. GitHub Actions 报 `database_id` 无效

说明 `wrangler.toml` 里还没有填真实 D1 数据库 ID。重新执行：

```bash
npx wrangler d1 create notice_reminders
```

把输出里的 `database_id` 填回 `wrangler.toml`，提交并推送。

### 2. Actions 报 Cloudflare API 权限不足

检查 `CLOUDFLARE_API_TOKEN` 权限是否包含 Workers Scripts Edit 和 D1 Edit，且 Account 范围选对。

### 3. 页面提示缺少 `ADMIN_PASSWORD`

检查 GitHub 仓库 Secrets 是否添加了 `ADMIN_PASSWORD`。然后重新运行 GitHub Actions。

### 4. 可以登录但收不到邮件

优先检查：

- `FROM_EMAIL` 是否是 Cloudflare 允许发送的地址。
- `REMINDER_EMAIL` 是否正确。
- Cloudflare 邮件发送能力是否已配置完成。
- Worker 日志里是否有 Email binding 的错误。

### 5. 想改 Worker 名称

修改 `wrangler.toml`：

```toml
name = "notice-reminder-worker"
```

改完提交到 `main`，GitHub Actions 会部署到新的 Worker 名称。

## 十、手动部署备用命令

如果暂时不使用 GitHub Actions，也可以本机手动部署：

```bash
npm run typecheck
npm test
npx wrangler d1 migrations apply notice_reminders --remote
npx wrangler secret put ADMIN_PASSWORD
npm run deploy
```

之后每次改代码，只要执行：

```bash
npm run deploy
```
