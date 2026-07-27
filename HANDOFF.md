# Ting Ting 项目交接记录

更新时间：2026-07-26 22:58 PDT（America/Vancouver）
项目目录：`/Users/lazycat/Documents/ting ting`
当前分支：`main`
交接状态：代码与专用测试环境验收完成；真实生产启用仍受外部配置和 Owner 批准门禁约束

## 1. 当前结论

本轮已经按 PRD 要求完成五个阶段：

1. 修复生产 Admin Cookie 认证链路。
2. 增加独立 Supabase 生产模式关键写操作 E2E。
3. 补齐租客列表、调度预览、投递筛选、Dashboard、测试发送和安全审计。
4. 完善生产健康检查、Render Cron、Provider 独立模式和上线门禁。
5. 完成 lint、typecheck、unit、build、两套 Playwright、RLS 和 OpenClaw 验证。

当前可以描述为：

- 本地实现完成；
- 专用本地 Supabase 生产路径验证通过；
- Email/SMS 的代码链路均已完成；
- Owner 已决定本次上线采用 Email-only；Twilio/SMS 因号码成本延后，不是本次上线门禁；
- 没有执行真实部署；
- 没有发送真实邮件或短信；
- Email 必须继续 disabled，提醒必须继续 force-paused，直到 Resend 外部门禁完成；
- SMS 必须持续保持 `SMS_PROVIDER_MODE=disabled`，不得随 Email 上线一并启用。

## 2. 生产 Admin 认证

Admin 页面和 `/api/admin/*` 现在统一使用 Supabase SSR Cookie Session：

- 浏览器不读取、不保存、不手工发送 Access Token；
- API 服务端调用 Supabase 验证当前用户；
- 服务端使用 Service Role 查询 `admin_profiles.is_active`；
- 生产模式强制 AAL2；
- 敏感操作要求最近十分钟认证；
- 写操作保留 Same-Origin/CSRF 检查；
- 30 分钟空闲过期；
- 12 小时绝对过期；
- 显式退出清理 Supabase 与本地跟踪 Cookie；
- Media API 使用同一认证边界；
- `/api/admin/*` 不再接受 Bearer Token；
- 机器客户端的 Bearer Token 仅用于 `/api/automation/v1`。

关键文件：

- `src/lib/auth.ts`
- `proxy.ts`
- `src/app/api/auth/session/route.ts`
- `src/app/api/auth/logout/route.ts`
- `src/components/admin/login-form.tsx`
- `src/app/api/admin/[...segments]/route.ts`
- `src/app/api/admin/media/route.ts`
- `src/app/api/admin/media/[id]/route.ts`
- `tests/unit/admin-auth.test.ts`

## 3. Supabase 生产模式 E2E

新增独立配置：

- `playwright.supabase.config.ts`
- `tests/e2e-supabase/production-writes.spec.ts`
- `scripts/provision-supabase-e2e-admin.ts`
- `supabase/config.toml`
- `pnpm test:e2e:supabase`

安全特性：

- 必须设置明确的测试项目确认标记；
- 只能连接专用测试项目或本地 Supabase；
- 会拒绝与声明的生产 Supabase URL 相同的项目；
- Next.js 测试服务器固定在本地地址；
- Email/SMS Provider 固定为 mock；
- `REMINDERS_FORCE_PAUSED=true`；
- 使用真实 Supabase Cookie、密码登录和 TOTP AAL2；
- 浏览器请求断言不存在 `Authorization` Header；
- 使用唯一测试标识；
- 租客最终归档；
- 不向真实地址发送任何内容。

覆盖内容：

- 登录和 MFA；
- 草稿、公网页面隔离、发布、回滚；
- 房源创建、修改、发布、下架、归档和媒体；
- 租客创建、修改、权限与归档；
- 提醒计划启用和禁用；
- 租客投影与组合筛选；
- 批次预览、冻结收件人、精确数量确认；
- 测试发送不可绕过预览；
- 管理员测试地址；
- 暂停状态下的 mock test-only 投递；
- 投递日期组合筛选；
- 业务与认证审计记录。

## 4. PRD 管理端补全

### 租客列表

- 支持姓名、物业、Unit 搜索；
- 支持 active/inactive/archived；
- 支持 Email/SMS 联系权限；
- 支持 enabled/disabled/missing 计划筛选；
- 显示计划状态、下次提醒、上次投递状态和时间；
- 联系方式保持脱敏；
- Repository 上限为 500；
- Supabase 使用 `admin_tenant_list` 一次查询投影，避免 N+1；
- 普通 UI 没有永久删除租客入口。

### 调度预览

- 修改日期、时间、时区时调用服务端预览接口；
- 复用 `nextOccurrence` 服务端算法；
- 保存时服务端重新计算，不信任客户端 `nextRunAt`；
- 单元测试覆盖 29/30/31 日、月末回退、Vancouver DST 和无效时区。

