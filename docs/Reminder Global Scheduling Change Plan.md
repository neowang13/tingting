# Reminder 全局排程改造方案

状态：Proposed  
目标分支：`main`  
更新日期：2026-07-27

本方案批准后取代现有 PRD、Engineering Spec、UI design 和 OpenClaw 文档中“每个租客拥有独立 reminder schedule”的描述。实施时必须同步更新这些文档，不能长期保留两套互相冲突的产品规则。

## 1. 决策摘要

当前系统让管理员分别设置：

- `Payment due day`：每月几号交租；
- `Send the reminder on day`：每月几号发送提醒；
- 每个租客自己的发送时间和 Email template。

两个日期彼此独立，发送时间和模板又散落在每个租客表单中。管理员可能把发送日设在交租日之后，导致页面显示的下一次交租日期与邮件实际提醒的交租日期不一致，也难以一次调整全部租客。

本次改造将发送日期改为从交租日期自动推导，并将发送时间和 Email template 一起集中到 `Reminder settings`：

```text
Reminder send date = Payment due date - Reminder lead days
```

产品规则：

1. 移除租客级 reminder 配置，不再让每个租客单独选择发送日期、发送时间或 Email template。
2. 在 `Reminder settings` 统一设置：
   - `Send rent reminders [N] days before payment is due`；
   - `Send at [HH:mm]`；
   - `Email template`。
3. 建议默认 `N = 3`，允许范围为 `0–31`：
   - `0` 表示交租当天发送；
   - `3` 表示提前三天发送。
4. `Tenant & reminder` 只保留一个 `Tenant details` tab。
5. `Tenant details` 增加 `Payment due date`，作为该租客每月的交租日。
6. 所有 active 且具备有效 Email 的租客默认使用同一套全局 reminder 配置，不再提供租客级同意开关。
7. 归档租客、Email delivery block、无效 Email 或全局 pause 仍会阻止发送。
8. 一次性邮件不恢复；测试邮件继续从 `Reminder settings` 发送。

## 2. 用户看到的变化

### 2.1 Reminder settings

在 `Automatic monthly emails` 中增加：

```text
Reminder schedule

Send rent reminders [ 3 ] days before payment is due
Send at [ 09:00 ]
Email template [ Monthly rent reminder ]

Example: Rent due on August 1 → email planned for July 29 at the
selected global send time.

[Save reminder settings]
```

要求：

- 提前天数必须为整数，最小值 `0`，最大值 `31`；
- 发送时间必须是有效的 Vancouver 本地时间；
- 必须选择 active 的 Email template；
- 保存前显示确认提示；
- 确认提示必须说明该设置会影响多少个 active tenants；
- 提前天数或发送时间变化时，重新计算尚未发送的 reminder；
- 只改变 Email template 时，不改变 `nextRunAt`；
- 保存结果必须明确说明 reminder 已重新计算，但这不代表邮件已经发送；
- Test email 使用当前表单中的提前天数、发送时间和 Email template 生成预览，不要求先保存。

Test email 保留：

- Admin test email destination；
- `Use sample details from` tenant selector；
- preview 和明确确认后发送。

Test email 删除独立的 Email template selector。它直接使用 Reminder settings 当前选中的全局模板，并使用 sample tenant 的 `Payment due date` 生成对应的 `dueDate`。

建议文案：

```text
Change reminder settings for 24 active tenants?

Future reminder dates will be recalculated to 3 days before each
tenant's payment due date at 9:00 AM. The selected template will be
used for future emails. Emails that are already due will not be skipped.
```

### 2.2 Tenant & reminder

页面只保留一个 tab：

```text
Tenant details
```

`Tenant details` 包含：

```text
Name
Property / Unit
Email
Phone
Move-in date
Payment due date [ 1 ] of every month
Notes
```

删除租客级：

```text
Reminder tab
Send the reminder on day
Send at
Email template
Send this reminder automatically every month
```

表单提交按钮改为：

```text
Save tenant
```

租客详情页不再维护 reminder plan。保存 `Payment due date` 后，后台使用全局 Reminder settings 计算该租客的下一封邮件。

