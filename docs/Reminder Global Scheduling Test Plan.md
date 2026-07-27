# Reminder 全局排程测试计划

**状态：** Planned，随全局 Reminder 改造逐步落地  
**更新日期：** 2026-07-27  
**适用范围：** 日期计算、Reminder settings、Tenant details、派生排程、Test email、worker、数据库迁移、OpenClaw 兼容和上线验收  
**关联方案：** [Reminder Global Scheduling Change Plan](./Reminder%20Global%20Scheduling%20Change%20Plan.md)

## 1. 测试目标

这份测试计划验证以下结果：

1. `Payment due date` 是唯一的租客级排程输入。
2. 提前天数、发送时间和 Email template 只在 `Reminder settings` 配置。
3. `Tenant & reminder` 只有一个 `Tenant details` tab，不再保存租客级 reminder plan。
4. 下一封邮件时间和邮件中的租金到期日由同一次日期计算返回。
5. 所有 active 且 Email eligible 的租客默认进入自动提醒。
6. 修改普通租客资料不会重算或跳过已经到期的 reminder。
7. 修改全局 timing 会安全重算未来 reminder，但不会跳过已经到期的 reminder。
8. 修改全局 Email template 不改变 `nextRunAt`。
9. Test email 的预览、确认和实际记录使用同一 template 与 `dueDate`。
10. Memory repository、Supabase RPC、worker、Admin preview 和 Automation API 结果一致。

## 2. 当前状态与测试落地原则

当前代码仍使用租客级 `dayOfMonth`、`localTime`、`emailTemplateId` 和 `isEnabled`。因此本文中的目标用例需要随实现同步新增或替换，不能把当前测试通过解释为新规则已经完成。

已有测试入口：

| 层级 | 当前入口 |
|---|---|
| Vitest | `tests/unit/`、`tests/integration/` |
| Memory Playwright | `tests/e2e/application.spec.ts` |
| Supabase Playwright | `tests/e2e-supabase/production-writes.spec.ts` |
| SQL behavior | `tests/sql/migration-behavior.sql` |
| OpenClaw | `integrations/openclaw/tests/` |

测试实施规则：

- 日期测试使用固定 `afterInstant`，不依赖执行当天日期。
- TypeScript 和 SQL 使用同一组日期向量。
- E2E 等待具体 response、状态或 locator，不使用固定 `waitForTimeout`。
- 测试邮件只发送到管理员测试地址，并保持 provider 为 `mock`。
- Supabase E2E 只能连接本地 Supabase 或专用测试项目。
- 生产上线前保持 `REMINDERS_FORCE_PAUSED=true`。

## 3. 不在本次测试范围

- One-time email。
- 多阶段 reminder，例如到期前 7 天、3 天和当天分别发送。
- SMS reminder UI。
- `moveInDate` 决定首月租金或第一封 reminder。
- 真实 Resend 发送和真实收件箱 deliverability。
- Cron 频率和 provider retry 策略的重新设计。
- OpenClaw 修改全局 Reminder settings。

现有去重、pause、24 小时保护、provider feedback 和 retry 必须做回归测试，但本次不改变它们的产品规则。

## 4. 质量风险与优先级

| 优先级 | 风险 | 必须验证的结果 |
|---|---|---|
| P0 | 邮件提醒了错误月份的租金 | `nextRunAt` 和 `dueDate` 必须来自同一 occurrence |
| P0 | 修改全局 timing 跳过已到期邮件 | `next_run_at <= now()` 的记录保持不变 |
| P0 | 保存 notes 等资料把邮件推到下个月 | 非 `Payment due date` 字段不改变 `nextRunAt` |
| P0 | Test preview 与实际测试邮件内容不同 | preview token 绑定 template、tenant、due date 和 render snapshot |
| P0 | 重复 Cron 发送两封相同邮件 | occurrence key 唯一约束继续生效 |
| P0 | 被归档、退订或 blocked tenant 收到邮件 | worker materialize 和发送前都重新检查 eligibility |
| P0 | 数据迁移后租客停止排程 | 所有 eligible tenants 都生成正确派生排程 |
| P1 | 全局 template 无效 | settings 保存和 worker 两层拒绝 inactive、SMS 或无 revision template |
| P1 | 月底或 DST 算错 | TypeScript 和 SQL 使用相同向量并得到相同 UTC |
| P1 | Tenant UI 仍提交旧 schedule 字段 | Tenant request 不包含旧字段，也不调用 `/schedule` |
| P1 | 旧 OpenClaw 客户端静默覆盖全局规则 | 冲突 write 返回 `GLOBAL_REMINDER_POLICY` |
| P1 | 设置并发覆盖 | 旧 `expectedVersion` 返回 version conflict |
| P2 | 文案或响应式布局不清楚 | Desktop、mobile 和 accessibility 通过 |

