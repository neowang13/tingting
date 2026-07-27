# Ting Ting Admin UI 功能设计文档

> 文档类型：功能与交互说明  
> 依据：当前项目代码、现有 Admin 实现及《Website Content Admin — Design Handoff》  
> 更新时间：2026-07-27  
> 设计状态：现有 Admin 功能已记录；Website Content 新结构为 Design-ready、Implementation pending  
> 说明：本文只定义页面内容、信息架构、功能、交互、状态和校验，不规定颜色、字体、插画或视觉风格。
>
> 2026-07-27 修订：租客页面中的独立 reminder day、send time、template 和开关已由
> 《Reminder Global Scheduling Change Plan》取代。租客只维护 Payment due date；
> Reminder settings 统一维护 lead time、发送时间与邮件模板。

## 1. 产品定位

Ting Ting Admin 是一个面向房产经营者和授权员工的内部管理后台。它连接公开网站、房源数据、租客资料、租金提醒邮件和 OpenClaw 自动化服务。

后台的核心目标是：

1. 让管理员在不改代码的情况下维护公开网站内容。
2. 管理房源的草稿、发布、下线和归档。
3. 在同一个工作流中维护租客、租金到期日和每月提醒计划。
4. 在发送邮件前明确展示收件人、跳过原因、邮件内容和系统阻塞状态。
5. 通过邮件活动记录确认邮件究竟是等待、已发送、已送达还是失败。
6. 管理自动化服务账号、导入记录和审计记录。

## 2. 用户与权限

### 2.1 主要用户

- Ting Ting 或获得授权的后台管理员。
- 当前只需要一个 Admin 角色，不设计复杂的多角色权限界面。

### 2.2 访问规则

- 所有 `/admin` 页面都必须先登录。
- 生产环境登录支持密码与 TOTP 多因素验证。
- 未登录、会话过期、账号停用或缺少 MFA 时，用户回到登录页并看到明确原因。
- 页面顶部显示当前管理员姓名、邮箱和退出按钮。
- 创建、轮换、停用自动化服务账号等安全操作需要最近完成的 MFA。

### 2.3 数据边界

- 公开网站只能读取已发布的网站内容、已发布媒体和已发布房源。
- 租客完整联系方式、内部备注、导入原始数据、自动化 Token 不得出现在公开页面。
- 租客列表和投递记录中的联系方式默认脱敏。
- 自动化 Token 只展示一次，关闭后不能再次查看。

## 3. 信息架构

### 3.1 全局导航

侧边栏按任务分组：

1. Overview
   - Home
2. Website
   - Website content
   - Rental listings
3. Rent management
   - Tenants & schedules
   - Send a one-time email
   - Email activity
   - Email templates
4. System
   - Reminder settings
   - Automation & imports

当前页面需要在导航中显示选中状态。内容编辑、房源详情和租客详情等子页面沿用所属一级入口的选中状态。

### 3.2 页面与路由清单

| 模块 | 页面 | 路由 | 主要任务 |
|---|---|---|---|
| 认证 | 登录 | `/admin/login` | 密码登录、MFA 验证或首次绑定 |
| 认证 | 重置密码 | `/admin/reset-password` | 验证恢复链接并设置新密码 |
| 总览 | Overview | `/admin` | 查看系统是否可发送、近期邮件和需处理问题 |
| 网站内容 | 内容列表 | `/admin/content` | 查看固定网站区块及发布状态 |
| 网站内容 | Homepage / Shared 编辑 | `/admin/content/{sectionKey}` | 编辑、保存草稿、预览、发布和回滚 |
| 网站内容 | Service page 编辑 | `/admin/content/services/{serviceKey}` | 编辑一个完整 Service page 并作为整体发布 |
| 网站内容 | Homepage / Shared 草稿预览 | `/admin/preview/homepage/{sectionKey}` | 在对应公开位置预览未发布内容 |
| 网站内容 | Service page 草稿预览 | `/admin/preview/services/{serviceKey}` | 在对应 Service route 预览未发布整页 |
| 房源 | 房源列表 | `/admin/rentals` | 查看全部草稿、已发布和已归档房源 |
| 房源 | 新建房源 | `/admin/rentals/new` | 创建房源草稿 |
| 房源 | 房源编辑 | `/admin/rentals/{rentalId}` | 编辑、发布、下线或归档房源 |
| 租客 | 租客列表 | `/admin/tenants` | 搜索、筛选并查看提醒状态 |
| 租客 | 新建租客 | `/admin/tenants/new` | 同时创建租客与每月提醒 |
| 租客 | 租客详情 | `/admin/tenants/{tenantId}` | 编辑租客、提醒计划和联系授权 |
| 通知 | 单次发送 | `/admin/notifications/send` | 预览并确认一次性提醒邮件 |
| 通知 | 邮件活动 | `/admin/notifications/history` | 查询投递状态和重试失败邮件 |
| 通知 | 邮件模板 | `/admin/notifications/templates` | 新建、编辑和停用模板 |
| 设置 | 提醒设置 | `/admin/settings` | 全局暂停、查看服务状态、保存测试收件地址 |
| 自动化 | 自动化总览 | `/admin/automation` | 查看接入健康状态与异常 |
| 自动化 | 服务账号 | `/admin/automation/service-accounts` | 创建、轮换、改权限和停用凭证 |
| 自动化 | 导入历史 | `/admin/automation/imports` | 查看租客导入批次与安全处理原始文件 |
| 自动化 | 自动化审计 | `/admin/automation/audit` | 查看自动化操作追踪记录 |

## 4. 全局页面框架

### 4.1 侧边栏

- 展示品牌名、Admin 标识和分组导航。
- 点击品牌名返回公开网站首页。
- 当前路由及其子路由在侧边栏中保持激活。
- 小屏设备应提供可展开或可收起的导航，但不能隐藏当前页面位置。

### 4.2 页面顶部

每个页面顶部包含：

- 页面标题。
- 一句说明当前页面用途和行为后果的描述。
- 当前管理员姓名和邮箱。
- 退出按钮。

### 4.3 通用交互规则

- 保存按钮必须说明保存后是否影响公开网站。
- “等待发送”不能使用“已发送”的文案。
- 发布、下线、归档、全局暂停、批量发送、重试等操作必须二次确认。
- 请求处理中禁用重复提交。
- 所有异步操作都要显示进行中、成功或失败反馈。
- 版本冲突时不覆盖其他标签页的新数据，提示刷新后重试。
- 技术信息放在高级区域或系统模块，不干扰日常主流程。

## 5. 页面功能说明

## 5.1 登录

### 页面目标

让管理员安全进入后台，并在生产环境完成多因素验证。

### 页面内容与交互

第一阶段：

- Email。
- Password。
- Sign In 按钮。

生产环境登录成功后：

- 如果已有 TOTP：进入六位验证码阶段。
- 如果没有 TOTP：显示二维码、手动设置密钥和六位验证码输入框。
- 验证成功后进入 `/admin`。

### 状态

- 正在校验。
- 邮箱或密码错误。
- 尝试次数过多。
- 验证码错误或过期。
- 会话建立失败。
- 账号停用。
- MFA 必需。
- 认证服务未配置。

## 5.2 重置密码

### 页面目标

通过有效的恢复链接设置新密码。

### 字段

- New password，至少 14 位。
- Confirm new password。

### 规则

- 先验证恢复链接和恢复会话。
- 两次密码必须一致。
- 更新成功后退出当前恢复会话，并返回登录页显示成功提示。
- 链接无效、过期或更新失败时提供明确错误。

## 5.3 Overview

### 页面目标

让管理员首先回答三个问题：