如果页面需要显示状态，只显示不可编辑的结果，不再作为第二个 tab：

```text
Next automatic email: July 29, 2026 at 9:00 AM
Payment due: August 1, 2026
```

这两个日期必须来自同一个 occurrence。页面不能单独显示一个与下一封邮件无关的 `Next rent due`。

## 3. 日期计算规则

### 3.1 输入

新的核心计算函数接收：

| 字段 | 类型 | 规则 |
|---|---|---|
| `rentDueDay` | integer | `1–31` |
| `leadDays` | integer | `0–31`，来自全局 Reminder settings |
| `localTime` | `HH:mm` | 来自全局 Reminder settings |
| `timezone` | IANA timezone | 当前产品固定为 `America/Vancouver` |
| `afterInstant` | UTC timestamp | 计算基准时间 |

返回：

| 字段 | 含义 |
|---|---|
| `nextRunAt` | 下一封邮件的 UTC 时间 |
| `sendLocalDate` | 下一封邮件的 Vancouver 日期 |
| `dueDate` | 这封邮件实际提醒的交租日期 |

### 3.2 算法

对当前月和后续月份逐月计算：

1. 计算该月交租日期。
2. 如果 `rentDueDay` 超过该月天数，使用该月最后一天。
3. 从交租日期减去 `leadDays`，得到计划发送日期。
4. 将计划发送日期与全局 `localTime` 组合。
5. 使用 `America/Vancouver` 处理夏令时并转换为 UTC。
6. 选择第一个仍可执行的 occurrence。
7. 同时返回该 occurrence 对应的 `dueDate`，供邮件模板和 Admin 预览共同使用。

伪代码：

```ts
nextReminderOccurrence({
  rentDueDay,
  leadDays,
  localTime,
  timezone,
  afterInstant
}) => {
  nextRunAt,
  sendLocalDate,
  dueDate
}
```

Admin 预览、保存租客的 `Payment due date`、worker 生成邮件和测试邮件必须调用同一个领域函数或数据库等价函数，不能分别实现日期逻辑。

### 3.3 示例

| Payment due | Lead days | Send date |
|---|---:|---|
| 2026-08-01 | 3 | 2026-07-29 |
| 2026-09-01 | 3 | 2026-08-29 |
| 2026-08-15 | 3 | 2026-08-12 |
| 2027-02-28（due day 31 自动截断） | 3 | 2027-02-25 |
| 2028-02-29（闰年 due day 31 自动截断） | 3 | 2028-02-26 |
| 2026-08-01 | 0 | 2026-08-01 |

### 3.4 新租客、恢复资格和错过计划发送时间

新增 active tenant、恢复被阻止的 Email 或解除全局 pause 时：

- 如果计划发送时间尚未到，使用正常计划时间；
- 如果计划发送时间已经过去，但对应的交租日期还没有过去，则设置为立即可执行，由下一个五分钟 worker 处理；
- 如果交租日期已经过去，则安排下一期；
- Admin 必须显示 `Send as soon as the reminder worker runs`，不能伪装成原来的计划时间。

例子：

```text
Payment due: August 1
Normal send date: July 29
Tenant becomes eligible: July 30

Result: email becomes eligible immediately because August 1 has not passed.
```

### 3.5 月底和夏令时

保留现有规则：

- due day 29、30、31 在短月份自动落到该月最后一天；
- Vancouver 春季不存在的本地时间移动到当天的下一个有效时间；
- Vancouver 秋季重复出现的本地时间使用较早的 occurrence；
- 数据库存 UTC，Admin 显示 Vancouver 本地时间。

## 4. `nextRunAt` 更新规则

这是本次改造必须同时修复的行为。

### 4.1 必须重新计算

以下变化重新计算 `nextRunAt`：

- 新增 active tenant；
- 租客从 archived 恢复为 active；
- 租客的 `rentDueDay` 改变；
- 全局 `localTime` 改变；
- 全局 `leadDays` 改变；
- timezone 改变（当前 Admin 不提供该字段，但领域层保留支持）；
- worker 完成当前 occurrence 后安排下一期。

