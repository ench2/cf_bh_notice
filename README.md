# Notice Reminder Worker

Cloudflare Workers + D1 + Cron Trigger + Email Service 的提醒系统。

## 功能

- 管理员密码登录后才能查看、添加、删除提醒。
- 支持分钟、小时、日、月、年周期。
- 支持固定重复次数或永久重复。
- 每分钟 Cron 扫描提醒；到期前 3 天开始，在北京时间 08:00-22:00 内发送邮件。
- 同一条提醒每小时最多发送一封邮件，直到管理员点击“本次完成”。
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
ADMIN_PASSWORD=你的管理密码
REMINDER_EMAIL=接收提醒的邮箱
FROM_EMAIL=Cloudflare Email Service 可发送的发件地址
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

## 部署

1. 创建 D1 数据库：

```bash
npx wrangler d1 create notice_reminders
```

把输出的 `database_id` 填入 `wrangler.toml`。

2. 设置管理密码：

```bash
npx wrangler secret put ADMIN_PASSWORD
```

3. 在 `wrangler.toml` 中配置：

```toml
[vars]
REMINDER_EMAIL = "admin@example.com"
FROM_EMAIL = "reminders@example.com"
```

4. 应用远程迁移并部署：

```bash
npm run db:migrate:remote
npm run deploy
```

## 注意

- 当前使用 Workers Cron Trigger，最小扫描间隔是 1 分钟，所以不提供秒级提醒。
- 邮件发送依赖 Cloudflare Email Service 的 `EMAIL` send binding。
- 同一条提醒进入到期前 3 天窗口后会持续提醒，但会按 `last_sent_at` 限制为每小时最多一封。
- 邮件发送时间窗口按北京时间计算：每天 08:00 到 22:00。
