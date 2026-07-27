# Website Content Admin — Design Handoff

更新日期：2026-07-27  
项目：Ting Ting Xu Real Estate  
主要页面：`/admin/content`  
文档用途：交付给 UI/UX 设计师、产品设计师及后续前端/后端开发  
状态：Design-ready；Backend content foundation implemented；Admin redesign pending

---

## 1. Handoff 目标

重新设计 Admin 中的 **Website content**，让非技术管理员可以清楚地完成以下工作：

1. 找到需要修改的公开网页或共享内容。
2. 编辑 Homepage 的既有内容。
3. 编辑最新增加的五个 Service pages。
4. 保存为不会影响线上网站的草稿。
5. 预览已保存的草稿。
6. 明确确认后发布。
7. 在出错时理解发生了什么，并能恢复之前发布的版本。

本次重点不是自由建站，而是为一组结构固定的页面提供安全、清楚、可预览、可回滚的内容编辑体验。

---

## 2. 当前网站内容范围

### 2.1 Homepage

Homepage 当前包含：

1. Header and navigation
2. Homepage introduction
3. Rental search form
4. Property services overview
5. Featured rentals
6. About Ting Ting
7. Contact form
8. Footer

### 2.2 新增 Service pages

| Admin 名称 | 公开路由 | Homepage 入口 |
|---|---|---|
| Renovation | `/services/renovation` | Renovation |
| Handyman service | `/services/handyman-service` | Handyman Services |
| Property maintenance | `/services/property-maintenance` | Property Maintenance |
| Strata service | `/services/strata-service` | Strata Services |
| Rental management | `/services/rental-management` | Rental Management |

### 2.3 全站共享内容

以下内容不是某一个 Service page 独有：

- Navbar 来自 **Header and navigation**。
- Footer 来自 **Footer**。
- Contact popup 的标题、说明、字段标签、提交状态来自 **Contact form**。
- Hero 的电话按钮使用 Contact form 中的公开电话号码。
- Hero 按钮行为固定为：
  - `Contact us` → 打开 Contact popup。
  - `Call 604-872-6896` → 电话链接。
- 页面其他服务 CTA → 打开同一个 Contact popup。

---

## 3. 已确认的产品规则

这些规则在设计稿中不能变成自由配置：

1. Service page 数量固定为五个。
2. Service page 的 route/slug 固定，不允许 Admin 修改。
3. 每个 Service page 的 **Core services 固定为四项**。
4. 每个 Service page 不显示 Process。
5. 每个 Service page 不显示 FAQ。
6. Navbar 与 Footer 不在 Service page 编辑器中重复编辑。
7. Contact popup 只维护一份共享内容。
8. Hero 必须保留两个按钮，按钮文字与行为由代码控制。
9. 其他服务 CTA 的行为由代码控制，不提供 URL 输入框。
10. 不允许增加、删除或拖拽重排页面区块。
11. 不允许输入 HTML、脚本或自定义 CSS。
12. 图片只能从 Media library 中选择。
13. 每个页面作为一个整体发布和回滚，不能只发布页面中的单个区块。

---

## 4. 当前实现与设计目标之间的差距

### 4.1 当前 Admin

当前 `/admin/content`：

- 使用一张表显示八个 Homepage section。
- 点击 `Edit section` 进入通用递归字段编辑器。
- 提供：
  - Save without publishing
  - Preview on website
  - Publish to website
  - Restore and publish previous version
- Media library 位于编辑器上方，可展开。

### 4.2 当前后端基础

截至 2026-07-27，五个 Service page 已经进入：

- 固定 section registry；
- 严格 Zod schema；
- Memory 与 Supabase repository；
- draft、preview、publish、revision 和 rollback 流程；
- Media library asset reference；
- 公开页面的 published-content-only 读取边界。

旧的 `property_services` modal detail 与 Process 字段也已通过 schema v3 和向前数据库迁移清理。

### 4.3 当前剩余断层

后台功能可通过现有通用内容编辑器操作，但 `/admin/content` 仍使用未分组的表格，Service page 仍使用通用递归字段编辑器。本文档要求的分组信息架构、专用 Service page editor、状态轨迹和 sticky publish bar 仍待设计及前端实现。

### 4.4 设计目标