1. 自动租金提醒现在能不能发送？
2. 接下来有什么邮件会发送？
3. 有没有失败、积压或需要处理的事情？

### 页面内容

1. 邮件提醒总状态
   - Ready to send。
   - Sending paused。
   - Test mode。
   - Delivery disabled。
   - 提供进入 Reminder settings 的入口。
2. 核心指标
   - Current tenants。
   - Automatic reminders on。
   - Emails planned in 7 days。
   - Delivery problems。
   - Waiting to send。
3. Needs attention
   - 只有存在警告时显示。
4. Last system check
   - Paused 或 Running。
   - 最近一次任务结果。
   - 最近运行时间。
   - 如果部署级暂停覆盖后台设置，需要明确说明。
5. Messages waiting to send
   - 队列数量。
   - 最早等待时间。
   - 进入 Email activity。
6. Recent emails
   - 最近 5 条。
   - 租客、邮件类型、结果、脱敏收件地址、计划时间。

### 空状态

- 系统从未运行。
- 当前没有等待邮件。
- 当前没有邮件记录。

## 5.4 Website content 列表

### 页面目标

把 Website Content 从“八个首页区块表格”升级为面向公开页面与共享内容的固定内容目录，让管理员快速确认：

1. 正在修改哪个公开页面或共享内容。
2. 是否存在尚未发布的草稿。
3. 当前是否已有线上版本。
4. 点击 Edit 后会影响哪些公开位置。

### 内容范围与分组

共 13 个固定内容入口，按以下顺序显示：

1. Shared across the website
   - Header and navigation。
   - Contact form。
   - Footer。
2. Homepage
   - Homepage introduction。
   - Rental search form。
   - Property services overview。
   - Featured rentals。
   - About Ting Ting。
3. Service pages
   - Renovation。
   - Handyman service。
   - Property maintenance。
   - Strata service。
   - Rental management。

分组规则：

- Header、Contact、Footer 影响多个页面，因此属于 Shared。
- Homepage 只保留五个首页专属编辑入口。
- 每个 Service page 是一个完整发布与回滚单元。
- 实际房源记录继续在 `/admin/rentals` 管理，不在 Website content 重复编辑。
- 13 项均为固定内容，不提供搜索、筛选、自定义排序、Add、Remove 或拖拽。

### Service page route 映射

| Admin key | Admin 名称 | 公开 route |
|---|---|---|
| `renovation` | Renovation | `/services/renovation` |
| `handyman` | Handyman service | `/services/handyman-service` |
| `maintenance` | Property maintenance | `/services/property-maintenance` |
| `strata` | Strata service | `/services/strata-service` |
| `rental_management` | Rental management | `/services/rental-management` |

Admin 不得修改 key、slug 或 route。

### Page header

包含：

- Title：Website content。
- Description：Edit the words and images visitors see. Saving keeps changes private; publishing makes them live.
- Secondary action：View live website。
- 可选紧凑摘要：
  - 13 content areas。
  - X unpublished drafts。
  - Last website publish。

摘要只用于扫描，不做成大型 Dashboard 指标区。

### Workflow guide

显示固定四步：

`Edit → Save draft → Preview → Publish`

辅助文案：

`Saved drafts are private. Visitors only see a change after you publish it.`

### Content group

每组显示：

- Group title。
- 一句影响范围说明。
- 同一列表中的内容条目。

不使用 Group card 内再嵌套 Content card 的多层容器。

### Content row

每行显示：

- Name：用户可理解的页面或共享内容名称。
- Location：公开 route 或影响范围。
- Draft state：
  - No unpublished changes。
  - Unpublished draft。
- Live state：
  - Live on website。
  - Not published。
- Last published：本地日期与时间，或 Never。
- Action：
  - Edit。
  - Edit page。
  - Edit shared content。

Service page 可以显示小型 Hero thumbnail，但状态与页面名称优先。

示例：

```text
Renovation
/services/renovation
Unpublished draft · Live on website
Last published Jul 27, 2026, 5:40 AM
[Edit page →]
```

```text
Contact form
Homepage section and contact popup on all service pages
No unpublished changes · Live on website
Last published Jul 27, 2026, 4:12 AM
[Edit shared content →]
```

### Mobile behavior

- 每行转换为纵向 stacked row，不使用横向滚动表格。
- 顺序为 Name、Location、Draft/Live state、Last published、Edit。
- 状态文字允许换行，不截断。
- Edit 至少 44px 高。

### 实施状态

- 当前代码只列出八个 Homepage section。
- 五个 Service page 仍由静态数据驱动，尚未进入 Admin registry、Schema、Repository、Preview 和 Revision。
- 本节描述 handoff 确认后的目标 UI；实现时必须补齐数据与版本化能力。

## 5.5 Service Page Editor

### 页面目标

为五个固定 Service page 提供结构明确的页面级编辑体验。管理员只编辑内容，不改变页面结构。

建议 Admin route：

`/admin/content/services/{serviceKey}`

### 编辑器 Header

包含：

- Breadcrumb：Website content / Service pages / 当前页面。
- 页面名称。
- 公开 route。
- Draft state 与 Live state。
- Open live page。
- 状态说明：
  - Your saved draft is newer than the live website.
  - The saved content matches the live website.

### Desktop layout

三栏结构：

1. Section navigation，180–220px。
2. Editor form，至少 520px，主要表单阅读宽度不超过约 720px。
3. Status / history rail，260–300px。

底部显示 Sticky action bar。

1024px 以下：

- 保留 Section navigation 与表单。
- Status / history 移到 Drawer 或页面底部折叠区。

### Section navigation

固定六项：

1. Hero。
2. Core services。
3. Highlight。
4. Why choose us。
5. Gallery。
6. Final call to action。

行为：

- 点击滚动到对应表单区。
- 当前区块显示选中状态。
- 有错误时显示 `Needs attention` 或 `Core services · 2 issues`。
- 不提供 Add section、Remove、Duplicate 或 Drag handle。
- 不显示 Process 或 FAQ。

### Hero 字段

| Admin label | 必填 | 控件与限制 |
|---|---:|---|
| Small heading | 是 | 单行，最多 80 字符 |
| Main heading | 是 | 多行，最多 120 字符 |
| Supporting text | 是 | Textarea，最多 300 字符 |
| Hero image | 是 | Media picker |
| Image description | 是 | 最多 160 字符 |
| Image focal point | 是 | 九宫格选择器，不显示 CSS 值 |

只读说明：

`The Contact us and Call buttons are shared across all service pages and cannot be changed here.`

不显示 CTA label、CTA URL、Phone number、Slug 或 Route 输入框。

### Core services 字段

顶部字段：

- Small heading，必填，最多 80 字符。
- Section heading，必填，最多 120 字符。

固定四个 Item editor，每项使用 Fieldset + Legend：

`Core service 1 of 4`

每项字段：

- Service title，必填，最多 60 字符。
- Description，必填，最多 180 字符。
- Icon，必填，使用 Approved icon picker，显示图标预览与名称。
- Image，按模板决定是否显示或可选。
- Image description，有图片时必填，最多 160 字符。

结构规则：

- 始终显示 `4 of 4 services`。
- 不提供 Add 或 Remove。
- 默认不允许改变顺序。
- 如果未来确需排序，只使用 Move up / Move down，不使用拖拽。
- Renovation 当前四项带图片。
- 其余四页当前使用 icon-only card。
- UI 必须说明所选图片是否会在当前页面模板中显示。

### Highlight 字段

- Highlight title，必填，最多 80 字符。
- Highlight text，必填，最多 240 字符。

只读说明：

`The Request service button opens the shared contact form.`