任何 P0 失败都阻止解除 reminder pause。

## 5. 测试分层

| 层级 | 工具 | 目标 | 建议位置 |
|---|---|---|---|
| 日期领域测试 | Vitest | due date、lead days、月底、DST、catch-up | `tests/unit/reminder-occurrence.test.ts` |
| Schema/API 测试 | Vitest | 全局设置和 tenant payload validation | `tests/unit/reminder-settings.test.ts` |
| Memory repository | Vitest | 重算、保留、eligibility、worker | `tests/unit/reminder-global-flow.test.ts` |
| SQL behavior | PostgreSQL | migration、RPC、事务、worker、去重 | `tests/sql/migration-behavior.sql` |
| RLS integration | Vitest + Supabase | settings、schedule、event 私有访问 | `tests/integration/supabase-rls.test.ts` |
| Memory E2E | Playwright | Admin UI、Test email、responsive、a11y | `tests/e2e/application.spec.ts` 或独立 spec |
| Supabase E2E | Playwright | 真实 RPC、Auth、Audit、Cron、event | `tests/e2e-supabase/production-writes.spec.ts` |
| Automation compatibility | Vitest/Node | v1 read、legacy write error、OpenAPI | `tests/unit/automation-api.test.ts`、`integrations/openclaw/tests/` |
| Manual acceptance | Chrome | Owner 最终确认 | 本文第 17 节 |

## 6. 测试环境与命令

### 6.1 每次 PR

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm --dir integrations/openclaw test
```

### 6.2 Memory-mode Playwright

```bash
pnpm test:e2e
```

当前配置：

- URL：`http://127.0.0.1:3200`
- Backend：memory
- Browser：Desktop Chrome
- Email provider：mock
- `REMINDERS_FORCE_PAUSED=true`
- 失败时保留 trace 和 screenshot

### 6.3 Supabase E2E

```bash
E2E_SUPABASE_TEST_PROJECT_CONFIRMED=true pnpm test:e2e:supabase
```

必需环境变量：

```text
TEST_SUPABASE_URL
TEST_SUPABASE_ANON_KEY
TEST_SUPABASE_SERVICE_ROLE_KEY
TEST_ADMIN_EMAIL
TEST_ADMIN_PASSWORD
TEST_ADMIN_TOTP_SECRET
E2E_SUPABASE_TEST_PROJECT_CONFIRMED=true
```

安全要求：

- `TEST_SUPABASE_URL` 不得等于 `PRODUCTION_SUPABASE_URL`。
- 测试服务器必须运行在 `127.0.0.1` 或 `localhost`。
- Email provider 必须是 `mock`。
- 测试数据使用 `.test` Email 和明确的 test 标记。
- 清理只能使用本次测试创建的明确 ID。

### 6.4 SQL migration behavior

必须验证：

1. 空 PostgreSQL 17 数据库依次应用全部 migrations。
2. 包含 legacy tenant schedules 的旧数据库升级到新 migration。
3. 执行 `tests/sql/migration-behavior.sql`。
4. SQL suite 遇到任意错误立即停止。

不要对生产数据库执行 migration behavior test。

## 7. 标准测试数据

### DATA-01：跨月租客

```text
Tenant: Alex Cross-Month
Email: alex-cross-month@example.test
Status: active
Email eligibility: allowed
Payment due date: day 1
Global lead days: 3
Global send time: 09:00
Timezone: America/Vancouver
Expected send: July 29, 2026 09:00 PDT
Expected due date: August 1, 2026
Expected UTC: 2026-07-29T16:00:00Z
```

### DATA-02：同月租客

```text
Tenant: Bailey Same-Month
Email: bailey-same-month@example.test
Status: active
Email eligibility: allowed
Payment due date: day 15
Global lead days: 3
Global send time: 09:00
Expected send: August 12, 2026 09:00 PDT
Expected due date: August 15, 2026
```