### 4.2 必须保留

以下变化不得修改 `nextRunAt`：

- 修改租客姓名；
- 修改 property 或 unit；
- 修改电话；
- 修改 notes；
- 修改入住日期；
- 修改全局 Email template；
- 保存了与原值相同的 tenant 或 Reminder settings；
- reminder 已经到期但 worker 尚未 materialize 当前 occurrence。

除 `Payment due date` 外，保存租客资料不能改变排程，也不能把一封已经到点的邮件跳到下个月。

### 4.3 修改全局 Reminder settings

保存新的 `leadDays`、`localTime` 或 `emailTemplateId` 时，数据库事务必须：

1. 锁定 Reminder setting；
2. 检查 `expectedVersion`；
3. 验证 Email template active、channel 为 `email` 且存在 current revision；
4. 更新全局 `leadDays`、`localTime` 和 `emailTemplateId`；
5. 如果 `leadDays` 或 `localTime` 改变，对尚未到期的 eligible tenants 重新计算 `next_run_at`；
6. 对已经 `next_run_at <= now()` 的 reminder 保留当前值，让 worker 先处理当前 occurrence；
7. 如果只改变 Email template，保留全部 `next_run_at`；
8. 写入 audit event；
9. 返回重新计算和保留的 tenant 数量。

建议返回：

```json
{
  "paused": false,
  "leadDays": 3,
  "localTime": "09:00",
  "emailTemplateId": "<uuid>",
  "recalculatedTenants": 22,
  "preservedDueTenants": 2,
  "updatedAt": "2026-07-27T20:00:00Z"
}
```

## 5. 数据模型和迁移

### 5.1 全局设置

扩展现有 `system_settings.key = 'reminders'`：

```json
{
  "paused": true,
  "leadDays": 3,
  "localTime": "09:00",
  "timezone": "America/Vancouver",
  "emailTemplateId": "<uuid>",
  "pausedAt": null,
  "pausedBy": null
}
```

`leadDays`、`localTime`、`timezone` 和 `emailTemplateId` 都是系统级策略，不重复存储在每个租客 schedule 中。

### 5.2 Tenant 和派生排程

`tenants.rent_due_day` 是唯一的租客级排程输入，在 Admin 中显示为 `Payment due date`。

现有 `reminder_schedules` 不再是管理员可编辑的 reminder plan，而是后台派生状态。以下字段进入弃用流程：

- `day_of_month`；
- `local_time`；
- `timezone`（产品固定为 Vancouver，迁移到全局设置）；
- `channels`；
- `email_template_id`；
- `sms_template_id`；
- `is_enabled`。

第一阶段：

- 保留数据库列，避免同一次发布破坏旧 Automation API；
- Admin 不再读写这些租客级字段；
- worker 从 tenant 的 `rent_due_day` 和全局 Reminder settings 读取真实配置；
- schedule row 仅保留 `tenant_id`、`next_run_at`、`last_run_at`、revision 和去重所需状态；
- 所有真实日期从 `rent_due_day + global leadDays + global localTime` 推导；
- tenant 是否发送由 active 状态、Email eligibility、全局 pause 和 provider 状态决定。

第二阶段：

- OpenClaw schema 和所有生产调用方完成升级后；
- 删除上述弃用列；
- 删除相关 check constraint 和旧计算函数入口。

不要把旧 schedule 的发送时间或模板迁移成租客级例外。上线前由 owner 选择一套全局发送时间和模板，所有租客统一使用。

### 5.3 数据库函数

新增或替换：

```text
next_reminder_occurrence(
  rent_due_day,
  lead_days,
  local_time,
  timezone,
  after_instant
)
```

更新：

- tenant create/update 中的派生排程同步；
- 全局 Reminder settings 保存函数；
- `materialize_due_reminders`
- `execute_automation_resource_confirmation`
- dashboard due-next-seven-days 查询
- daily reminder reconciliation

数据库和 TypeScript 必须使用相同测试向量，保证两端日期结果一致。

## 6. API 和 contract 变化

### 6.1 Admin Reminder settings

当前：

```text
GET/PATCH /api/admin/settings/reminders
```