新的 Admin 设计需要：

- 保留现有草稿、预览、发布、回滚安全模型。
- 把 Homepage、Service pages 和 Shared content 分组。
- 用针对页面结构的编辑器替代难以理解的通用 JSON 树状表单。
- 明确区分“编辑内容”和“改变网站结构”。
- 不向管理员暴露 `schemaVersion`、`mediaAssetId`、array index 或内部 key。

---

## 5. 设计方向

### Purpose

让管理员快速回答三个问题：

1. 我正在修改哪个公开页面？
2. 我的修改现在是私有草稿还是已经上线？
3. 点击当前按钮后，线上网站会不会改变？

### Audience

Ting Ting 和少量授权员工。用户熟悉业务内容，但不应被要求理解数据结构、schema、revision ID 或部署概念。

### Tone

- Calm utilitarian
- Professional
- Outcome-led
- Scannable
- Low cognitive load

### Memorable detail

每个内容条目都用一个清楚的 **Draft → Preview → Publish** 状态轨迹表示当前进度，而不是只显示一个模糊的 “Status”。

### Existing constraints

- 沿用 `DESIGN.md` 的 Admin 设计系统。
- 使用现有绿色、暖白、边框、状态颜色和按钮体系。
- 不引入新的 UI framework。
- 桌面优先，但手机必须可完成紧急文字修改和发布。
- 所有状态必须同时使用文字，不能只靠颜色。

---

## 6. Website Content 信息架构

```text
Website content
├── Shared across the website
│   ├── Header and navigation
│   ├── Contact form
│   └── Footer
├── Homepage
│   ├── Homepage introduction
│   ├── Rental search form
│   ├── Property services overview
│   ├── Featured rentals
│   └── About Ting Ting
└── Service pages
    ├── Renovation
    ├── Handyman service
    ├── Property maintenance
    ├── Strata service
    └── Rental management
```

说明：

- Header、Contact、Footer 从 Homepage 分组移到 Shared，原因是它们已影响多个页面。
- Homepage 仍保留五个只属于首页的编辑入口。
- Service pages 每页是一个发布单元。
- Rental listing 的实际房源内容继续在 `/admin/rentals` 管理，不在 Website content 重复出现。

---

## 7. `/admin/content` 页面结构

### 7.1 Page header

内容：

- Title：`Website content`
- Description：`Edit the words and images visitors see. Saving keeps changes private; publishing makes them live.`
- Secondary action：`View live website`
- 可选 compact summary：
  - `13 content areas`
  - `X unpublished drafts`
  - `Last website publish: [date/time]`

summary 只用于帮助扫描，不做成大型 Dashboard 指标卡。

### 7.2 Workflow note

保留现有说明，但改成四步状态轨迹：

```text
Edit → Save draft → Preview → Publish
```

辅助文案：

`Saved drafts are private. Visitors only see a change after you publish it.`

### 7.3 Content groups

依次显示：

1. Shared across the website
2. Homepage
3. Service pages

每组包含：

- Group title
- 一句话说明影响范围
- 内容条目列表

不使用 group card 再嵌套 content card。建议使用分组标题加同一张列表/表格。

### 7.4 Content row

每行显示：

| 字段 | 说明 |
|---|---|
| Name | 用户可理解的页面或内容名称 |
| Location | 公开位置或 route |
| Draft state | `No unpublished changes` / `Unpublished draft` |
| Live state | `Live on website` / `Not published` |
| Last published | 本地日期与时间 |
| Action | `Edit` |

Service page 行可增加一张 64×40 的 Hero thumbnail，但不能让图片抢过状态和页面名称。

### 7.5 Row examples

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

### 7.6 Sorting and search

当前只有 13 个固定内容条目，不需要搜索、筛选或自定义排序。

分组和固定顺序比搜索更容易理解。

### 7.7 Mobile behavior

在小屏幕上，每行改为纵向：

```text
[Name]
[Location]
[Draft state] [Live state]
Last published …
[Edit]
```

- 不使用需要横向滚动的表格。
- `Edit` 至少 44px 高。
- 状态文字可以换行，但不能被截断。

---

## 8. Service Page Editor 页面

### 8.1 Route

建议 Admin route：

```text
/admin/content/services/[serviceKey]
```