不提供按钮文字或链接目标。

### Why choose us 字段

主内容：

- Small heading，必填，最多 80 字符。
- Main heading，必填，最多 120 字符。
- Supporting text，必填，最多 500 字符。
- Section image，必填，Media picker。
- Image description，必填，最多 160 字符。

Benefits 固定四项：

- Benefit title，必填，最多 60 字符。
- Benefit description，必填，最多 180 字符。
- Icon，必填，Approved icon picker。

`storyFirst` 等布局决定不提供 Admin 开关。

### Gallery / Included services 字段

顶部：

- Small heading，必填。
- Section heading，必填。

每项：

- Title，必填，最多 60 字符。
- Description，必填，最多 180 字符。
- Image，必填，Media picker。
- Image description，必填，最多 160 字符。

数量由模板锁定：

- Renovation：3 项。
- Handyman、Property maintenance、Strata、Rental management：各 4 项。
- 第一版不提供 Add、Remove 或自由排序。

### Final call to action 字段

- CTA heading，必填，最多 120 字符。
- CTA supporting text，必填，最多 240 字符。

只读说明：

`This section always shows Contact us and the shared public phone number.`

### Service page 固定产品规则

- Service page 数量固定为五个。
- 每页作为整体保存、预览、发布和回滚。
- 每页 Core services 固定四项。
- 每页不显示 Process 或 FAQ。
- Navbar、Footer、Contact popup 不在页面内重复编辑。
- Hero 固定两个按钮：
  - Contact us：打开共享 Contact popup。
  - Call：使用共享 Public phone number。
- 其他 Service CTA 固定打开共享 Contact popup。
- 不提供 HTML、脚本、自定义 CSS、Slug、Route 或任意 CTA destination。

## 5.6 Website Content 配套编辑器与发布规则

### Homepage Property Services Editor

旧的 Modal detail 和 Process 字段已经不再对应公开网站，新 UI 不得继续显示。

可编辑字段：

- Small heading。
- Main heading。
- Supporting text。
- 五张固定 Homepage service card。
- Main section CTA label。

五张卡片分别为：

1. Renovation。
2. Handyman Services。
3. Property Maintenance。
4. Strata Services。
5. Rental Management。

每张卡片字段：

- Display title。
- Short description。
- Homepage link label。
- Icon。

Destination 由代码固定，只读显示：

- Opens the Renovation service page。
- Opens the Handyman service page。
- Opens the Property maintenance service page。
- Opens the Strata service page。
- Opens the Rental management service page。

移除旧字段：

- Detail eyebrow。
- Detail heading。
- Included services。
- Process heading。
- Process description。
- Modal CTA labels。

### Shared Contact Form Editor

影响范围：

- Homepage contact section。
- 五个 Service page 的共享 Contact popup。
- Service Hero 与 Final CTA 中显示的公开电话号码。

页面顶部必须显示：

`Changes here affect the homepage contact section and the contact popup on all five service pages.`

字段：

| Admin label | 必填 | 控件与限制 |
|---|---:|---|
| Contact heading | 是 | 最多 120 字符 |
| Supporting text | 是 | 最多 500 字符 |
| Public phone number | 是 | Phone input + formatted preview |
| Public email | 是 | Email input |
| Name field label | 是 | 最多 40 字符 |
| Email field label | 是 | 最多 40 字符 |
| Phone field label | 是 | 最多 40 字符 |
| Preferred contact label | 是 | 最多 40 字符 |
| Message field label | 是 | 最多 40 字符 |
| Email option label | 是 | 顺序锁定 |
| Phone option label | 是 | 顺序锁定 |
| SMS option label | 是 | 顺序锁定 |
| Submit button label | 是 | 最多 40 字符 |
| Success message | 是 | 最多 240 字符 |
| Error message | 是 | 最多 240 字符 |

右侧显示居中的 Contact popup Preview。预览使用非交互或沙盒表单，避免误提交。

### Media Picker

Website Content 编辑器使用专用 Media picker，不向管理员暴露 Raw URL、Media UUID 或 `mediaAssetId`。

触发区：

```text
[Current image preview]
Filename · 1600 × 900 · Published
[Choose another image] [Remove]
```

Picker 功能：

- 按 Filename 或 Alt text 搜索。
- 筛选 All / Draft / Published。
- 显示 Aspect ratio、尺寸、文件名、Alt text 和公开可用状态。
- 支持 Upload new images。
- 选择后显示 Crop / focal-point preview。
- Draft image 可以保存到草稿，但页面发布时必须一起通过媒体发布校验。

缺失图片：

`This image is unavailable. Choose a replacement before publishing.`

- Save draft 可以继续。
- Publish 必须阻止。

上传规则继续遵守：

- 一次最多 20 张。
- JPEG、PNG、WebP、AVIF。
- 单文件最大 8 MB。
- 尺寸 64–8,000px。
- 上传前显示本地预览并填写 Alt text。
- 支持部分上传成功与单项重试。

### Sticky action bar

顺序：

1. Save draft。
2. Preview saved draft。
3. Publish to website。

左侧显示：

- No unsaved changes。
- Unsaved changes。
- Saving…
- Saved privately at [time]。
- Published at [time]。

375px 小屏只固定 Save draft 与 Publish；Preview 放入 More actions，但必须保持键盘和屏幕阅读器可发现。

### Save draft

- 不需要确认。
- 请求中禁止重复提交。
- Validation error 时禁用，并链接到第一个错误区块。
- 成功文案：

`Draft saved. Visitors still see the currently published version.`

### Preview saved draft

根据内容类型打开对应 route：

- `/admin/preview/homepage/{sectionKey}`。
- `/admin/preview/services/{serviceKey}`。

预览 Banner：

```text
Previewing a private draft of Renovation.
Visitors cannot see this version.
```

存在未保存修改时：

`Save your changes before previewing them.`

提供：

- Save and preview。
- Continue editing。

### Publish confirmation

Service page：

```text
Publish Renovation?

Visitors will immediately see this version at:
/services/renovation

[Cancel] [Publish page]
```

Shared Contact：

```text
Publish shared contact content?

This will update the homepage contact section and the contact popup on all five service pages.

[Cancel] [Publish shared content]
```

成功：

`Published. Visitors can now see this version.`

提供 View live page 与 Continue editing。不能只显示 Toast，页面内必须保留可被辅助技术读取的结果。

### Version history

入口位于右侧 Rail 或页面顶部：

`Version history`

每条显示：

- Published date/time。
- Published by。
- 友好编号，例如 Version 12。
- Currently live。
- Preview。
- Restore。

不显示 Revision UUID 或 Schema version。

恢复确认：

```text
Restore and publish this version?

The selected version will become live immediately.
Your current draft and the current live version will remain in version history.

[Cancel] [Restore and publish]
```

成功：

`Version restored and published. Visitors now see the selected version.`

### Validation

字段级：

- 失焦时验证，提交时完整验证。
- Error 显示在字段下方并说明修正方法。
- 字符计数作为辅助文字，不替代错误。
- 不只依赖红色边框。

示例：

- Main heading is required.
- Keep this description under 180 characters.
- Choose an image before publishing.
- Add an image description for screen-reader users.

区块级：

- Section navigation 显示 `Core services · 2 issues`。

页面级：

- `This page cannot be published yet. Review 3 fields that need attention.`
- 点击后聚焦第一个错误。

### Website Content 系统状态

Loading：

- Content list 使用稳定 Skeleton rows。
- Editor 保留三栏或双栏宽度，避免跳动。
- 图片保留比例占位。

Backend 未初始化：

`Website content has not been set up. Contact the site administrator before making changes.`

Save error：

