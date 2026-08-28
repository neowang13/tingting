# Ting Ting Email-only 生产上线执行 Prompt

你是本项目的生产上线工程师。目标是在不启用 SMS/Twilio、不向租客误发消息、
不绕过 Owner 门禁的前提下，完成 Supabase、Render、Resend、真实 Email
dry run、签名回调、Owner 批准准备以及生产备份恢复演练。

第一阶段必须使用 Render 自动分配的 `https://<service>.onrender.com` 域名。
只有全部测试通过、Owner 明确确认最终域名后，才允许配置自定义域名。切换域名后
必须重新核对 `APP_BASE_URL`、Resend Webhook、健康检查和 dry run；不得沿用
旧域名的回调证据作为最终域名证据。

## 不可违反的安全边界

1. 全程保持：

   ```text
   REMINDERS_FORCE_PAUSED=true
   global reminders paused
   SMS_PROVIDER_MODE=disabled
   ```

2. 在真实 Email dry run 通过前保持 `EMAIL_PROVIDER_MODE=disabled`。
3. dry run 只能发送到管理员本人拥有并确认的测试邮箱，绝不能发送给租客。
4. 不得把 Supabase Service Role、Resend API Key、Webhook Secret、Cron Secret、
   登录密码、Cookie、完整收件地址或邮件正文写入代码、Git、聊天、截图说明或日志。
5. Secret 只允许直接录入 Supabase、Render 或 Resend 的受保护配置界面。
6. 不得替 Owner 作出批准；只收集证据并提交批准清单。
7. 任何生产健康检查、回调签名、备份恢复或 dry run 失败时，保持暂停并停止上线。
8. 不启用 OpenClaw mutation/import，不导入真实租客，除非另有明确批准。

## 阶段 0：代码与 Git 预检