固定 key：

```text
renovation
handyman
maintenance
strata
rental_management
```

公开 slug 与 Admin key 的映射由代码管理。

### 8.2 Header

结构：

```text
Website content / Service pages / Renovation

Renovation
Edit the content shown at /services/renovation.

[Unpublished draft] [Live on website]
[Open live page]
```

如果页面存在未发布修改：

`Your saved draft is newer than the live website.`

如果当前没有未发布修改：

`The saved content matches the live website.`

### 8.3 Desktop layout

```text
┌──────────────────────────────────────────────────────────┐
│ Breadcrumb + page title + live/draft status              │
├───────────────┬──────────────────────────┬───────────────┤
│ Section nav   │ Editor form              │ Page summary  │
│               │                          │ / history     │
│ Hero          │ Active section fields    │ Status        │
│ Core services │                          │ Route         │
│ Highlight     │                          │ Last publish  │
│ Why choose us │                          │ Version hist. │
│ Gallery       │                          │               │
│ Final CTA     │                          │               │
├───────────────┴──────────────────────────┴───────────────┤
│ Save draft · Preview saved draft · Publish               │
└──────────────────────────────────────────────────────────┘
```

Recommended widths：

- Section navigation：180–220px
- Main editor：minmax(520px, 1fr)
- Status/history rail：260–300px

在 1024px 以下隐藏右侧 rail，将 Version history 改为 drawer 或页面底部折叠区。

### 8.4 Section navigation

固定六项：

1. Hero
2. Core services
3. Highlight
4. Why choose us
5. Gallery
6. Final call to action

要求：

- 点击后滚动到对应表单区。
- 当前区块有明确选中状态。
- 有验证错误的区块显示 `Needs attention`。
- 不提供 Add section、Remove、Duplicate 或 Drag handle。
- 不显示 Process 或 FAQ。

---

## 9. Service Page Editor 字段

## 9.1 Hero

| Admin label | 数据 | 必填 | 限制/控件 |
|---|---|---:|---|
| Small heading | `eyebrow` | 是 | 单行，最多 80 字符 |
| Main heading | `title` | 是 | 多行，最多 120 字符 |
| Supporting text | `description` | 是 | textarea，最多 300 字符 |
| Hero image | `heroImage` | 是 | Media picker |
| Image description | Hero alt | 是 | 最多 160 字符 |
| Image focal point | `heroPosition` | 是 | 九宫格 focal-point picker，不显示 CSS 值 |

只读提示：

```text
The Contact us and Call buttons are shared across all service pages and cannot be changed here.
```

不显示：

- CTA label 输入框
- CTA URL 输入框
- Phone number 输入框
- Slug 输入框

## 9.2 Core services

顶部字段：

| Admin label | 数据 | 必填 | 限制 |
|---|---|---:|---|
| Small heading | `servicesEyebrow` | 是 | 最多 80 字符 |
| Section heading | `servicesTitle` | 是 | 最多 120 字符 |

固定显示四个 item editor：

| Item field | 必填 | 限制/控件 |
|---|---:|---|
| Service title | 是 | 最多 60 字符 |
| Description | 是 | 最多 180 字符 |
| Icon | 是 | Approved icon picker，显示图标预览和名称 |
| Image | 视模板而定 | Optional Media picker |
| Image description | 有图片时必填 | 最多 160 字符 |

结构规则：

- 页面上始终显示 `4 of 4 services`。
- 不显示 Add 或 Remove。
- 默认不允许管理员改变四项顺序。
- 如果未来需要顺序调整，使用 `Move up` / `Move down`，不使用拖拽。
- Renovation 当前四项带图片。
- 其他四个页面当前使用 icon-only card。
- UI 需要清楚说明上传图片是否会在当前模板中显示。

## 9.3 Highlight

| Admin label | 数据 | 必填 | 限制 |
|---|---|---:|---|
| Highlight title | `highlightTitle` | 是 | 最多 80 字符 |
| Highlight text | `highlightBody` | 是 | 最多 240 字符 |

只读说明：

`The Request service button opens the shared contact form.`

不提供 button label 或 link destination。

## 9.4 Why choose us

主内容：