`Your draft could not be saved. Your changes are still in this browser. Try again before leaving this page.`

Publish error：

`The draft was saved, but it could not be published. Visitors still see the previous live version.`

Version conflict：

```text
This content was changed in another session.
Your changes have not been overwritten.

[Review latest version] [Copy my changes]
```

Session expiry：

- 保留本地未提交输入。
- 提示重新登录。
- 登录后尽量恢复编辑状态。

### Responsive behavior

1440px+：

- Section nav + Editor form + Status/history rail。
- Sticky action bar 始终可见。

1024px：

- Section nav + Editor form。
- Status/history 放入 Drawer。
- Media picker 可双列。

768px：

- Section nav 转横向 Scroll tabs 或 Select。
- 表单单列。
- Sticky actions 可换成两行。

375px：

- Header、状态和 Action 纵向。
- Content list 使用 Stacked rows。
- 所有字段单列。
- Media picker 使用 Full-screen sheet。
- 不允许页面横向溢出。
- 所有操作目标至少 44×44px。

### Website Content 可访问性

- 页面只使用一个 H1。
- 每个 Editor section 使用 H2。
- 重复 Item 使用 Fieldset + Legend。
- 所有输入都有可见 Label。
- Status pill 同时包含文字。
- Save / Publish 结果使用 `aria-live="polite"`。
- Publish failure 使用 `role="alert"`。
- Dialog 初始焦点在标题或 Cancel，Escape 关闭，关闭后焦点返回触发按钮。
- Section navigation 与 Icon picker 完整支持键盘。
- 图片预览显示当前 Alt text。
- Reduced motion 下取消非必要滚动动画。

### Component hierarchy

```text
WebsiteContentPage
├── AdminPageHeader
├── ContentWorkflowGuide
├── ContentGroup
│   └── ContentEntryRow
│       ├── ContentIdentity
│       ├── DraftLiveStatus
│       └── EditAction
└── WebsiteContentHelp

ServicePageEditor
├── ContentEditorHeader
│   ├── Breadcrumbs
│   ├── RouteAndImpact
│   └── DraftLiveStatus
├── EditorSectionNavigation
├── ContentEditorForm
│   ├── HeroFields
│   ├── CoreServicesFields
│   ├── HighlightFields
│   ├── StoryFields
│   ├── GalleryFields
│   └── FinalCtaFields
├── ContentStatusRail
│   ├── PublishSummary
│   └── VersionHistoryTrigger
├── MediaPicker
├── StickyPublishBar
└── PublishConfirmationDialog
```

### 工程前置条件

设计依赖以下实现工作：

- 将五个 Service page 迁移为五个固定、可版本化的内容文档。
- 为 Service page 建立严格 Schema：
  - Core services exactly 4。
  - Benefits exactly 4。
  - Gallery 数量按模板固定。
  - Slug 与 CTA behavior 不接受 Admin 输入。
  - 所有图片使用 Media reference 并要求 Alt text。
- 将当前静态 Service page 数据迁移为初始 Published content。
- 公开页面只读取 Published content，Admin 读取 Draft content。
- 删除旧 `property_services` 中不再使用的 Detail / Process 字段。
- 增加 Service page Preview loader 与 route。
- 每次发布创建 Revision；回滚恢复整个页面、立即发布并写入 Audit。

## 5.7 Rental listings 列表

### 页面目标

管理公开网站上的房源集合。

### 页面内容

- 显示房源总数，包括草稿和归档。
- Add rental listing。
- 列表字段：房源标题、地址、月租、网站状态、编辑入口。
- 状态：Saved privately、Live on website、Archived。

### 空状态

- 没有房源时保留 Add rental listing 主操作。

## 5.8 Rental editor

### 字段

- URL slug。
- Listing title。
- Address。
- Neighbourhood。
- City。
- Monthly rent (CAD)。
- Bedrooms。
- Bathrooms。
- Square feet。
- Available date。
- Homepage order。
- Pet policy。
- Description。

### Slug 规则

- 自动转小写并将空格、特殊字符转换为连字符。
- 第一次发布后不可修改。
- 长度 2–100。

### 房源图片

- 从媒体库选择最多 20 张。
- 选择一张为 Cover image。
- 支持 Move earlier / Move later 调整公开顺序。
- 发布前必须存在封面图。

### 页面操作

- Save without publishing：保存或创建草稿，不改变公开网站。
- Publish to website：保存当前表单并发布，需要确认。
- Remove from website：已发布房源转回草稿，需要确认。
- Archive：移出公开网站并归档，需要确认。

### 其他状态

- 展示 Saved privately / Live on website / Archived。
- 如果由 OpenClaw 创建，显示来源系统和外部引用。
- 显示字段校验错误、数据库错误和版本冲突。

## 5.9 Tenants and rent reminders 列表

### 页面目标

快速找到租客，并同时查看租客状态、联系许可、下一次自动邮件和最近投递结果。

### 页面操作

- Add tenant and reminder。
- 搜索：姓名、物业或单元。
- 筛选：
  - Tenant status：All / Current / Inactive / Archived。
  - Email readiness：All / Can receive email / Cannot receive email。
  - Automatic reminder：All / On / Off / Not set up。

### 列表字段

- Tenant。
- Rental home。
- Email：脱敏邮箱和是否允许提醒。
- Tenant status。
- Next automatic email：提醒计划状态、时间和时区。
- Last email：最近结果和时间。
- Manage。

### 隐私规则

- 列表最多展示 500 条。
- 邮箱只显示首字符和域名，例如 `t***@example.com`。

## 5.10 Tenant and reminder editor

### 页面目标

把租客信息、租金到期日和每月提醒计划放在一个连续工作流中保存。

### Step 1：Tenant details

字段：

- Tenant name。
- Property address or name。
- Unit or suite。
- Email address。
- Email permission status：
  - Allowed。
  - Not confirmed。
  - Opted out。
  - Invalid。
  - Bounced。
  - Complained。
  - Suppressed。
- 当状态为 Allowed 时，必须勾选已确认该邮箱可接收租金提醒。
- This is a current tenant。

规则：

- 只有 Allowed 且已确认的邮箱可以启用自动邮件。
- 联系状态不是 Allowed 时，自动关闭邮箱首选渠道并取消确认。

### Step 2：Monthly rent plan

字段：

- Rent is due every month on：1–31。
- Send the reminder on day：1–31。
- Send at：本地时间。
- Email template：仅展示可用的邮件模板。
- Send this reminder automatically every month。

系统实时显示：

- 下一次租金到期日期。
- 下一封计划邮件的本地日期、时间和时区。
- 计划是否可以启用。
- 全局暂停、部署级暂停、模板缺失、联系许可不足、邮件服务非 Live 等阻塞原因。
- 明确说明“计划时间不是投递证明，最终结果以 Email activity 为准”。

### Advanced contact and timezone settings

默认折叠，包含：

- Timezone，使用 IANA 时区。
- Phone number，E.164 格式。
- Email / SMS 是否为首选联系方式。
- Email permission source / reason。
- SMS permission / source / reason。
- Contact permission notes。
- Internal notes。

### 页面操作

- Add tenant and set reminder。
- Save tenant and reminder。
- View email activity。
- Archive tenant：需要确认，同时停止未来提醒。

### 保存结果

区分以下结果：

- 租客与提醒计划均已保存，自动邮件已启用。
- 已保存，但全局发送暂停。
- 已保存，但邮件服务不是 Live。
- 租客和租金到期日已保存，自动邮件关闭。
- 租客已保存，但提醒计划保存失败。

## 5.11 Send a one-time rent reminder

### 页面目标