### DATA-03：月底租客

```text
Tenant: Casey Month-End
Payment due date: day 31
Global lead days: 3
Global send time: 09:00
Expected February 2027 due date: February 28
Expected send date: February 25
```

### DATA-04：Email blocked

```text
Tenant: Drew Blocked
Status: active
Email: drew-blocked@example.test
Email eligibility: opted_out
Payment due date: day 1
Expected: no scheduled email event
```

### DATA-05：Archived tenant

```text
Tenant: Erin Archived
Status: archived
Email eligibility: allowed
Payment due date: day 1
Expected: no scheduled email event
```

### DATA-06：Templates

创建：

1. Active Email template A，包含 `{{tenant_name}}`、`{{property}}` 和 `{{due_date}}`。
2. Active Email template B，使用不同 subject 和 body。
3. Inactive Email template。
4. Active SMS template。
5. Active Email template without current revision fixture，仅在数据库测试构造。

## 8. 共享日期向量

TypeScript 和 SQL 必须共享以下输入与预期。建议把 JSON fixture 放在 `tests/fixtures/reminder-occurrences.json`，两端测试都从同一份数据生成断言。

| ID | afterInstant | Due day | Lead | Local time | Expected send local | Expected UTC | Expected due |
|---|---|---:|---:|---|---|---|---|
| DATE-001 | `2026-07-27T20:00:00Z` | 1 | 3 | `09:00` | `2026-07-29 09:00` | `2026-07-29T16:00:00Z` | `2026-08-01` |
| DATE-002 | `2026-08-02T00:00:00Z` | 1 | 3 | `09:00` | `2026-08-29 09:00` | `2026-08-29T16:00:00Z` | `2026-09-01` |
| DATE-003 | `2026-08-01T00:00:00Z` | 15 | 3 | `09:00` | `2026-08-12 09:00` | `2026-08-12T16:00:00Z` | `2026-08-15` |
| DATE-004 | `2027-02-01T00:00:00Z` | 31 | 3 | `09:00` | `2027-02-25 09:00` | `2027-02-25T17:00:00Z` | `2027-02-28` |
| DATE-005 | `2028-02-01T00:00:00Z` | 31 | 3 | `09:00` | `2028-02-26 09:00` | `2028-02-26T17:00:00Z` | `2028-02-29` |
| DATE-006 | `2026-07-27T20:00:00Z` | 1 | 0 | `09:00` | `2026-08-01 09:00` | `2026-08-01T16:00:00Z` | `2026-08-01` |
| DATE-007 | `2026-06-30T20:00:00Z` | 1 | 31 | `09:00` | `2026-07-01 09:00` | `2026-07-01T16:00:00Z` | `2026-08-01` |
| DATE-008 | `2026-03-01T00:00:00Z` | 10 | 2 | `02:30` | `2026-03-08 03:30` | `2026-03-08T10:30:00Z` | `2026-03-10` |
| DATE-009 | `2026-10-15T00:00:00Z` | 3 | 2 | `01:30` | `2026-11-01 01:30` earlier occurrence | `2026-11-01T08:30:00Z` | `2026-11-03` |

额外边界：

- `rentDueDay`：0、32、非整数。
- `leadDays`：-1、32、非整数。
- `localTime`：空值、`9:00`、`24:00`、`09:60`。
- timezone：无效 IANA 值。
- `afterInstant`：无效 timestamp。

## 9. 日期领域测试

目标文件：

```text
tests/unit/reminder-occurrence.test.ts
src/features/reminders/scheduler.ts
src/features/reminders/due-date.ts
```

### SCH-001：一次返回发送时间和到期日

输入 DATE-001。

预期：

```json
{
  "nextRunAt": "2026-07-29T16:00:00Z",
  "sendLocalDate": "2026-07-29",
  "dueDate": "2026-08-01"
}
```

### SCH-002：跨月关系正确

输入 due day 1、lead 3。

预期：

- 发送日期在前一个月。
- 邮件中的 due date 仍是下一月 1 日。
- 不允许再从发送日期独立调用“最近租金日”得到其他月份。

### SCH-003：短月份截断

对 due day 29、30、31 分别覆盖：

- 2027 年 2 月。
- 2028 年 2 月。
- 30 天月份。

预期 due date 使用该月最后一天，然后再减 lead days。

