# Notice Reminder Worker

Cloudflare Workers + D1 + Cron Trigger + Resend API 的提醒系统。

## 功能

- 管理员密码登录后查看、添加、删除提醒。
- 支持分钟、小时、日、月、年周期。
- 支持固定重复次数或永久重复。
- 每分钟 Cron 扫描到期提醒，并通过 Resend HTTP API 发送邮件。
- 点击“本次完成”后按完成时间自动计算下一次提醒。

## 本地开发

1. 安装依赖：

```bash
npm install
```

2. 复制本地环境变量：

```bash
copy .dev.vars.example .dev.vars
```

3. 修改 `.dev.vars`：

```text
ADMIN_PASSWORD=你的管理员密码
RESEND_API_KEY=你的 Resend API Key
REMINDER_EMAIL=接收提醒的邮箱
FROM_EMAIL=发件人，例如 Notice Reminder <onboarding@resend.dev>
```

4. 创建并迁移本地 D1：

```bash
npm run db:migrate:local
```

5. 启动：

```bash
npm run dev
```

打开 `http://localhost:8787`。

## 自动部署到 Cloudflare

本项目已经包含 GitHub Actions 自动部署配置：

```text
.github/workflows/deploy.yml
```

完整步骤见 [DEPLOYMENT.md](DEPLOYMENT.md)。

核心流程：

1. 在 Cloudflare 创建 D1 数据库。
2. 把真实 `database_id` 填入 `wrangler.toml`。
3. 在 Resend 创建 API Key。
4. 在 GitHub Secrets 配置 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`ADMIN_PASSWORD`、`RESEND_API_KEY`。
5. 推送到 GitHub `main` 分支。
6. GitHub Actions 自动执行测试、D1 迁移和 `wrangler deploy`。

## 手动部署

```bash
npx wrangler d1 create notice_reminders
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put RESEND_API_KEY
npm run db:migrate:remote
npm run deploy
```

## 注意

- Workers Cron Trigger 最小扫描间隔是 1 分钟，所以不提供秒级提醒。
- 邮件发送走 Resend API，不需要 Cloudflare Workers Paid 的 Email Sending。
- Resend 免费测试阶段可以先用 `onboarding@resend.dev` 作为发件地址；如果要用自己的域名邮箱发件，需要在 Resend 里验证域名。
- 同一条提醒同一次到期只会发送一次邮件，直到管理员点击“本次完成”推进下一次时间。