在不修改租客每月计划的情况下，安全发送一次额外的提醒邮件。

### 发送前系统状态

页面顶部显示：

- Reminder sending is paused。
- Live delivery。
- Test mode。
- Delivery disabled。

即使发送被阻塞，也允许用户先完成预览；被阻塞时不能最终确认发送。

### Step 1：选择收件人

选择方式：

- Choose specific tenants。
- All current tenants who can receive email。

具体租客列表：

- 只列出当前且未归档的租客。
- 邮箱缺失、未允许或不是首选渠道的租客不可选择，并显示原因。

选择一个可用的 Email template 后，点击 Review email and recipients。

### Step 2：确认预览

展示：

- 符合条件的收件人数。
- 将被跳过的人数。
- 示例邮件主题和正文。
- 可展开查看跳过的租客及原因。
- 当前批次状态：Not sent / Added to queue。

最终发送前必须：

- 勾选“已检查邮件和符合条件的收件人数”。
- 收件人数大于 0。
- 系统未暂停且邮件服务未 Disabled。
- 预览未过期，且预览后租客资格没有变化。

确认后：

- Live 模式：将邮件加入投递队列，不声称已经送达。
- Test mode：记录测试模式邮件，不发送真实邮件。
- 提供进入 Email activity 的按钮。

### Test email

默认折叠：

- 选择一名租客作为示例数据。
- 选择模板。
- Preview test email。
- 预览主题、正文和脱敏的管理员测试邮箱。
- 再确认 Send test email。
- 测试邮件永远发送到 Reminder settings 中的管理员测试邮箱，不发送给租客。

## 5.12 Email activity

### 页面目标

作为邮件是否真正发送或送达的唯一可信记录。

### 状态说明

- Waiting to send：尚未发送。
- Sent / delivered：服务商已接受或已送达。
- Needs attention：失败、跳过或结果需要人工检查。

### 筛选

- Tenant。
- Channel：All / Email / SMS。
- Status：
  - scheduled
  - processing
  - queued
  - sent
  - delivered
  - failed
  - undelivered
  - skipped
  - unknown
  - expired
  - cancelled
- From date。
- Through date。
- Apply filters。
- Refresh status。

### 列表字段

- Tenant。
- Email type：Automatic reminder / One-time reminder / Test / Retry。
- Result。
- 原因或状态解释。
- Sent to：脱敏地址。
- Planned time。
- Last update。
- Try again。

### 重试规则

- 只有 failed、undelivered、unknown 状态显示 Try again。
- 重试前确认。
- 原始记录保留，新建一条 retry 记录。
- 资格或联系方式发生变化时，提示先检查租客。

### 空状态

- 显示当前筛选没有结果。
- 提供 Send a one-time reminder 的入口。

## 5.13 Email templates

### 页面目标

创建和维护可供租客提醒计划与单次发送使用的模板。

### 字段

- Template name。
- Message type：Email / SMS；模板创建后不可切换类型。
- Email Subject。
- Message。
- Make this template available for rent reminders。

### 支持变量

- `{{tenant_name}}`
- `{{property}}`
- `{{unit}}`
- `{{due_date}}`
- `{{business_name}}`
- `{{business_phone}}`
- `{{business_email}}`

### 实时预览

- 使用示例租客数据渲染主题和正文。
- 未知变量或错误语法阻止保存。
- SMS 模板显示估算的消息段数。

### 页面行为

- 页面顶部先提供新建模板表单。
- 其后依次显示所有已有模板的编辑表单。
- 模板可以设为 Available to use 或 Not available。
- 更新模板不会删除过去邮件记录。

## 5.14 Reminder settings

### Automatic monthly emails

- 展示系统级状态：Sending paused / Ready to run。
- 说明暂停会保留每个租客的计划，但停止新的自动邮件。
- Pause all automatic emails 或 Turn automatic emails on。
- 操作前确认。
- 如果部署级暂停开启，说明后台开关不能覆盖部署级暂停。

### Email delivery

- 展示当前邮件服务和短信服务模式：
  - Live — can send。
  - Test mode — records only。
  - Off — cannot send。
- 凭证由托管环境管理，后台不展示密钥。

### Admin test destination

- Admin test email。
- Admin test phone，可选。
- Save admin test email。
- 单次发送页面的测试邮件使用这里的地址。

## 5.15 Automation overview

### 页面目标

集中展示 OpenClaw 自动化接入是否健康，以及是否有需要人工处理的导入或安全问题。

### 指标

- Active service accounts。
- Requests (24 hours)。
- Failures (24 hours)。
- Pending confirmations。

### 功能卡片

- OpenClaw service accounts。
- Import history。
- Automation audit。
- Delivery controls。

### Delivery controls

- Data backend。
- Email provider。
- SMS provider。
- Force pause。
- Global pause。

### 警告

- Automation API 被关闭。
- 自动化写入被关闭。
- 当前后端不支持生产级持久化导入。
- 存在未解决的租客导入行。
- 服务商已 Live 且提醒未暂停。

## 5.16 Automation service accounts

### 新建服务账号

字段：

- Account name。
- Expires，可选。
- Scopes，多选。

支持的 Scopes：

- `rentals:read`
- `rentals:write`
- `rentals:publish`
- `media:write`
- `tenants:read`
- `tenants:write`
- `tenants:import`
- `permissions:grant`
- `schedules:read`
- `schedules:write`
- `schedules:enable`
- `jobs:read`

对可发布房源、导入个人信息、授予联系许可和启用周期通信的敏感 Scope 显示明确后果。

### Token 单次展示

创建或轮换后：

- 展示原始 Token，仅一次。
- Copy token。
- Download text file。
- 必须勾选已保存到批准的密钥存储。
- Done 后从页面移除原始 Token。

### 服务账号列表

- Name 和 delegated admin。
- Active / Inactive。
- Scopes，可展开编辑。
- Token prefixes，不显示完整 Token。
- Last used。
- Rotate。
- Deactivate。

### 安全操作

- Rotate 生成新 Token，并撤销旧 Token。
- Deactivate 需要输入完整账号名称确认。
- 停用后阻止新的 API 请求，但保留历史。

## 5.17 Tenant import history

### 页面目标

查看由自动化流程创建的租客导入批次，同时限制原始个人信息暴露。

### 列表字段

- File 和摘要 Digest。
- Source。
- Status。
- Rows。
- New / Update 数量。
- Conflict / Invalid 数量。
- Retention：原始文件过期时间或已删除时间。
- Actions。

### 操作

- 下载 Sanitized errors，不包含完整联系方式。
- Cancel：只对尚未完成或取消的导入可用。
- Delete source：提前删除私有原始文件，保留审计和脱敏结果。

### 空状态

- 说明 OpenClaw 的导入预览会出现在此处。
- 明确说明完整地址和原始行不会显示。

## 5.18 Automation audit

### 页面目标

查看不可追加修改的自动化操作历史。

### 列表字段

- Time。
- Actor：服务账号。
- Action。
- Target：类型和缩短后的 ID。
- Request：缩短后的 Request ID。

### 隐私规则

- 不显示 Token、完整请求正文、完整 PII、消息正文、签名链接或服务商凭证。

### 空状态

- 说明成功的自动化写入会在此处出现，并包含服务账号归属。

## 5.19 Not Found

无法识别的 Admin 路由显示：

- This admin page does not exist。
- Back to overview。

不得显示公开网站的 404 页面或泄漏内部路由信息。

## 6. 核心任务流程

### 6.1 网站内容发布

Homepage / Shared content：

`内容列表 → 选择固定内容入口 → 编辑 → Save draft → Preview saved draft → 确认影响范围 → Publish → 对应公开位置更新`