### SCH-004：DST spring-forward

使用 DATE-008。

预期不存在的 `02:30` 按现有 compatible 规则移动到下一个有效时间，结果是 `03:30 PDT`。

### SCH-005：DST fall-back

使用 DATE-009。

预期重复的 `01:30` 使用较早 occurrence，即 `08:30Z`。

### SCH-006：错过发送时间但未过 due date

```text
Now: July 30, 2026 10:00 PDT
Normal send: July 29, 2026 09:00 PDT
Due: August 1, 2026
```

预期：

- tenant 立即 eligible。
- `dueDate = 2026-08-01`。
- Admin 状态显示 `Send as soon as the reminder worker runs`。

### SCH-007：due date 已过

```text
Now: August 2, 2026
Due day: 1
Lead days: 3
```

预期下一封为 August 29，提醒 September 1。

### SCH-008：确定性

相同输入调用 100 次，返回完全相同。函数不得读取隐藏的系统当前时间。

## 10. Reminder settings 测试

目标接口：

```text
GET /api/admin/settings/reminders
PATCH /api/admin/settings/reminders
```

### SET-001：读取完整设置

响应必须包含：

```text
paused
leadDays
localTime
timezone
emailTemplateId
updatedAt
```

不得包含派生的 per-tenant override。

### SET-002：保存有效设置

保存 lead 3、09:00、active Email template A。

预期：

- 返回保存后的完整设置。
- 写入 audit event。
- 返回 `recalculatedTenants` 和 `preservedDueTenants`。
- API 文案不能暗示邮件已经发送。

### SET-003：字段验证

分别提交：

- lead days -1、32、1.5；
- 无效时间；
- 无效 timezone；
- 不存在的 template UUID；
- inactive Email template；
- SMS template；
- Email template without current revision；
- 未知额外字段。

预期 400，错误定位到具体字段，不改变数据库。

### SET-004：版本冲突

1. GET version A。
2. 使用 version A 保存得到 version B。
3. 再使用 version A 保存。

预期：

- 第三次返回 409 version conflict。
- 设置保持 version B 的值。
- 不发生第二次排程重算。

### SET-005：timing 变化重算未来 reminder

修改 `leadDays` 或 `localTime`。

预期：

- 尚未到期的 eligible tenant 全部重算。
- archived、inactive 或 Email blocked tenant 不生成可发送排程。
- 结果使用同一 global setting version。

### SET-006：保留已到期 reminder

在保存设置前构造 `next_run_at <= now()`。

预期：

- 该 `next_run_at` 原值不变。
- `preservedDueTenants` 增加。
- worker 后续先处理当前 occurrence。

### SET-007：只修改 Email template

从 template A 改成 template B。

预期：

- 所有 `nextRunAt` 保持原值。
- 尚未 materialize 的未来 event 使用 B。
- 已 materialize event 保留 A 的 template revision 和 rendered content。

### SET-008：事务回滚

在重算中制造数据库错误。

预期 settings、派生排程和 audit event 全部不变。

## 11. Tenant details 与派生排程测试

### TEN-001：新增 active tenant

Tenant payload 包含 `rentDueDay`，不包含 schedule fields。

预期：

- tenant 和派生排程在同一业务操作中成功。
- 使用全局 lead days、time、timezone 和 template。
- 默认进入 reminder eligibility，不需要 tenant consent toggle。

### TEN-002：拒绝旧 schedule 字段

Tenant endpoint 提交以下任意字段：

```text
dayOfMonth
localTime
timezone
channels
emailTemplateId
smsTemplateId
isEnabled
```

预期 strict schema 返回 400，不能静默保存租客级例外。

### TEN-003：修改 Payment due date

把 due day 1 改为 15。

预期：

- 重新计算 `nextRunAt`。
- 新 occurrence 的 `dueDate` 为 15 日。
- audit metadata 记录 due day 变化。

### TEN-004：普通资料保存不重算

分别修改：

- 姓名；
- property；
- unit；
- phone；
- notes；
- move-in date。

预期每次保存后 `nextRunAt` 完全相同。

### TEN-005：相同值重复保存

连续两次保存相同 tenant payload。

预期：

- `nextRunAt` 不变。
- 不重复创建 schedule row。
- 不产生重复 notification event。

### TEN-006：归档

归档 tenant。

预期：