目标 payload：

```json
{
  "paused": false,
  "leadDays": 3,
  "localTime": "09:00",
  "timezone": "America/Vancouver",
  "emailTemplateId": "<uuid>",
  "expectedVersion": "2026-07-27T20:00:00Z"
}
```

服务端必须忽略客户端提交的任何派生发送日期，并自行计算。`emailTemplateId` 必须引用 active Email template。

### 6.2 Schedule preview

当前 preview 输入包含 `dayOfMonth`。

目标：

```json
{
  "rentDueDay": 1
}
```

服务端读取全局 Reminder settings，返回：

```json
{
  "leadDays": 3,
  "localTime": "09:00",
  "emailTemplateId": "<uuid>",
  "nextRunAt": "2026-07-29T16:00:00Z",
  "sendLocalDate": "2026-07-29",
  "dueDate": "2026-08-01",
  "timezone": "America/Vancouver"
}
```

### 6.3 Tenant

Tenant create/update 只接受租客资料和 `rentDueDay`，不再接受 reminder schedule 配置：

```json
{
  "name": "Alex Chen",
  "property": "Harbour House",
  "unit": "203",
  "email": "alex@example.com",
  "phone": "604-555-0100",
  "moveInDate": "2026-07-15",
  "rentDueDay": 1,
  "notes": "Prefers email"
}
```

Tenant response 可以包含只读派生状态：

```json
{
  "reminder": {
    "eligible": true,
    "nextRunAt": "2026-07-29T16:00:00Z",
    "nextDueDate": "2026-08-01"
  }
}
```

不得再从 Tenant UI 或 tenant endpoint 提交：

- `dayOfMonth`；
- `localTime`；
- `timezone`；
- `channels`；
- `emailTemplateId`；
- `smsTemplateId`；
- `isEnabled`。

### 6.4 OpenClaw 兼容

Automation API v1 当前支持租客级 schedule。迁移期间：

- tenant create/update 继续接受 `rentDueDay`；
- schedule read 返回全局生效的 `leadDays`、`localTime` 和 `emailTemplateId`，并标记为只读；
- schedule write 中的 `dayOfMonth`、`localTime`、template 和 channel 字段标记为 deprecated；
- 如果旧调用提交的值与全局设置不同，返回明确的 `GLOBAL_REMINDER_POLICY`，不能静默忽略；
- OpenAPI、JSON schema、Skill reference 和示例统一更新；
- 所有调用方升级后移除租客级 schedule mutation。

OpenClaw 不能修改全局 `leadDays`、`localTime` 或 `emailTemplateId`。租客创建后是否发送由 tenant eligibility 和全局 Reminder settings 决定，不再通过租客级 confirmation 启用 schedule。

## 7. Worker 和邮件内容

Worker materialize 当前 occurrence 时必须冻结：

- `sendLocalDate`；
- `dueDate`；
- 当时生效的 `leadDays`；
- 当时生效的全局 `localTime`；
- 当时生效的全局 `emailTemplateId`；
- template revision；
- destination；
- render context。

`{{due_date}}` 必须使用 occurrence 返回的 `dueDate`。Admin 预览和测试邮件也使用同一个值。

修改未来的全局 `leadDays`、`localTime` 或 Email template 不得改变已经生成的 notification event。

继续保留：

- occurrence key 和数据库唯一索引防重复；
- 24 小时过期保护；
- global pause 和 deployment force pause；
- 发送前重新检查 tenant active 状态、email eligibility、全局设置和 template；
- Email activity 作为实际发送结果的记录。

## 8. 模板校验同步修复

Reminder settings 保存和 worker 发送两层都必须验证：

- 全局设置使用 active Email template；
- template channel 必须为 `email`；
- template 必须有 current revision；
- 模板被停用或改变 channel 后，worker 创建明确的 skipped event；
- skipped event 出现在 Email activity，不允许静默推进到下个月。

这项修复与全局排程改造一起完成，避免日期计算正确但邮件仍因模板状态静默丢失。

## 9. 实施工作包

### WP1：领域计算

涉及：