### 投递历史与 Dashboard

- 日期筛选明确使用 `scheduledFor` 的 UTC 日期；
- 可与租客、渠道和状态组合；
- Supabase 查询在服务端过滤并限制 500 条；
- Dashboard 显示最近五条发送记录；
- 显示租客、渠道、来源、状态、脱敏目标和时间；
- 保留暂停、Worker、失败和 backlog 状态。

### 测试发送

- 必须经过预览、确认、入队；
- 预览展示主题、正文、SMS segment 数量、Provider mode；
- 只显示和使用管理员保存的测试地址；
- 短期签名 Preview Token 绑定 actor、tenant、channel、template、requestId；
- 直接调用入队接口会返回 `TEST_PREVIEW_REQUIRED`；
- requestId 和数据库 occurrence key 防止重复提交。

关键文件：

- `src/app/admin/[[...segments]]/page.tsx`
- `src/components/admin/tenant-editor.tsx`
- `src/components/admin/delivery-history.tsx`
- `src/components/admin/send-reminder.tsx`
- `src/data/store.ts`
- `src/data/supabase-repository.ts`
- `src/features/notifications/test-send-preview.ts`

## 5. Email 与 SMS 状态

两个渠道都已实现独立模式：

```text
EMAIL_PROVIDER_MODE=mock|disabled|live
SMS_PROVIDER_MODE=mock|disabled|live
```

Email 已实现：

- Resend REST Provider；
- 幂等键；
- 管理员测试邮箱；
- Resend/Svix Webhook 签名；
- delivered/bounced/complained/failed 状态；
- bounce/complaint 联系权限抑制。

SMS 已实现：

- Twilio Provider；
- Messaging Service SID 或受限测试 Sender Number；
- 管理员测试手机号；
- SMS segment 预估；
- Twilio Status Callback 签名；
- sent/delivered/failed/undelivered/unknown 状态；
- 永久无效号码/退订抑制；
- Provider 请求后的模糊网络结果进入 `unknown`，不会盲目自动重试。

真实 Email 尚未执行。Twilio/SMS 已由 Owner 明确延后。当前 Render 蓝图保持：

```text
EMAIL_PROVIDER_MODE=disabled
SMS_PROVIDER_MODE=disabled
REMINDERS_FORCE_PAUSED=true
```

## 6. 安全审计

新增固定白名单安全事件：

- 登录成功；
- 登录失败；
- MFA enrollment 成功；
- MFA challenge 成功或失败；
- Session 过期；
- 显式退出；
- 停用管理员拒绝；
- MFA 不足拒绝；
- recent-auth 不足拒绝。

审计不保存密码、TOTP Secret、Token、Cookie 或完整邮箱。登录失败仅保存：

- 邮箱掩码；
- SHA-256 账号摘要；
- 固定 reason code。

频繁失败按来源摘要和账号摘要限流。审计存储故障不会放宽认证拒绝。

关键文件：

- `src/lib/security-audit.ts`
- `src/app/api/auth/security-event/route.ts`
- `tests/unit/security-audit.test.ts`

## 7. 数据库迁移

本轮新增或修复：

- `202607260014_fix_notification_batch_digest.sql`
  - 修复 Supabase 中 pgcrypto 位于 `extensions` schema 导致的 batch digest 失败。
- `202607260015_admin_tenant_list_projection.sql`
  - 增加租客、计划和最新投递的一次查询投影及索引。
- `202607260016_paused_test_delivery_claims.sql`
  - 暂停时只允许 claim 最多 20 条 `source=test` 事件；
  - 发送前重新核对当前管理员测试地址；
  - 普通 scheduled/manual 事件仍不可被暂停 Worker claim。
- `202607260017_fix_retention_digest.sql`
  - 修复每日保留任务的 pgcrypto search path。

同时修正了基线 `202607260003` 和 `202607260009`，保证全新数据库和已有数据库都可工作。

迁移 `202607240001` 至 `202607260017` 已从空 PostgreSQL 17 数据库完整应用。

## 8. 生产配置和健康检查

`/api/health` 现在检查：

- 环境配置；
- Supabase Dashboard 查询；
- Cron Secret 是否配置；
- `APP_BASE_URL` 是否为生产公开 HTTPS；
- Email/SMS 独立模式；
- force-pause 状态。

生产模式额外要求：

- `APP_BASE_URL` 必须是公开 HTTPS Origin；
- 不允许 localhost、凭据、query 或 fragment；
- 如果未来单独启用 SMS，Twilio Callback 必须精确等于：

```text
https://<public-host>/api/webhooks/twilio
```

正式生产蓝图 `render.production.yaml` 包含：

- Web Service；
- `*/5 * * * *` Cron；
- Cron 使用 `scripts/invoke-reminder-cron.ts`；
- Web 与 Cron 必须由 Owner 输入同一个 `REMINDER_CRON_SECRET`；
- Cron 不打印 Secret 或完整响应正文。