- 后续 worker 不创建 scheduled email。
- 已 materialize 但未发送的 event 在发送前 eligibility recheck 中 skipped。
- 不删除历史 Email activity。

### TEN-007：Email eligibility

覆盖：

```text
allowed
unconfirmed
opted_out
bounced
complained
missing email
invalid email
```

只有 `allowed` 且 Email 有效时可以创建可发送 scheduled event。

### TEN-008：恢复 eligibility

blocked tenant 恢复 allowed。

预期：

- 如果计划发送时间未到，安排正常时间。
- 如果发送时间已过但 due date 未过，立即 eligible。
- 如果 due date 已过，安排下一期。

## 12. Worker 与 notification event 测试

### WRK-001：正确 materialize

运行 worker 处理 DATA-01。

预期 event 冻结：

```text
sendLocalDate = 2026-07-29
dueDate = 2026-08-01
leadDays = 3
localTime = 09:00
emailTemplateId = global template A
templateRevisionId = A current revision
destination = tenant email
rendered subject/body
```

`{{due_date}}` 必须渲染为 August 1, 2026。

### WRK-002：重复 worker 去重

对同一个 occurrence 并行或顺序运行 worker 至少两次。

预期：

- 只存在一个 occurrence key。
- 只创建一个 scheduled event。
- 不重复推进 `nextRunAt`。

### WRK-003：全局 pause

`paused=true` 时运行 worker。

预期：

- 返回 paused。
- 不创建 event。
- 不推进派生排程。

### WRK-004：deployment force pause

`REMINDERS_FORCE_PAUSED=true` 时，即使数据库 `paused=false`：

- 自动 reminder 不 materialize。
- 已确认 Test email 仍按现有专用规则由 mock provider 处理。
- 不允许真实自动邮件离开系统。

### WRK-005：24 小时保护

把 `next_run_at` 设置为 25 小时前。

预期：

- 创建 `expired` activity。
- `render_error_code = occurrence_outside_grace_period`。
- destination 不被写入可发送 outbox。

### WRK-006：template 在保存后失效

保存全局 template A 后将其停用或改变 channel，再运行 worker。

预期：

- 不发送。
- 创建明确 skipped activity。
- Email activity 显示安全错误码。
- 不允许静默跳到下个月。

### WRK-007：发送前 eligibility 改变

materialize 后、provider claim 前把 tenant 归档或标记 opted out。

预期：

- provider 不被调用。
- event 变为 skipped。
- 历史记录保留。

### WRK-008：冻结已 materialize event

materialize 使用 template A 后，将全局设置改为 template B、不同 lead days 和 time。

预期原 event 的：

- `scheduledFor` 不变；
- `dueDate` 不变；
- template revision 不变；
- rendered content 不变；
- destination snapshot 不变。

下一期才使用新设置。

### WRK-009：推进下一期

当前 occurrence 成功 materialize 后：

- `nextRunAt` 指向下一期对应 send date。
- 下一期 `dueDate` 正确。
- 月底截断不会累计漂移。

## 13. Test email 测试

目标接口：

```text
POST /api/admin/notifications/test-preview
POST /api/admin/notifications/test
```

### TST-001：使用全局表单配置

Test email preview 使用：

- Reminder settings 当前表单的 lead days；
- 当前表单的 local time；
- 当前表单选择的 Email template；
- sample tenant 的 `Payment due date`。

不需要先保存设置。

### TST-002：没有第二个 template selector

Reminder settings 页面只能看到全局 Email template selector。Test email section 不再显示另一个 template selector。

### TST-003：正确 due date

使用 DATA-01。

预期 preview subject/body 显示 August 1, 2026，不是 July 1 或 September 1。

### TST-004：管理员测试地址隔离

预期：

- event destination 是保存的 Admin test email。
- tenant email 不作为 test event destination。
- UI 和 API 只返回 masked destination。

### TST-005：preview confirmation 绑定

Preview token 至少绑定：

```text
actorId
tenantId
requestId
templateId
templateRevisionId
dueDate
rendered content digest 或等价 immutable snapshot
expiresAt
```

篡改任意字段、使用其他管理员、其他 tenant、其他 template 或过期 token 都返回 `TEST_PREVIEW_REQUIRED`。

### TST-006：preview 与 send 一致

创建 preview 后修改尚未保存的表单值，再使用旧 preview token 发送。