Service page：

`Service pages → 选择固定页面 → 在六个区块中编辑 → 修正 Section validation → Save draft → 在对应公开 Route 预览 → 确认整页发布 → View live page`

必要规则：

- 草稿与公开内容分离。
- 存在未保存修改时先 Save and preview，不能预览旧草稿冒充当前输入。
- 发布前保存当前表单并通过完整页面校验。
- 每次发布产生一个历史版本。
- Service page、Shared Contact 和 Homepage section 均作为各自完整发布单元。
- 回滚也是一次立即改变公开网站的发布，需要确认。
- Shared Contact 发布前必须说明会同时影响 Homepage 与五个 Service popup。
- Slug、Route、CTA behavior 和页面结构由代码锁定。

### 6.2 房源发布

`房源列表 → 新建/编辑 → 上传或选择图片 → 选择封面 → 保存草稿 → 确认发布`

必要规则：

- 没有封面图不能发布。
- 已发布 Slug 不可修改。
- 下线保留草稿。
- 归档不永久删除历史。

### 6.3 新建租客与自动提醒

`租客列表 → Add tenant → 填写租客 → 确认邮箱许可 → 设置租金到期日 → 设置提醒日和时间 → 选择模板 → 查看下一次计划 → 保存`

必要规则：

- 联系许可、模板和系统状态共同决定能否启用提醒。
- 租客保存成功但计划保存失败时，必须明确告知“部分保存”。
- 页面本身不立即发送邮件。

### 6.4 单次邮件

`选择收件范围 → 选择模板 → 生成冻结预览 → 查看符合/跳过人数 → 确认人数 → 加入队列 → 到 Email activity 查看最终结果`

必要规则：

- 预览不是发送。
- 加入队列不是送达。
- 预览后资格发生变化必须重新预览。
- 发送请求保持幂等，避免重复发送。

### 6.5 服务账号创建

`输入名称和过期时间 → 选择最小 Scope → 最近 MFA 验证 → 创建 → 单次展示 Token → 复制或下载 → 确认已安全保存 → Done`

## 7. 全局状态模型

所有列表、表单和操作至少考虑：

- Loading。
- Empty。
- Ready。
- Unsaved changes。
- Saving / Processing。
- Success。
- Validation error。
- Permission or MFA error。
- Network / Database error。
- Stale resource / Version conflict。
- Feature disabled。
- Delivery paused。
- Provider test mode。
- Provider disabled。

状态必须用文字表达，不只依赖颜色或图标。

## 8. 校验与防误操作

- 必填字段在提交前通过浏览器和服务端双重校验。
- 邮箱格式必须有效。
- 电话使用 E.164。
- 时区使用有效的 IANA 名称。
- 日期范围的结束日期不能早于开始日期。
- 房源最多 20 张图片，只能有一张封面。
- 内容编辑严格遵守固定区块 Schema，不能插入任意 HTML 或脚本。
- Service page 的 Core services 与 Benefits 必须各为四项，Gallery 数量按模板锁定。
- Website Content 图片只能通过 Media picker 选择；图片缺失时可以保存草稿，但不能发布。
- 所有公开图片必须包含 Alt text。
- Website Content 的 Route、Slug、CTA destination、Section 数量与顺序不能通过普通 Admin 修改。
- 自动发送要求：租客当前有效、未归档、邮箱存在、邮箱允许、邮箱为首选渠道、模板可用、计划启用。
- 危险操作使用明确动词和后果描述，不使用含糊的 “Delete” 或 “OK”。
- 已经有新版本时拒绝静默覆盖。

## 9. 可访问性与响应式要求

- 全部功能可通过键盘操作。
- 焦点状态清晰。
- 表单控件具有可见 Label。
- 异步状态通过 `aria-live` 或等效机制读出。
- 错误使用 `role="alert"` 或等效机制。
- 表格有标题、表头和可横向滚动容器。
- 小屏时表格可以转为卡片或保留可访问的横向滚动。
- 状态不能只通过颜色表达。
- 确认对话框使用描述性标题和明确操作文案。
- Token 复制成功、保存结果、上传进度和发送结果应被辅助技术读出。
- 触控操作目标应满足移动端可用尺寸。

## 10. 当前范围与非目标

当前范围：

- 13 个固定 Website Content 入口：3 个 Shared、5 个 Homepage、5 个 Service page。
- 五个结构固定、整页发布和回滚的 Service page editor。
- Shared Contact popup 内容与公开电话的单一维护入口。
- Website Content Media picker、草稿预览、版本历史和冲突处理。
- 房源发布管理。
- 租客与每月租金提醒计划。
- 邮件优先的单次和自动提醒。
- 模板、测试发送、投递历史和重试。
- OpenClaw 服务账号、导入记录和审计。

不应在本轮 UI 中自行增加：

- 拖拽式网站搭建器。
- 任意新增页面或新增、删除、复制、拖拽排序网站区块。
- 自定义页面布局、CSS、HTML 或富文本脚本。
- Service page Process 或 FAQ editor。
- Header / Footer 的 Service page 级覆盖。
- 可编辑 Slug、Route 或 CTA behavior。
- Scheduled publishing、Approval workflow、多人评论或 Page analytics。
- SEO keyword scoring、多语言管理或 Forms builder。
- 租客登录门户。
- 在线收租。
- 欠款、账单、收据、滞纳金或会计功能。
- 维修工单。
- 租约文件管理或电子签名。
- 双向短信收件箱。
- 多公司 SaaS 结构。
- 自定义工作流引擎。

说明：

- 当前主要业务流程是 Email-first。
- 数据结构和部分模板 UI 保留 SMS 能力，但单次发送和自动提醒主流程不应假设 SMS 已经投入生产。

## 11. 功能验收清单

- 未登录用户无法读取任何 Admin 页面或私有数据。
- 管理员可以区分草稿、已发布、已下线和已归档状态。
- 网站内容保存草稿不会改变公开网站。
- 网站内容与房源发布均需要明确确认。
- `/admin/content` 显示 Shared、Homepage、Service pages 三组共 13 项。
- Website Content 列表同时显示 Draft state、Live state、Last published 和影响位置。
- 小屏 Website Content 使用 Stacked rows，不依赖横向表格。
- 五个 Service page 使用固定 Route，Admin 不提供 Slug 输入。
- Service editor 只包含 Hero、Core services、Highlight、Why choose us、Gallery、Final CTA 六段。
- Service editor 的 Core services 固定四项，不出现 Add、Remove、Drag、Process 或 FAQ。
- Homepage Property Services 显示五张固定服务卡，不再显示旧 Modal detail 与 Process 字段。
- Shared Contact editor 明确说明会影响 Homepage 与五个 Service popup，并提供 Popup preview。
- Media picker 不显示 Raw URL 或 Media UUID，缺失图片会阻止发布。
- Preview 打开对应 Homepage / Shared 或 Service route，并显示 Private draft banner。
- Sticky action bar 显示 Unsaved、Saving、Saved privately 和 Published 状态。
- Version history 使用友好版本号，不显示 Revision UUID 或 Schema version。
- Validation 可以在字段、Section navigation 和 Page summary 三层定位问题。
- Save error、Publish error、Version conflict 和 Session expiry 都保留或保护用户输入。
- 房源没有封面图时不能发布。
- 租客列表显示脱敏邮箱、提醒状态、下一次计划和最近投递。
- 租客自动邮件在许可不足、模板缺失或系统暂停时不能误启用。
- 单次发送必须经过预览和人数确认。
- 页面不会把“加入队列”描述为“已送达”。
- Email activity 可以筛选状态并为符合条件的失败记录创建重试。
- 测试邮件只发送到管理员测试邮箱。
- 全局暂停能阻止新的自动发送，并且不会删除租客计划。
- 自动化 Token 只显示一次。
- 导入记录与审计页面不暴露完整 PII 或密钥。
- 空状态、错误状态、处理中状态和版本冲突均有可执行的下一步。