| Admin label | 数据 | 必填 | 限制/控件 |
|---|---|---:|---|
| Small heading | `storyEyebrow` | 是 | 最多 80 字符 |
| Main heading | `storyTitle` | 是 | 最多 120 字符 |
| Supporting text | `storyBody` | 是 | 最多 500 字符 |
| Section image | `storyImage` | 是 | Media picker |
| Image description | `storyImageAlt` | 是 | 最多 160 字符 |

Benefits 固定四项：

| Item field | 必填 | 限制 |
|---|---:|---|
| Benefit title | 是 | 最多 60 字符 |
| Benefit description | 是 | 最多 180 字符 |
| Icon | 是 | Approved icon picker |

`storyFirst` 是模板布局决定，不提供普通 Admin 开关。

## 9.5 Gallery / Included services

顶部：

| Admin label | 数据 | 必填 |
|---|---|---:|
| Small heading | `galleryEyebrow` | 是 |
| Section heading | `galleryTitle` | 是 |

Gallery item：

| Item field | 必填 | 限制 |
|---|---:|---|
| Title | 是 | 最多 60 字符 |
| Description | 是 | 最多 180 字符 |
| Image | 是 | Media picker |
| Image description | 是 | 最多 160 字符 |

数量：

- Renovation 当前为三项。
- Handyman、Property maintenance、Strata、Rental management 当前为四项。
- 第一版 Admin 保持当前模板数量，不提供 Add/Remove。

## 9.6 Final call to action

| Admin label | 数据 | 必填 | 限制 |
|---|---|---:|---|
| CTA heading | `ctaTitle` | 是 | 最多 120 字符 |
| CTA supporting text | `ctaBody` | 是 | 最多 240 字符 |

只读说明：

```text
This section always shows Contact us and the shared public phone number.
```

---

## 10. Homepage Property Services Editor

旧的 modal detail 与 Process 数据已经不再对应公开网站，新设计不能继续展示这些字段。

### Editable section fields

- Small heading
- Main heading
- Supporting text
- Five fixed Homepage service cards
- Main section CTA label

### Five fixed card fields

每张 card：

- Display title
- Short description
- Homepage link label
- Icon

固定链接：

| Card | Destination |
|---|---|
| Renovation | `/services/renovation` |
| Handyman Services | `/services/handyman-service` |
| Property Maintenance | `/services/property-maintenance` |
| Strata Services | `/services/strata-service` |
| Rental Management | `/services/rental-management` |

Destination 不提供文本输入框，只显示为只读信息：

`Opens the Renovation service page.`

### Remove from Admin

- Detail eyebrow
- Detail heading
- Included services
- Process heading
- Process description
- Modal CTA labels

---

## 11. Shared Contact Form Editor

Contact form 同时影响：

- Homepage contact section
- 五个 Service page 的 Contact popup
- Hero 和 Final CTA 中显示的公开电话号码

### Impact notice

页面顶部必须显示：

```text
Changes here affect the homepage contact section and the contact popup on all five service pages.
```

### Fields

| Admin label | 必填 | 控件/限制 |
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
| Email option label | 是 | Order locked |
| Phone option label | 是 | Order locked |
| SMS option label | 是 | Order locked |
| Submit button label | 是 | 最多 40 字符 |
| Success message | 是 | 最多 240 字符 |
| Error message | 是 | 最多 240 字符 |

右侧 preview 显示居中的 Contact popup，使用非交互预览或沙盒表单，避免误提交。

---

## 12. Media Picker 设计

不要让管理员看到 raw URL 或 media UUID。

### Trigger

```text
[Current image preview]
Filename · 1600 × 900 · Published
[Choose another image] [Remove]
```

### Picker

- 搜索 filename 或 alt text。
- 筛选 All / Draft / Published。
- 显示 aspect ratio。
- 显示该图片是否可以公开使用。
- 支持 `Upload new images`。
- 选择后显示 crop/focal-point preview。
- Draft image 在页面发布时必须一起通过媒体发布校验。

### Missing image

如果当前内容引用的图片不存在：

```text
This image is unavailable. Choose a replacement before publishing.
```

Save draft 可以继续；Publish 必须阻止。

---

## 13. Save、Preview、Publish

### 13.1 Sticky action bar

顺序：

1. `Save draft`
2. `Preview saved draft`
3. `Publish to website`