预期：

- 发送旧 preview 冻结的内容，或要求重新 preview。
- 绝不能显示 A、实际发送 B。

### TST-007：幂等

使用相同 `requestId` 和 preview token 重复提交。

预期只创建一个 test event。

### TST-008：无测试地址

未配置 Admin test email 时：

- preview 或 send 返回明确错误。
- 不创建 event。

## 14. Admin Playwright 测试

### ADM-001：Reminder settings 控件

页面显示：

```text
Send rent reminders [N] days before payment is due
Send at
Email template
Save reminder settings
```

### ADM-002：保存确认

保存前 dialog 必须说明：

- 受影响的 active tenant 数量；
- 新 lead days；
- 新 send time；
- 已到期邮件不会被跳过；
- 保存不等于已经发送。

### ADM-003：错误状态

无效 lead days、time、template 和 version conflict：

- 显示清晰错误。
- 保留用户输入。
- focus 移到首个错误控件或错误摘要。

### ADM-004：Tenant details 单 tab

Tenant create/edit 页面：

- 只有 `Tenant details` tab。
- 包含 `Payment due date`。
- 不出现 Reminder tab。
- 不出现 reminder day、send time、template 或 automatic toggle。
- 提交按钮为 `Save tenant`。

### ADM-005：Tenant 保存网络请求

保存 tenant 时：

- 只发送 tenant create/update request。
- request 包含 `rentDueDay`。
- 不调用 `/api/admin/tenants/:id/schedule`。
- payload 不包含旧 schedule fields。

### ADM-006：只读日期成对显示

如果 UI 显示 reminder 状态：

```text
Next automatic email: July 29, 2026 at 9:00 AM
Payment due: August 1, 2026
```

两项必须来自同一 API response。

### ADM-007：Test email 流程

1. 保存 Admin test email。
2. 在全局设置选择 template A。
3. 选择 DATA-01 作为 sample tenant。
4. Preview。
5. 确认 masked destination、subject、body 和 due date。
6. Send test email。
7. 在 Email activity 验证 source 为 `test`。

### ADM-008：Pause

- Pause 保留所有派生排程。
- Resume 使用 catch-up 规则。
- deployment force pause 时 UI 清楚说明仍不能真实发送。

### ADM-009：Responsive

在以下 viewport 检查没有横向 overflow：

```text
375 × 812
768 × 1024
1440 × 900
```

### ADM-010：Accessibility

使用现有 Axe 配置验证：

- labels；
- keyboard navigation；
- focus order；
- dialog focus；
- error announcement；
- WCAG A/AA serious violations 为 0。

## 15. SQL migration 与 Supabase 测试

### SQL-001：全局设置 backfill

Migration 后 `system_settings.key = 'reminders'` 包含：

```text
paused
leadDays
localTime
timezone
emailTemplateId
```

默认 template 必须由明确 owner 选择或保持系统 paused。Migration 不得自动选择不确定的 template。

### SQL-002：legacy schedule 升级

准备多个 tenant，各自拥有不同旧 send day、time 和 template。

升级后：

- tenant `rent_due_day` 保留。
- 不创建租客级 timing/template override。
- 所有 eligible tenant 使用同一全局配置。
- archived 和 blocked tenant 不成为可发送对象。

### SQL-003：空库路径

空数据库应用全部 migration 后：

- schema、constraints 和 functions 存在。
- seed/provision 保持 reminders paused。
- 没有 orphan schedule。

### SQL-004：日期函数 parity

SQL `next_reminder_occurrence` 对第 8 节全部向量返回与 TypeScript 完全相同的 UTC 和 due date。

### SQL-005：原子保存设置

验证 setting update、future recalculation、due preservation 和 audit 在同一 transaction。

### SQL-006：唯一性和幂等

- 每个 tenant 最多一个派生 schedule row。
- occurrence key 保持唯一。
- 重复 reconciliation 不创建重复 row。

### SQL-007：RLS 与 grants

Anon 和普通 authenticated client 不能读取或修改：

```text
system_settings
tenants
reminder_schedules
notification_events
audit_events
```

新的 security-definer function 只能授予 service role 或明确的后台调用路径。

### SQL-008：Dashboard 和 reconciliation

Dashboard 的 enabled/eligible count、due next seven days 和 warnings 使用新全局规则，不再读取 deprecated `is_enabled`。