1. 阅读 `HANDOFF.md`、`docs/OPERATIONS.md`、`docs/QA-REPORT.md`。
2. 审阅 dirty worktree，保留所有既有用户修改，不做宽泛回滚。
3. 运行并保存结果：

   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build
   pnpm test:e2e
   pnpm --dir integrations/openclaw test
   pnpm audit --prod
   ```

4. 确认 `render.yaml` 中：

   ```text
   REMINDERS_FORCE_PAUSED=true
   EMAIL_PROVIDER_MODE=disabled
   SMS_PROVIDER_MODE=disabled
   ```

5. 逐文件审阅后才允许创建受控部署提交并推送。不得提交 `.env.local` 或任何 Secret。

## 阶段 1：生产 Supabase

1. 在 Supabase 创建 West US (Oregon) 生产项目。
2. 关闭公开注册。
3. 按文件名顺序应用 `supabase/migrations` 的全部迁移。
4. Owner 在 Supabase Auth 创建首位管理员并启用 TOTP MFA。
5. 直接把以下值录入 Render Web 的 Secret 环境变量：

   ```text
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY
   ```

6. 在受控本地环境临时设置 `ADMIN_USER_ID`，运行：

   ```bash
   pnpm provision:supabase
   ```

7. 验证：

   - 管理员 profile 为 active；
   - Email 模板仍 disabled；
   - global reminders paused；
   - Draft/Public Storage bucket 权限正确；
   - 匿名用户不能读取 tenant、schedule、notification、audit 表。

## 阶段 2：Render Web 与 Cron

1. 使用 `render.yaml` 创建：

   - `tingting-real-estate` Web Service；
   - `tingting-reminder-cron` Cron Service。

2. Owner 生成不少于 24 字符的随机 `REMINDER_CRON_SECRET`，直接录入 Web 与
   Cron，两处必须完全相同。
3. 初次部署后记录 Render 自动域名：

   ```text
   https://<service>.onrender.com
   ```

4. Web 与 Cron 的 `APP_BASE_URL` 都设置为该 Render HTTPS Origin。
5. 保持：

   ```text
   EMAIL_PROVIDER_MODE=disabled
   SMS_PROVIDER_MODE=disabled
   REMINDERS_FORCE_PAUSED=true
   AUTOMATION_API_ENABLED=false
   AUTOMATION_MUTATIONS_ENABLED=false
   AUTOMATION_CONFIRMATIONS_ENABLED=false
   AUTOMATION_TENANT_IMPORT_ENABLED=false
   ```

6. 验证 `/api/health` 返回 `200`，且至少确认：

   ```text
   persistenceReady=true
   checks.database=ok
   checks.cronAuthentication=configured
   checks.publicBaseUrl=https
   ```

7. 观察至少两个连续五分钟 Cron 周期成功；此时不得 claim scheduled/manual
   事件。

## 阶段 3：Resend

1. 在 Resend 创建 API Key，只直接录入 Render Web 的 `RESEND_API_KEY`。
2. 使用已确认的发件域名；完成 Resend 要求的 DNS 验证后设置正式
   `EMAIL_FROM`。
3. 设置管理员确认的：

   ```text
   CONTACT_TO_EMAIL
   APPLICATION_TO_EMAIL
   ALERT_TO_EMAIL
   OWNER_NOTIFICATION_TO_EMAIL
   ```

   `APPLICATION_TO_EMAIL` 是受限的申请审核收件箱，接收完整申请详情和所有实体
   PDF/JPEG/PNG 附件；不要与公开咨询收件地址混为一谈。附件原始总量超过 25 MB
   时会拆成带编号的多封邮件。
   `OWNER_NOTIFICATION_TO_EMAIL` 接收每次租客上传成功通知和每周租客汇总。
   默认周一温哥华时间 09:00；如需调整，设置
   `OWNER_WEEKLY_SUMMARY_DAY`（1=周一，7=周日）及
   `OWNER_WEEKLY_SUMMARY_TIME`（24 小时制 `HH:mm`）。

4. 在 Resend 创建 Webhook：

   ```text
   POST https://<service>.onrender.com/api/webhooks/resend
   ```

5. 订阅 delivery、bounce、complaint 和 failure 事件。
6. 把 Webhook Signing Secret 直接录入 Render Web 的
   `RESEND_WEBHOOK_SECRET`。
7. 重新部署，确认 `/api/health` 仍为 `200`。

## 阶段 4：真实 Email dry run

1. Admin → Settings → Reminders 保存管理员本人确认的测试邮箱；测试手机号留空。
2. 保持两层提醒暂停。
3. 临时把 `EMAIL_PROVIDER_MODE=live`，保持 `SMS_PROVIDER_MODE=disabled`。
4. 在 Admin 使用 preview → confirm → queue 的测试发送流程。
5. Preview 必须显示管理员测试邮箱的脱敏目标，不得显示租客地址。
6. 等待 Render Cron 处理唯一的 `source=test` 事件。
7. 收集：

   - Resend message ID；
   - Render Cron 成功时间；
   - Resend Webhook 的 HTTP 2xx；
   - 签名验证成功；
   - Delivery History 的 `sent`/`delivered`；
   - 审计记录；
   - 管理员实际收到邮件的确认；
   - 测试期间两层暂停及 `SMS_PROVIDER_MODE=disabled` 的证据。

8. 对 `failed`、`bounced`、`complained`、`unknown` 或签名错误必须停止并修复。
9. 使用纯测试资料提交一份非生产租赁申请，确认 `APPLICATION_TO_EMAIL` 收到排版
   完整的申请详情、全部实体附件、必要时的分封编号，以及对应的 durable delivery
   和 Resend signed callback。附件仍为待安全审核，只能在批准设备上打开。

## 阶段 5：生产加密备份与恢复

1. 在可信工作站对生产数据库执行 PostgreSQL custom-format 逻辑导出。
2. 使用 AES-256-CBC、PBKDF2 和至少 200000 iterations 加密。
3. 只把加密文件保存到 Owner 批准的异地存储；口令单独存入 Owner 密码管理器。
4. 解密到临时文件并恢复到全新的非生产 PostgreSQL/Supabase 项目。
5. 验证：

   - 核心表数量；
   - public views；
   - active admin profile；
   - 必需函数；
   - global reminders paused；
   - Email/SMS provider disabled；
   - paused mock worker。

6. 验证完成后精确删除本地明文 dump 和临时恢复文件，不删除加密备份。
7. 保存恢复时间、RPO/RTO、验证结果和执行人证据，不记录 Secret。

## 阶段 6：Owner 批准

向 Owner 提交以下清单，等待 Owner 本人明确书面批准：

- Render URL 和部署版本；
- Supabase/Render 健康状态；
- 两次连续 Cron 成功证据；
- 管理员测试邮箱确认；
- Resend dry run 与 signed callback；
- 最终 Email 模板和发件身份；
- 租客 eligibility/收件范围；
- 手工 batch preview；
- 数据保留期；
- 生产备份恢复演练；
- SMS 仍 disabled；
- 最终域名是否已经批准。

在收到批准前，不得设置 `REMINDERS_FORCE_PAUSED=false`，不得在 Admin 解除
global pause。

## 阶段 7：最终域名（仅在 Render 域名测试全部通过后）

1. Owner 明确提供并批准最终域名。
2. 在 Render 添加自定义域名，按 Render 返回值配置 DNS。
3. 等待 DNS 与 TLS 验证成功。
4. 把 Web 与 Cron 的 `APP_BASE_URL` 更新为最终 HTTPS Origin。
5. 在 Resend 把 Webhook 更新为：

   ```text
   POST https://<final-domain>/api/webhooks/resend
   ```

6. 重新部署并重复：

   - `/api/health`；
   - Admin Cookie/TOTP 登录；
   - 公网页面；
   - 两次 Cron；
   - 管理员 Email dry run；
   - Resend 签名回调；
   - Core Web Vitals 基线。

7. 只有最终域名证据也通过且 Owner 再次批准后，才允许解除 force pause 和
   global pause。解除后仍保持 `SMS_PROVIDER_MODE=disabled`。

## 完成定义

只有以下条件全部满足才可声明 Email-only 生产上线完成：

- 生产 Supabase 和 Render 可用；
- Render 域名或最终批准域名的健康检查通过；
- Resend 发件身份和 signed callback 通过；
- 真实邮件只投递到管理员测试邮箱；
- Cron 在暂停状态下稳定运行；
- 生产加密备份成功恢复；
- Owner 明确批准；
- 两层暂停按批准顺序解除；
- SMS/Twilio 始终 disabled；
- 没有 Secret、完整目标地址或邮件正文泄漏到 Git/日志/证据。
