# GitHub 自动部署到 Cloudflare 说明

这个项目是 Cloudflare Workers 应用，使用 D1 数据库、Cron Trigger 和 Resend 邮件 API。推荐使用本仓库自带的 GitHub Actions：代码推送到 GitHub 的 `main` 分支后，自动完成类型检查、测试、D1 远程迁移和 Worker 部署。

每条提醒都可以单独设置允许发送时间段和重复发信间隔；这些配置保存在 D1 数据库里，不需要改 Worker 环境变量。

## 一、部署前准备

需要准备：

- 一个 Cloudflare 账号。
- 一个 GitHub 仓库。
- 一个 Resend 账号。
- 本机已安装 Node.js 20 或更高版本。

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

把真实的 `database_id` 填入 `wrangler.toml`。

## 三、配置 Resend 邮件

进入 Resend 控制台，创建 API Key。

如果只是先测试，可以使用 Resend 默认发件地址：

```toml
[vars]
REMINDER_EMAIL = "4100798@qq.com"
FROM_EMAIL = "Notice Reminder <onboarding@resend.dev>"
```

如果要使用自己的域名邮箱，例如 `wxq@edu.841666.xyz`，需要先在 Resend 里添加并验证域名，然后配置：

```toml
[vars]
REMINDER_EMAIL = "4100798@qq.com"
FROM_EMAIL = "Notice Reminder <wxq@edu.841666.xyz>"
```

`REMINDER_EMAIL` 是接收提醒的邮箱。`FROM_EMAIL` 是发件人，必须符合 Resend 的发件域名规则。

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

添加四个 Secret：

| 名称 | 内容 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `ADMIN_PASSWORD` | 登录提醒管理页面的管理员密码 |
| `RESEND_API_KEY` | Resend API Key |

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
git commit -m "Use Resend email API"
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
7. 从 GitHub Secret 写入 Worker secrets：`ADMIN_PASSWORD`、`RESEND_API_KEY`。
8. 执行部署：`npx wrangler deploy --secrets-file .worker-secrets`。

也可以在 GitHub 页面手动触发：`Actions` -> `Deploy Cloudflare Worker` -> `Run workflow`。

## 八、首次部署后检查

部署完成后，打开你的域名：

```text
https://reminder.841666.xyz/
```

或 Workers 默认域名：

```text
https://notice-reminder-worker.<你的 workers 子域>.workers.dev
```

登录后可以调用测试接口验证 Resend 发信：

```bash
curl -X POST https://reminder.841666.xyz/api/test-email
```

这个接口需要登录 cookie。更简单的方式是在浏览器登录后，用开发者工具或后续页面按钮调用；当前它主要用于部署排错。

也可以在 Cloudflare 控制台检查：

- `Workers & Pages` 中存在 `notice-reminder-worker`。
- Worker 设置里存在 D1 绑定 `DB`。
- Worker 设置里存在 secret：`ADMIN_PASSWORD`、`RESEND_API_KEY`。
- Triggers 中存在 Cron：`* * * * *`。

## 九、常见问题

### 1. GitHub Actions 报 `database_id` 无效

说明 `wrangler.toml` 里没有填真实 D1 数据库 ID。重新执行：

```bash
npx wrangler d1 create notice_reminders
```

把输出里的 `database_id` 填回 `wrangler.toml`，提交并推送。

### 2. Actions 报 Cloudflare API 权限不足

检查 `CLOUDFLARE_API_TOKEN` 权限是否包含 Workers Scripts Edit 和 D1 Edit，且 Account 范围选对。

### 3. 页面提示缺少 `ADMIN_PASSWORD`

检查 GitHub 仓库 Secrets 是否添加了 `ADMIN_PASSWORD`，然后重新运行 GitHub Actions。

### 4. 发送邮件失败

优先检查：

- GitHub Secrets 或 Worker secrets 是否有 `RESEND_API_KEY`。
- `FROM_EMAIL` 是否符合 Resend 规则。
- 如果使用自定义域名发件，域名是否已在 Resend 验证通过。
- `REMINDER_EMAIL` 是否正确。
- Worker 日志里是否有 `Resend email failed`。

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
npx wrangler secret put RESEND_API_KEY
npm run deploy
```