## 12. UI 设计生成 Prompt

下面的 Prompt 可以直接交给 Figma AI、v0、Lovable、Cursor、Claude、ChatGPT 或其他 UI/原型生成工具。完整独立版本也见《Ting Ting Admin UI 功能设计 Prompt》。

```text
请为 “Ting Ting Admin” 设计一套桌面优先、支持响应式的后台管理 UI。只处理信息架构、页面结构、组件、字段、交互、状态和流程，不定义颜色、字体、插画、品牌视觉或具体设计风格。

产品背景：
这是一个小型房产经营后台，主要用户是 Ting Ting 和少量授权员工。后台连接公开网站、房源、租客资料、每月租金提醒邮件和 OpenClaw 自动化服务。用户不是技术人员，所以所有文案必须描述用户结果，不使用数据库、队列或 Provider 等内部术语，除非同时提供清楚解释。

全局布局：
- 持久侧边栏，分组为 Overview、Website、Rent management、System。
- 顶部显示页面标题、用途说明、当前管理员姓名/邮箱和退出按钮。
- 当前页面和所属父级导航保持选中。
- 主流程统一采用：上下文说明 → 输入 → 后果预览 → 一个主要动作 → 明确结果。
- 所有异步操作包含 loading、success、error、empty、disabled、version conflict 状态。
- 状态必须有文字，不能只用颜色表达。

侧边栏入口：
1. Home `/admin`
2. Website content `/admin/content`
3. Rental listings `/admin/rentals`
4. Tenants & schedules `/admin/tenants`
5. Send a one-time email `/admin/notifications/send`
6. Email activity `/admin/notifications/history`
7. Email templates `/admin/notifications/templates`
8. Reminder settings `/admin/settings`
9. Automation & imports `/admin/automation`

需要设计以下页面：

1. Login
- Email、Password、Sign In。
- 生产环境支持 TOTP：首次显示 QR code 和手动密钥，之后输入六位验证码。
- 包含密码错误、次数过多、会话过期、账号停用、MFA 错误和配置错误状态。

2. Overview
- 顶部显示自动邮件能否真实发送，并链接到 Reminder settings。
- 五个指标：Current tenants、Automatic reminders on、Emails planned in 7 days、Delivery problems、Waiting to send。
- Needs attention 警告。
- Last system check。
- Messages waiting to send。
- Recent emails 表格：Tenant、Type、Result、Masked destination、Planned time。

3. Website content

设计状态：
- 此模块按新版 Handoff 设计，属于 Design-ready、Implementation pending。
- 不沿用旧版“八个区块”模型。

内容列表 `/admin/content`：
- 页面固定分为 Shared across the website、Homepage、Service pages 三组，共 13 项。
- Shared across the website：Header and navigation、Contact form、Footer。
- Homepage：Homepage introduction、Rental search form、Property services overview、Featured rentals、About Ting Ting。
- Service pages：Renovation、Handyman service、Property maintenance、Strata service、Rental management。
- 每行显示名称、简短说明、Draft state、Live state、Last published、影响的公开位置和 Edit。
- 桌面端按分组展示列表；移动端转为 stacked rows，不能依赖横向滚动才能完成编辑。
- 不提供新增、删除、复制、拖拽或改变顺序。

固定 Service routes：
- Renovation：`/services/renovation`
- Handyman service：`/services/handyman-service`
- Property maintenance：`/services/property-maintenance`
- Strata service：`/services/strata-service`
- Rental management：`/services/rental-management`
- Admin editor：`/admin/content/services/[serviceKey]`
- Homepage / Shared draft preview：`/admin/preview/homepage/[sectionKey]`
- Draft preview：`/admin/preview/services/[serviceKey]`
- Admin 不提供 Slug 或 Route 输入。

Service Page Editor：
- 每个服务页是一个完整的保存、发布、版本与回滚单元。
- 桌面端采用三栏：左侧固定 Section navigation，中间编辑表单，右侧 Context help / Page status；移动端改为单栏。
- Section navigation 固定为 Hero、Core services、Highlight、Why choose us、Gallery、Final call to action（Final CTA）。
- 显示每段 Complete / Incomplete / Error，并可跳转到第一个错误字段。
- 不允许新增、删除、复制、拖拽或调整 Section 顺序；不设计 Process 或 FAQ。

Hero：
- Small heading：必填，单行，最多 80 字符。
- Main heading：必填，多行，最多 120 字符。
- Supporting text：必填，多行，最多 300 字符。
- Primary CTA：展示锁定结果 `Open contact form`，不能修改行为或目标。
- Hero image：必填，通过 Media picker 选择，显示预览、Replace、Remove。
- Image description：必填，最多 160 字符。
- Image focal point：必填，使用位置选择器，不显示 CSS 值。

Core services：
- Small heading：必填，最多 80 字符。
- Section heading：必填，最多 120 字符。
- 固定四张卡片，按 `Core service 1 of 4` 至 `4 of 4` 展示。
- 每张卡片包含 Service title（必填，最多 60 字符）、Description（必填，最多 180 字符）、Icon（必填）。
- Image 是否显示由页面模板决定；存在图片时 Image description 必填，最多 160 字符。
- 不提供 Add、Remove、Duplicate、Drag。

Highlight：
- Highlight title：必填，最多 80 字符。
- Highlight text：必填，最多 240 字符。
- Request service 按钮固定打开共享 Contact form，不提供按钮文字或链接目标。

Why choose us：
- Small heading：必填，最多 80 字符。
- Main heading：必填，最多 120 字符。
- Supporting text：必填，最多 500 字符。
- Section image 与 Image description 必填；Image description 最多 160 字符。
- Benefits 固定四项；每项包含 Benefit title、Benefit description 和 Icon。
- 不提供 Add、Remove、Duplicate、Drag。

Gallery：
- 此段也可按页面文案显示为 Included services。
- Small heading 与 Section heading 必填。
- Item 数量由页面模板锁定：Renovation 固定 3 项，其余四个服务页固定 4 项。
- 每个 Item 包含 Title、Description、Image、Image description，全部必填。
- Image 通过 Media picker 选择；空 Slot 可保存草稿，但阻止发布。

Final CTA：
- CTA heading：必填，最多 120 字符。
- CTA supporting text：必填，最多 240 字符。
- CTA behavior 固定为 `Open contact form`，共享公开电话固定取自 Shared Contact。
- 不能改 CTA destination。

Homepage Property Services：
- 编辑 5 张固定卡片，对应五个 Service pages。
- 主区字段为 Small heading、Main heading、Supporting text、Main section CTA label。
- 每张卡片仅编辑 Display title、Short description、Homepage link label、Icon。
- Destination route 只读。
- 删除旧 Modal detail 与 Process heading / description / steps 字段。

Shared Contact form：
- 这是 Contact popup 内容与公开电话的单一维护入口。
- 明确提示发布会同时影响 Homepage contact section、五个 Service popup，以及 Hero / Final CTA 使用的公开电话。
- 字段包含 Contact heading、Supporting text、Public phone number、Public email、各表单字段 Label、联系偏好选项 Label、Submit button label、Success message、Error message。
- 提供 Popup preview。

4. Website Content Media Picker
- 在所有图片字段中以专用选择器打开，不显示 Raw URL 或 Media UUID。
- 支持搜索，按 All / Draft / Published 筛选。
- 每个媒体项显示缩略图、文件名、尺寸、宽高比、Alt text 状态和 Public availability。
- 支持 Select、Replace、Remove；选择后可设置 Focal point。
- 选择器内支持上传，并显示逐文件进度、成功、失败和重试。
- 新上传图片在所需元数据完成前保持 Draft。
- 图片缺失或不可公开时允许 Save draft，但阻止 Publish，并在字段、Section navigation 和 Page summary 三层显示问题。

Website Content 固定操作栏：
- 页面底部使用 Sticky action bar。
- 主要操作：Save draft、Preview saved draft、Publish。
- 状态：Unsaved changes、Saving、Saved privately、Publishing、Published、Save error、Publish error。
- 如果当前有未保存修改，Preview 使用 `Save and preview`，不能用旧草稿冒充当前输入。
- Draft preview 显示 Private draft banner，并提供返回 Admin 的入口。
- Publish confirmation 说明影响范围；成功后提供 View live page。

Version history：
- 使用 Version N、发布人、发布时间、Live 标记。
- 支持 Preview version 与 Restore and publish。
- 回滚需要确认，并生成一个新的公开版本。
- 不向普通管理员展示 Revision UUID 或 Schema version。

冲突与会话：
- 发现更新版本时不静默覆盖，显示 Version conflict，并支持 Reload latest 与 Copy unsaved text。
- Session expiry 必须保留当前输入，重新登录后可继续。

5. Rental listings
- 列表显示 Title/Address、Monthly rent、Website status、Edit。
- Add rental listing。
- 编辑字段：slug、title、address、neighbourhood、city、monthly rent、bedrooms、bathrooms、square feet、available date、homepage order、pet policy、description。
- 从媒体库选择最多 20 张图片，选一张封面并调整顺序。
- 操作：Save without publishing、Publish to website、Remove from website、Archive。
- 没有封面不能发布；首次发布后 slug 只读。

6. Tenants & schedules
- 列表支持搜索姓名/物业/单元。
- 筛选 Tenant status、Email readiness、Automatic reminder。
- 表格显示 Tenant、Rental home、Masked email、Tenant status、Next automatic email、Last email、Manage。
- 新建/编辑为两步连续表单：
  Step 1 Tenant details：name、property、unit、email、email permission status、permission confirmation、current tenant。
  Step 2 Monthly rent plan：rent due day、reminder day、send time、email template、automatic email toggle。
- 实时显示下一次租金到期日、下一封计划邮件和系统阻塞原因。
- Advanced 区域放 timezone、E.164 phone、SMS 记录、permission source/reason、contact notes、internal notes。
- 操作：Add/Save tenant and reminder、View email activity、Archive tenant。
- 清楚区分全部保存成功与“租客已保存但提醒计划失败”。

7. Send a one-time email
- 顶部先展示 Live/Test/Paused/Disabled 状态。
- 收件方式：specific tenants 或 all eligible current tenants。
- 不符合资格的租客不可选并显示原因。
- 选择模板后先生成预览。
- 确认区显示 eligible count、skipped count、邮件主题/正文、跳过名单。
- 用户必须勾选已检查收件人数才能发送。
- 结果只能说 Added to queue 或 Test-mode recorded，不能直接说 Delivered。
- 提供 Email activity 入口。
- Advanced 区域提供 Send a test email to yourself，测试地址来自 Reminder settings。

8. Email activity
- 顶部解释 Waiting、Sent/Delivered、Needs attention。
- 筛选 Tenant、Channel、Status、From date、Through date。
- Refresh status。
- 表格显示 Tenant、Email type、Result + reason、Masked destination、Planned time、Last update、Retry。
- failed/undelivered/unknown 可以确认后 Try again，保留原记录并新增 retry 记录。

9. Email templates
- 新建表单在顶部，已有模板在下方。
- 字段：name、Email/SMS type、subject、message、active。
- 支持变量 tenant_name、property、unit、due_date、business_name、business_phone、business_email。
- 右侧实时渲染示例预览；错误变量阻止保存；SMS 显示段数估算。

10. Reminder settings
- Automatic monthly emails：全局暂停/恢复，需要确认；部署级暂停不可被 UI 覆盖。
- Email delivery：展示 Email 和 SMS 是 Live、Test mode 或 Off，不显示凭证。
- Admin test destination：测试邮箱和可选测试手机。

11. Automation & imports
- Overview 指标：Active service accounts、Requests 24h、Failures 24h、Pending confirmations。
- 显示 API/写入开关、持久化后端、未解决导入、Provider 和 Pause 警告。
- Service accounts：创建 name、expiry、scopes；创建或轮换后 Token 只展示一次，支持 Copy、Download、确认已安全保存；列表可改 scopes、Rotate、Deactivate。
- Import history：File/Digest、Source、Status、Rows、New/Update、Conflict/Invalid、Retention；支持下载脱敏错误、Cancel、Delete source。
- Audit：Time、Actor、Action、Target、Request ID prefix；禁止显示完整 PII、Token、消息正文或密钥。

关键交互规则：
- 保存必须说明是否影响公开网站。
- Website Content 的 Save draft 不改变公开网站；Service page、Homepage section 与 Shared item 分别作为完整发布单元。
- Publish 前自动保存并执行整页校验；Restore and publish 会立即改变公开内容并创建新版本。
- Website Content 必须同时提供字段级错误、Section 状态和 Page summary。
- “Waiting to send”绝不能写成“Sent”。
- 发布、下线、归档、批量发送、全局暂停、重试和停用账号必须确认。
- 请求处理中禁用重复提交。
- 版本冲突不覆盖，提示刷新。
- 表格提供空状态、筛选无结果状态和响应式处理。
- 完整键盘操作，清晰 Label，异步结果可被屏幕阅读器读出。
- 检查 1440、1024、768、375 px；移动端操作区堆叠，不能产生功能性横向溢出。
- 触控目标至少 44 × 44 px；焦点进入错误摘要后可跳到对应字段。

不要增加：
- 拖拽建站器、任意新增页面或网站区块、复制/删除/排序固定 Section。
- 自定义 HTML、CSS、布局、Slug、Route 或 CTA behavior。
- Service page Process / FAQ、Header / Footer 页面级覆盖。
- Scheduled publishing、Approval workflow、多人评论、Page analytics、SEO scoring、多语言或 Forms builder。
- 租客门户、在线收租、会计账本、维修工单、租约文件、双向短信收件箱、多公司 SaaS、复杂角色系统或自定义工作流引擎。

请输出：
1. 完整 sitemap。
2. 每个页面的低保真结构说明。
3. 页面内组件层级。
4. 每张表单的字段、默认值、必填和禁用逻辑。
5. 表格列、筛选和空状态。
6. 关键确认弹窗文案与成功/失败反馈。
7. 桌面与移动端响应式行为。
8. 可访问性注释。
9. 五个关键流程：Website Content 发布/回滚、房源发布、租客提醒设置、单次邮件、服务账号创建。
10. Website Content 专项画面：
   - `/admin/content` 桌面与移动版，以及三个分组的 Draft / Live 状态组合。
   - Service editor 桌面三栏与移动单栏，完整展示六个固定 Section。
   - Core services 固定四项、Gallery 固定 Slot、Shared Contact 与 Popup preview。
   - Media picker 的默认、搜索、筛选、上传、缺图阻塞发布状态。
   - Sticky action bar、Private draft preview、Publish confirmation、Version history。
   - Loading、Save error、Publish error、Version conflict、Session expiry。
11. 每个关键画面附工程注释，标明固定数量、锁定字段、字符限制、Alt text、校验与数据影响范围。
```