- `src/features/reminders/scheduler.ts`
- `src/features/reminders/due-date.ts`
- TypeScript unit tests

任务：

1. 新增 `nextReminderOccurrence`；
2. 一次返回 `nextRunAt` 和 `dueDate`；
3. 加入新租客和重新具备发送资格时的 catch-up 规则；
4. 保留月底和 DST 行为；
5. 用表驱动测试固定预期。

### WP2：全局 Reminder setting

涉及：

- `src/lib/contracts.ts`
- `src/lib/schemas.ts`
- memory store
- Supabase repository
- 新 Supabase migration

任务：

1. 增加 `leadDays`、`localTime`、`timezone` 和 `emailTemplateId`；
2. 增加版本冲突保护；
3. 原子更新 setting 和未来派生排程；
4. 保留已到期 occurrence；
5. 增加 audit metadata。

### WP3：Tenant 派生排程和 worker

涉及：

- tenant repository；
- 派生排程 repository；
- tenant create/update；
- `materialize_due_reminders`；
- reconciliation；
- dashboard projection。

任务：

1. 停止读取租客级 reminder day、time、template、channel 和 enabled；
2. 只在 `rentDueDay` 或全局 timing 变化时重算；
3. 普通 tenant details 保存保留 `nextRunAt`；
4. worker 从全局 settings 读取发送时间和模板；
5. worker 使用 occurrence 的 `dueDate`；
6. 增加模板 channel/active/revision 校验。

### WP4：Admin

涉及：

- `src/components/admin/reminder-settings.tsx`
- `src/components/admin/tenant-editor.tsx`
- Admin route loader

任务：

1. Reminder settings 增加全局提前天数、发送时间和 Email template；
2. Test email 删除独立 template selector，使用当前 Reminder settings 表单值；
3. Tenant editor 只保留 `Tenant details` tab；
4. Tenant details 增加 `Payment due date`；
5. 删除租客级 reminder day、time、template 和 automatic toggle；
6. 设置变化显示受影响 tenant 数量。

### WP5：Automation 兼容

涉及：

- Automation API schemas；
- OpenAPI；
- OpenClaw Skill schema 和 reference；
- legacy schedule compatibility；
- import schedule normalization。

任务：

1. v1 schedule read 返回全局只读配置；
2. 与全局配置冲突的 legacy write 返回 `GLOBAL_REMINDER_POLICY`；
3. tenant create/update 继续支持 `rentDueDay`；
4. 从 import schema 弃用 reminder day、time、channel 和 template columns；
5. 更新所有示例和说明；
6. 增加旧 client compatibility tests。

### WP6：产品文档同步

同步更新：

- `docs/Ting Ting Admin PRD.md`；
- `docs/Ting Ting Admin Engineering Spec.md`；
- `docs/Ting Ting Admin UI 功能设计文档.md`；
- `docs/Ting Ting Admin UI 功能设计 Prompt.md`；
- `docs/Full Project Development Prompt.md`；
- `docs/openclaw-integration/08-reminder-schedule-workflow.md`；
- OpenAPI、JSON schema 和 OpenClaw Skill reference。

所有文档统一使用以下规则：只有 tenant 的 `Payment due date` 是租客级输入；提前天数、发送时间和 Email template 全部来自 Reminder settings。

### WP7：迁移和上线

1. 保持 `REMINDERS_FORCE_PAUSED=true`；
2. 应用新增 setting 和数据库函数 migration；
3. 部署兼容版本；
4. owner 选择并确认全局发送时间和 active Email template；
5. 将所有 eligible tenants 按全局 `leadDays + localTime` 重算；
6. 检查已经到期的 reminders 没有被跳过；
7. 发送管理员 test email；
8. 验证 Email activity 的 send date、due date 和 template revision；
9. 连续观察至少两个 Cron 周期；
10. 通过既有 launch gate 后再解除 pause。

## 10. 测试计划

详细测试用例、执行命令、测试数据和 release gate 见
[Reminder Global Scheduling Test Plan](./Reminder%20Global%20Scheduling%20Test%20Plan.md)。

### 10.1 日期单元测试