免费客户 Demo 使用根目录 `render.yaml`，只创建 Free Web Service，不包含
Render Cron，也不得作为正式生产 Cron 证据。

完整操作顺序见：

- `docs/OPERATIONS.md`
- `render.yaml`
- `render.production.yaml`
- `.env.example`

## 9. 最终验证结果

以下命令全部通过：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm --dir integrations/openclaw test
```

结果：

```text
Unit/service:             93 passed
Demo Playwright:           2 passed
Supabase production E2E:   1 passed
Supabase anonymous RLS:   16 passed
OpenClaw:                  7 passed
Production build:          passed
Render YAML parse:         passed
```

基础 `pnpm test` 在没有测试 Supabase 变量时会按设计跳过 16 个 RLS 测试；随后已在专用本地 Supabase 中单独运行并全部通过。

非阻塞提示：

- Playwright 中有 `NO_COLOR` 环境提示；
- Next.js 提示 `<html>` 使用 smooth scroll，可后续增加其建议的标记；
- 没有提交像素回归基线，视觉回归仍为外部/后续门禁；
- 生产 Core Web Vitals 必须部署后测量。

## 10. 当前本地与 Git 状态

- 当前分支：`main`；
- 工作树是 dirty，包含本轮实现以及本轮开始前已有的用户修改；
- 没有创建 commit、push 或 PR；
- 不要使用 `git reset --hard`、`git checkout -- .` 或宽泛覆盖；
- 合并/提交前必须逐文件审阅，保留已有用户修改；
- `.env.local` 存在并已被 Git 忽略，不要读取、打印或提交其真实值；
- `.env.local.swp` 已不存在；
- `.gitignore` 已覆盖 `*.swp`、`*.swo`、Supabase/Playwright 生成目录；
- 本轮临时 Supabase key/TOTP 文件已经删除；
- 本地 Supabase 测试栈已 `stop --no-backup`，不保留测试数据库；
- `HANDOFF.md` 当前未被 Git 跟踪，提交时需要显式决定是否加入。

## 11. 尚未完成的外部门禁

代码完成不代表可以解除暂停。仍需要 Owner/外部系统提供：

1. 生产 Supabase 项目和管理员；
2. Render Web + Cron；
3. 公开 HTTPS `APP_BASE_URL`；
4. Owner 创建的 `REMINDER_CRON_SECRET`；
5. Resend API Key、验证域名、正式 `EMAIL_FROM` 和 Webhook Secret；
6. 管理员本人确认的测试邮箱；
7. Resend 真实 dry run 与签名回调证据；
8. Owner 对 Email 模板、收件人、保留期和解除暂停的明确批准；
9. 生产加密备份及恢复演练。

Twilio Account、Sender、测试手机号及真实 SMS dry run 延后到后续独立项目，
不阻塞本次 Email-only 上线。SMS 在本次上线前后都必须保持
`SMS_PROVIDER_MODE=disabled`；未来如要启用，必须重新走独立的 Provider
dry run、签名回调和 Owner 批准。

如果任何账号、域名、Secret、测试联系人或 Owner 批准缺失，停止对应外部操作，不得绕过门禁。

## 12. 下一位工程师的操作顺序

1. 阅读本文件、`docs/OPERATIONS.md`、`docs/QA-REPORT.md`。
2. 运行 `git status --short`，审阅 dirty worktree，不要回滚未知修改。
3. 再运行完整本地门禁。
4. 在专用项目应用全部迁移并运行 `pnpm provision:supabase`。
5. 配置 Render，但保持：

   ```text
   REMINDERS_FORCE_PAUSED=true
   global reminders paused
   EMAIL_PROVIDER_MODE=disabled
   SMS_PROVIDER_MODE=disabled
   ```

6. 在本地/专用测试项目使用 Email mock 验证完整流程。
7. 保存并确认管理员测试邮箱；测试手机号留空。
8. 只启用 Email，完成管理员邮箱 Resend dry run 和签名回调。
9. 收集 Resend、Webhook、投递事件和审计证据。
10. Owner 明确批准后，才设置 `REMINDERS_FORCE_PAUSED=false` 并在 Admin 显式解除全局暂停；保持 `SMS_PROVIDER_MODE=disabled`。

真实 Email dry run 只能发送到管理员拥有并确认的邮箱，绝不能发送给租客。

## 13. 建议首先阅读的文件

- `docs/OPERATIONS.md`
- `docs/QA-REPORT.md`
- `docs/PRD-COMPLETION.md`
- `docs/API.md`
- `src/lib/auth.ts`
- `src/lib/env.ts`
- `src/lib/security-audit.ts`
- `src/data/supabase-repository.ts`
- `src/app/api/admin/[...segments]/route.ts`
- `playwright.supabase.config.ts`
- `tests/e2e-supabase/production-writes.spec.ts`
- `render.yaml`
- `render.production.yaml`