状态说明位于按钮左侧：

- `No unsaved changes`
- `Unsaved changes`
- `Saving…`
- `Saved privately at 5:42 AM`
- `Published at 5:48 AM`

### 13.2 Save draft

结果文案：

```text
Draft saved. Visitors still see the currently published version.
```

Save draft：

- 不需要确认。
- 请求中禁止重复提交。
- validation error 时禁用并链接到第一个错误区块。

### 13.3 Preview saved draft

预览必须打开对应 route，而不是总是打开 Homepage：

```text
/admin/preview/homepage/[sectionKey]
/admin/preview/services/[serviceKey]
```

预览 banner：

```text
Previewing a private draft of Renovation.
Visitors cannot see this version.
```

如果有尚未保存的修改：

```text
Save your changes before previewing them.
```

提供：

- `Save and preview`
- `Continue editing`

### 13.4 Publish confirmation

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

### 13.5 Publish success

```text
Published. Visitors can now see this version.
```

提供：

- `View live page`
- `Continue editing`

不能只显示 toast；页面内必须保留可被屏幕阅读器读取的结果。

---

## 14. Version History

### Entry point

右侧 rail 或页面顶部 action：

`Version history`

### History row

显示：

- Published date/time
- Published by
- Version number（只显示友好编号，例如 `Version 12`）
- `Currently live`
- `Preview`
- `Restore`

不要显示 revision UUID 或 schema version。

### Restore confirmation

```text
Restore and publish this version?

The selected version will become live immediately.
Your current draft and the current live version will remain in version history.

[Cancel] [Restore and publish]
```

### Restore success

```text
Version restored and published. Visitors now see the selected version.
```

---

## 15. Validation

### Field-level

- Error 显示在字段下方。
- 错误文字说明如何修正。
- 不只使用红色边框。
- 失焦时验证，提交时完整验证。

示例：

```text
Main heading is required.
Keep this description under 180 characters.
Choose an image before publishing.
Add an image description for screen-reader users.
```

### Section-level

Section navigation 显示：

```text
Core services · 2 issues
```

### Page-level

Publish 被阻止时：

```text
This page cannot be published yet. Review 3 fields that need attention.
```

点击后聚焦第一个错误。

---

## 16. System states

### Loading

- Content list 使用稳定 skeleton rows。
- Editor 保留布局宽度，避免加载时跳动。
- 图片使用比例占位。

### Empty

固定内容不应出现整个列表为空的正常状态。

如果 backend 未初始化：

```text
Website content has not been set up.
Contact the site administrator before making changes.
```

### Save error

```text
Your draft could not be saved. Your changes are still in this browser.
Try again before leaving this page.
```

### Publish error

```text
The draft was saved, but it could not be published.
Visitors still see the previous live version.
```

### Version conflict

```text
This content was changed in another session.
Your changes have not been overwritten.

[Review latest version] [Copy my changes]
```

第一版可以要求刷新后重新应用，但绝不能静默覆盖。

### Session expiry

先保留本地未提交输入，再提示重新登录。登录后尽量恢复编辑状态。

---

## 17. Responsive behavior

### 1440px+

- 左侧 section nav、中央表单、右侧 status/history。
- Sticky action bar 保持可见。
- 表单最大阅读宽度约 720px。

### 1024px

- 左侧 section nav + 中央表单。
- Status/history 移到 drawer。
- 图片 picker 仍可双列展示。

### 768px

- Section nav 变成顶部横向 scroll tabs 或 select。
- 表单单列。
- Sticky actions 可以两行，但 Publish 保持明显。

### 375px

- Page header、状态和 action 纵向。
- Content list 使用 stacked rows。
- Editor 每个字段单列。
- Media picker 以 full-screen sheet 打开。
- Sticky action bar 只固定主要操作：
  - `Save draft`
  - `Publish`
- Preview 放入 `More actions`，但必须保持键盘和屏幕阅读器可发现。
- 所有按钮和 icon controls 至少 44×44px。
- 不允许横向页面溢出。

---

## 18. Accessibility Handoff