- due day 1，lead 3，跨到上个月；
- due day 15，lead 3，同月；
- due day 31，二月平年；
- due day 31，二月闰年；
- lead 0，交租当天发送；
- lead 31，跨月；
- spring-forward；
- fall-back；
- planned send 已过但 due date 未过；
- due date 已过，选择下一期。

### 10.2 Repository 测试

- 新 tenant 的派生排程计算正确；
- archived tenant 恢复 active 后重新计算；
- 修改 rent due day 重新计算；
- 修改全局 local time 重新计算；
- 修改 notes 不改变 `nextRunAt`；
- 相同 tenant details 重复保存不改变 `nextRunAt`；
- 全局 lead days 变化重算未来 reminders；
- 只修改全局 Email template 不改变 `nextRunAt`；
- 已到期 reminder 不被全局变化跳过；
- inactive、archived、blocked email tenant 不会 materialize；
- inactive 或错误 channel template 不能保存到 Reminder settings。

### 10.3 Worker 和数据库测试

- Admin preview、TypeScript scheduler 和 SQL scheduler 使用同一组 expected vectors；
- occurrence 的邮件日期和 `dueDate` 永远成对；
- 重复 worker 调用只生成一个 event；
- template unavailable 生成 skipped activity；
- pause 不推进派生排程；
- 24 小时外 occurrence 变为 expired；
- global timing 或 template 变化不修改已 materialize event。

### 10.4 浏览器测试

- Reminder settings 可一起保存提前天数、发送时间和 Email template；
- 无效天数、时间或 template 显示清晰错误；
- Tenant editor 只有一个 `Tenant details` tab；
- Tenant details 包含 `Payment due date`；
- Tenant editor 不再出现 reminder day、send time、template 或 automatic reminder toggle；
- Test email 不再出现第二个 Email template selector；
- 只读状态同时显示对应的 send date 和 due date；
- test email 使用表单中选择的 template 和同一个 due date；
- 移动端没有横向溢出；
- Admin accessibility 检查通过。

## 11. 验收标准

以下条件全部满足才算完成：

1. Reminder settings 是提前天数、发送时间和 Email template 的唯一来源。
2. Tenant editor 只保留一个 `Tenant details` tab。
3. Tenant details 包含每月 `Payment due date`。
4. Tenant editor 不再包含任何租客级 reminder 配置或同意开关。
5. 所有 active 且 Email eligible 的租客默认进入自动提醒。
6. 下一封邮件时间和该邮件的 payment due date 由同一次计算返回。
7. due day 1、lead 3 时，邮件安排在前一个月的正确日期。
8. 除 payment due date 外，普通租客资料保存不会改变现有 `nextRunAt`。
9. 修改全局设置不会跳过已经到期、尚未 materialize 的邮件。
10. Admin、memory、Supabase 和 Automation preview 的结果一致。
11. Email template channel 和 active 状态在设置保存与发送前都被验证。
12. 去重、pause、24 小时保护和发送前 eligibility recheck 不退化。
13. 单元、SQL behavior、Supabase integration 和 Playwright 测试通过。

## 12. 明确不在本次范围

- 不恢复 one-time email；
- 不增加多个 reminder 阶段；
- 不增加 SMS schedule UI；
- 不允许 OpenClaw 修改全局 lead days、发送时间或 Email template；
- `moveInDate` 本次仍作为租客资料字段，不参与首次 regular rent due date 的计算；
- 不改变邮件 provider、Cron 频率或 delivery retry 策略。

后续如果需要让入住日期决定第一封邮件，应单独定义：

- 入住前是否允许发送；
- 首月租金是否仍按 regular rent due day；
- 入住当天与 regular rent due day 不同如何处理。

## 13. 建议实施顺序

```text
Domain calculation and vectors
        ↓
Global setting and migration
        ↓
Repository and worker parity
        ↓
Admin UI
        ↓
Automation compatibility
        ↓
Paused production dry run
        ↓
Owner approval and unpause
```

不要先只改 Admin label。日期计算、数据库 worker 和迁移必须在同一发布批次内完成，否则页面与真实邮件仍可能不一致。