Daily reconciliation：

- 补齐 missing derived schedule。
- 修复错误 future `next_run_at`。
- 不改变已经 due 的 `next_run_at`。

## 16. OpenClaw 与 legacy compatibility

### AUT-001：Tenant API 保留 due day

OpenClaw tenant create/update 继续接受 `rentDueDay`，并返回派生 reminder 状态。

### AUT-002：Schedule read-only projection

Legacy schedule read 返回：

```text
effectiveLeadDays
effectiveLocalTime
effectiveEmailTemplateId
nextRunAt
nextDueDate
readOnly = true
```

### AUT-003：冲突 legacy write

旧客户端提交不同的 day、time、template 或 channel。

预期：

- 返回 `GLOBAL_REMINDER_POLICY`。
- 不静默忽略。
- 不修改 tenant 或全局 settings。

### AUT-004：禁止修改全局 settings

Automation service account 无论 scope 如何，都不能 PATCH Admin Reminder settings。

### AUT-005：Import compatibility

Legacy CSV 含 reminder day/time/template columns：

- 返回 deprecated warning 或明确 migration error。
- `rent_due_day` 仍可导入。
- 不创建 per-tenant override。

### AUT-006：OpenAPI 和 schema

- OpenAPI 3.1 validation 通过。
- JSON schema 与 runtime validation 一致。
- 示例不再展示租客级 time/template/toggle。
- OpenClaw fake-server 和 policy tests 通过。

## 17. Manual acceptance

在 mock provider 和 force pause 环境执行：

- [ ] Reminder settings 只有一套 lead days、send time 和 Email template。
- [ ] Test email 区域没有第二个 template selector。
- [ ] Tenant 页面只有一个 `Tenant details` tab。
- [ ] Tenant details 包含 `Payment due date`。
- [ ] Tenant 页面没有 reminder day、send time、template 或 consent toggle。
- [ ] 创建 due day 1 的 tenant 后，页面成对显示正确 send date 与 due date。
- [ ] 修改 notes 后 `Next automatic email` 不变。
- [ ] 修改 Payment due date 后两项日期一起更新。
- [ ] 修改全局 lead days 后 future tenant dates 一起更新。
- [ ] 修改全局 template 后发送时间不变。
- [ ] Test preview 显示正确 due date，并只发往 masked Admin test email。
- [ ] Pause 后 Cron 不创建 automatic event。
- [ ] Email activity 显示 test、scheduled、skipped 和 expired 的正确来源与原因。
- [ ] Mobile 页面没有横向 overflow。
- [ ] Keyboard 和 screen-reader labels 可用。

## 18. 上线前 dry run

保持：

```text
REMINDERS_FORCE_PAUSED=true
EMAIL_PROVIDER_MODE=mock
```

执行：

1. 应用 migration。
2. 确认全局 settings 完整且 paused。
3. 记录 eligible tenant 数量。
4. 运行 reconciliation。
5. 比较派生 schedule 数量与 eligible tenant 数量。
6. 检查 `nextRunAt` 与 `nextDueDate` 抽样。
7. 对 due day 1、15、28、29、30、31 各抽样。
8. 运行两个 Cron 周期。
9. 确认没有 automatic real delivery。
10. 发送并确认一封 mock Test email。
11. 检查 Email activity、audit 和 worker summary。

在解除 pause 前必须保存：

- migration output；
- SQL behavior output；
- unit 和 E2E results；
- 抽样 tenant 日期表；
- Cron 两个周期结果；
- Test email activity ID；
- owner approval。

## 19. CI 与执行顺序

### 每次实现提交

优先执行：

```bash
pnpm typecheck
pnpm test
```

### 每次 PR

