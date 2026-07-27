# Ting Ting Admin UI 功能设计 Prompt

> 2026-07-27 修订：文中旧的租客级 reminder plan 仅作历史背景。当前实现为
> “租客 Payment due date + 全局 Reminder settings”，不得重新引入租客级发送日、
> 时间、template、channel 或 enable/disable 控件。

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