1. 页面只使用一个 `h1`。
2. 每个 editor section 使用 `h2`。
3. Item editor 使用 fieldset + legend，例如 `Core service 1 of 4`。
4. 所有 input 有可见 label。
5. 字符计数使用辅助文字，不抢占错误消息。
6. 状态 pill 必须包含文字。
7. Save/publish 结果使用 `aria-live="polite"`。
8. Publish failure 使用 `role="alert"`。
9. Confirmation dialog：
   - 初始焦点在标题或 Cancel。
   - Escape 关闭。
   - 关闭后焦点返回触发按钮。
10. Section navigation 必须可键盘操作。
11. Icon picker 每个图标有可读名称。
12. 图片预览必须显示当前 alt text。
13. 不使用颜色区分 Draft、Live、Error 的唯一含义。
14. Reduced motion 下取消非必要滚动动画。

---

## 19. Component hierarchy

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

---

## 20. Engineering prerequisites

此部分不是要求设计师解决，而是说明设计依赖的实现工作。以下后端前置条件已于 2026-07-27 完成；专用 Admin UI 尚待实现。

### 20.1 Service page content model

五个 Service page 应成为五个固定、可版本化的内容文档。

推荐每页一次性保存、发布、回滚，不要把 Hero、Gallery 等拆成可独立发布的记录。

已使用以下固定内部 section key：

```text
service_renovation
service_handyman
service_maintenance
service_strata
service_rental_management
```

### 20.2 Schema

为 `ServicePageData` 建立严格 Zod schema：

- Core services 必须是 exactly 4。
- Benefits 必须是 exactly 4。
- Gallery 数量按模板固定。
- Slug 和 CTA behavior 不接受 Admin 输入。
- 图片引用改为 media asset reference，不继续保存外部图片 URL。
- 所有图片必须有 alt text。

### 20.3 Migration

将当前：

```text
src/features/content/service-pages.ts
```

内容作为初始 published content 导入。

迁移后：

- 公开页面只读取 published content。
- Admin 读取 draft content。
- 旧的 `property_services.detail.process*` 字段停止显示并通过 schema migration 清理。

### 20.4 Preview

现有 preview 只渲染 Homepage，需要增加 Service page preview loader 和 route。

### 20.5 Revision

每次发布 Service page 都创建 revision。

回滚必须：

- 恢复整个页面；
- 立即发布；
- 保留当前版本历史；
- 写入 Admin audit。

---

## 21. Out of scope

不要在本轮设计中加入：

- Drag-and-drop page builder
- 任意新增页面
- 任意新增区块
- 自定义布局
- 自定义 CSS
- 富文本 HTML 编辑器
- SEO keyword scoring
- 多语言管理
- Scheduled publishing
- Approval workflow
- 多人评论
- Page analytics
- Forms builder
- FAQ 或 Process editor
- Header/Footer 的 page-level override

---

## 22. Acceptance criteria

设计交付完成时必须包含：

1. `/admin/content` desktop 和 mobile 设计。
2. 三个内容分组的完整状态。
3. Service page editor 的 desktop 和 mobile 设计。
4. 六个固定编辑区块。
5. Core services exactly four 的 UI。
6. Shared Contact form 的 impact notice 和 popup preview。
7. Media picker。
8. Draft、saved draft、live、not published 状态。
9. Loading、empty、validation、save error、publish error、version conflict。
10. Preview banner。
11. Publish confirmation。
12. Version history 和 restore confirmation。
13. Sticky action bar。
14. Field character limits 和 image alt text。
15. Keyboard focus、dialog、live region 和 mobile touch target 标注。
16. 不出现 Process 或 FAQ。
17. 不提供 slug、route、CTA behavior 或页面结构的自由输入。

---

## 23. Suggested design deliverables

建议 Figma 最少包含：

```text
01 Website content — default
02 Website content — unpublished drafts
03 Website content — mobile
04 Service page editor — Hero
05 Service page editor — Core services
06 Service page editor — Why choose us + Gallery
07 Service page editor — validation errors
08 Service page editor — mobile
09 Shared Contact editor + popup preview
10 Media picker
11 Preview banner
12 Publish confirmation
13 Publish success / failure
14 Version history
15 Version conflict
```

设计 annotation 应标明：

- 哪些字段可编辑；
- 哪些行为由代码锁定；
- 哪些内容影响多个公开页面；
- 哪些操作只保存草稿；
- 哪些操作会立即改变公开网站。