执行完整本地 gate：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm --dir integrations/openclaw test
```

### 涉及 migration、RPC、worker 或 Auth

额外执行：

```bash
E2E_SUPABASE_TEST_PROJECT_CONFIRMED=true pnpm test:e2e:supabase
```

并执行 SQL migration behavior suite。

### Flaky 检查

对 reminder browser spec 重复三次：

```bash
pnpm exec playwright test tests/e2e/reminder-global-settings.spec.ts --repeat-each=3
```

如果最终选择继续放在 `application.spec.ts`，将命令中的文件名替换为实际 spec。

不允许：

- 用 `waitForTimeout` 掩盖 race。
- 因为偶发失败直接增加全局 timeout。
- 跳过 P0 测试后合并。

## 20. Release Exit Criteria

解除 reminder pause 前必须同时满足：

- [ ] 所有 P0 测试通过。
- [ ] 所有 P1 测试通过，或有 owner 书面接受的非发布阻塞问题。
- [ ] 第 8 节 TypeScript/SQL 日期向量 100% 一致。
- [ ] 空库和 legacy upgrade migration path 都通过。
- [ ] Memory 和 Supabase repository 行为一致。
- [ ] Test preview 与 send snapshot binding 通过。
- [ ] Worker duplicate、pause、24 小时和 eligibility 回归通过。
- [ ] OpenClaw compatibility 和 OpenAPI validation 通过。
- [ ] Admin responsive 和 accessibility 通过。
- [ ] 两个 paused Cron 周期没有异常。
- [ ] Manual acceptance 完成。
- [ ] 没有未解释的 flaky 或 skipped P0 test。

## 21. 测试报告模板

```markdown
# Reminder Global Scheduling Test Report

**Build/commit:**
**Environment:**
**Date:**
**Tester:**
**Status:** PASS / FAIL / BLOCKED

## Summary

- Total:
- Passed:
- Failed:
- Skipped:
- Flaky:

## P0 Gate

| Test ID | Result | Evidence |
|---|---|---|
| SCH-001 Send/due pairing | | |
| SET-006 Preserve due reminder | | |
| TEN-004 Tenant-only save stability | | |
| WRK-002 Worker deduplication | | |
| WRK-007 Eligibility recheck | | |
| TST-006 Preview/send consistency | | |
| SQL-002 Legacy upgrade | | |

## Date parity

- TypeScript vectors:
- SQL vectors:
- Mismatches:

## Failures

### Test ID

- Expected:
- Actual:
- Reproduction:
- Screenshot/trace/log:
- Recommended owner:

## Dry run

- Eligible tenants:
- Derived schedules:
- Preserved due reminders:
- Recalculated future reminders:
- Cron run IDs:
- Test event ID:

## Artifacts

- Vitest output:
- Playwright report:
- Trace:
- Screenshots:
- SQL output:
- Supabase logs:
- Audit evidence:
```

## 22. Requirement Traceability

| Requirement | Primary tests |
|---|---|
| Global lead days | DATE-001–009, SET-002–006 |
| Global send time | SCH-004–005, SET-005, ADM-001 |
| Global Email template | SET-003, SET-007, WRK-006, TST-001 |
| Tenant details single tab | ADM-004–005 |
| Payment due date tenant field | TEN-001–003, ADM-004 |
| Default tenant eligibility | TEN-001, TEN-007–008 |
| Send date and due date pairing | SCH-001–007, WRK-001, TST-003 |
| Preserve due reminders | SET-006, SQL-005 |
| Tenant save stability | TEN-004–005 |
| Test preview/send consistency | TST-005–007 |
| Worker safety and dedupe | WRK-002–008 |
| Migration | SQL-001–006 |
| RLS and grants | SQL-007 |
| OpenClaw compatibility | AUT-001–006 |
| Responsive and accessibility | ADM-009–010 |
| Safe rollout | 第 18–20 节 |

## 23. 预计修改的测试文件

新增：

```text
tests/fixtures/reminder-occurrences.json
tests/unit/reminder-occurrence.test.ts
tests/unit/reminder-settings.test.ts
tests/unit/reminder-global-flow.test.ts
tests/e2e/reminder-global-settings.spec.ts
```

更新：

```text
tests/unit/scheduler.test.ts
tests/unit/due-date.test.ts
tests/unit/test-send-preview.test.ts
tests/unit/notification-flow.test.ts
tests/unit/automation-api.test.ts
tests/unit/automation-confirmations.test.ts
tests/unit/automation-imports.test.ts
tests/integration/supabase-rls.test.ts
tests/e2e/application.spec.ts
tests/e2e-supabase/production-writes.spec.ts
tests/sql/migration-behavior.sql
integrations/openclaw/tests/fake-server.test.mjs
integrations/openclaw/tests/skill-policy.test.mjs
```

如果测试按责任拆分到新 spec，必须删除或改写旧的租客级 schedule 断言，避免两套互相矛盾的测试同时存在。
