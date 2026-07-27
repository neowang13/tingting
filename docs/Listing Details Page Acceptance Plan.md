# Listing Details 页面验收文档

- **状态：** Ready for QA
- **适用路由：** `/rentals/[slug]`
- **关联开发文档：** `docs/Listing Details Page Development Spec.md`
- **最后更新：** 2026-07-27

## 1. 验收目标

验证 Listing Details 页面：

1. 符合参考图的整体风格与信息层级；
2. Navbar 和 Footer 与 homepage 完全同源；
3. 只展示当前数据库和已发布 website section 中真实存在的内容；
4. 不泄露 Draft、Archived、内部字段或私有图片；
5. 在 desktop、tablet 和 mobile 上可访问、可操作、无布局问题；
6. 不造成 Homepage、Rentals list、Contact Form 或 Admin 的回归。

## 2. 验收结论规则

| 优先级 | 定义 | Release 规则 |
|---|---|---|
| P0 | 数据泄露、错误公开状态、页面不可访问、主要 CTA 失效 | 任一失败即禁止上线 |
| P1 | 数据展示错误、响应式、键盘、严重 accessibility、Navbar/Footer 不同源 | 任一失败即禁止上线 |
| P2 | 轻微视觉、间距或非阻塞文案问题 | 可记录后修，但需产品确认 |

最终结论只能是：

- **Pass**：全部 P0、P1 通过；
- **Conditional Pass**：全部 P0、P1 通过，仅有已确认的 P2；
- **Fail**：至少一个 P0 或 P1 未通过。

## 3. 标准验收数据

验收数据必须使用当前字段，不添加参考图中的虚构字段。

### DATA-01：完整公开 Listing

```text
slug: qa-complete-rental
title: QA Complete Downtown Rental
addressLine: 1104 – 1231 Howe Street
neighbourhood: Downtown
city: Vancouver
monthlyRentCents: 245000
bedrooms: 1
bathrooms: 1
squareFeet: 620
availableOn: future test date
petPolicy: Small pets considered
description: Two paragraphs of plain-text test copy
status: published
publishedAt: non-null
images: 6 published images, exactly 1 cover, unique sortOrder and useful Alt Text
```

用途：

- 完整首屏；
- 多图画廊与 `+N photos`；
- 所有当前可选字段；
- Metadata；
- Similar rentals。

### DATA-02：最小公开 Listing

```text
slug: qa-minimal-rental
title: QA Minimal Rental
addressLine: 500 Test Street
neighbourhood: null
city: Vancouver
monthlyRentCents: 200000
bedrooms: 0
bathrooms: 1
squareFeet: null
availableOn: null
petPolicy: null
description: Minimal public listing.
status: published
publishedAt: non-null
images: 1 published cover
```

用途：

- Optional field 隐藏；
- Studio/0 bedroom 显示；
- 单图布局；
- 无空模块、无 `null`/`undefined`。

### DATA-03：Draft Listing

```text
slug: qa-private-draft
status: draft
images: draft/private media
```

用途：公开 404 与私有媒体隔离。

### DATA-04：Archived Listing

```text
slug: qa-archived-rental
status: archived
```

用途：公开 404。

### DATA-05：相似房源集合

- 当前 Listing 之外至少 5 条 published Listings；
- `sortOrder` 明确且可验证；
- 至少一条没有 `squareFeet`；
- 至少一条有小数 Bedrooms 或 Bathrooms。

用途：最多 4 条、排序、排除当前 Listing、格式化和可选字段。

## 4. 自动化验收门禁

从项目根目录执行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

使用 Supabase 实现时还必须执行专用测试项目：

```bash
E2E_SUPABASE_TEST_PROJECT_CONFIRMED=true pnpm test:e2e:supabase
```

要求：

- 全部命令 exit code 为 0；
- Browser console 没有 error；
- 页面请求没有意外 4xx/5xx；
- 不允许只因新页面改变而删除现有 Homepage、Contact 或 Accessibility 测试断言。

## 5. 功能验收清单

### 5.1 Page shell 与同源内容

- [ ] **P1 CHROME-01** Listing 页面渲染与 homepage 相同的 `SiteHeader` 组件。
- [ ] **P1 CHROME-02** Brand name、brand subtitle、三个导航项和 contact CTA 的文字、顺序和 href 与 homepage 相同。
- [ ] **P1 CHROME-03** Listing 页面渲染与 homepage 相同的 `SiteFooter` 组件。
- [ ] **P1 CHROME-04** Footer 的 brand、summary、phone、email、office、social、disclosures 与 homepage 相同。
- [ ] **P1 CHROME-05** 修改并发布 Header 或 Footer section 后，Homepage 和 Listing 页面同时更新，不需要改代码。
- [ ] **P1 CHROME-06** Mobile menu 可以打开、关闭、Escape 关闭，并在关闭后恢复焦点。
- [ ] **P1 CHROME-07** Header 不遮挡 Breadcrumb、H1、价格或 Gallery。

### 5.2 路由与公开状态

- [ ] **P0 ROUTE-01** 有效 published slug 返回 200。
- [ ] **P0 ROUTE-02** 不存在的 slug 返回标准 404。
- [ ] **P0 ROUTE-03** Draft slug 返回与不存在 slug 相同的公开 404。
- [ ] **P0 ROUTE-04** Archived slug 返回与不存在 slug 相同的公开 404。
- [ ] **P0 ROUTE-05** Unpublish 后原详情 URL 不再返回 Listing 内容。
- [ ] **P1 ROUTE-06** `Back to Rentals` 是真实链接并跳转到 `/rentals`。
- [ ] **P1 ROUTE-07** 路由按 slug 精确查询，不依赖标题或 Description 模糊匹配。

### 5.3 首屏摘要

- [ ] **P1 HERO-01** 页面只有一个 H1，内容等于 `title`。
- [ ] **P1 HERO-02** 价格由 `monthlyRentCents` 正确格式化为 CAD 月租。
- [ ] **P1 HERO-03** `addressLine` 完整显示。
- [ ] **P1 HERO-04** `neighbourhood` 非空时与 `city` 正确组合。
- [ ] **P1 HERO-05** `neighbourhood` 为空时不出现多余逗号、空行或 `null`。
- [ ] **P1 HERO-06** Bedrooms 和 Bathrooms 正确支持 `0`、整数和 `0.5`。
- [ ] **P1 HERO-07** `squareFeet` 有值时显示，无值时整项隐藏。
- [ ] **P2 HERO-08** `For rent` 状态标签视觉克制，与参考图气质一致。

### 5.4 图片画廊

- [ ] **P1 GALLERY-01** 主图来自当前 Listing 的已发布媒体，不使用 Homepage 或参考图代替。
- [ ] **P1 GALLERY-02** 图片按 `sortOrder` 显示，Cover 是第一张或主图。
- [ ] **P1 GALLERY-03** 单图 Listing 不显示空缩略图槽或 `+0 photos`。
- [ ] **P1 GALLERY-04** 多图 Listing 显示缩略入口；超过可见数量时 `+N photos` 计算正确。
- [ ] **P1 GALLERY-05** 点击缩略图可切换当前大图。
- [ ] **P1 GALLERY-06** 点击主图可打开 Dialog。
- [ ] **P1 GALLERY-07** Dialog 支持上一张、下一张、Close 和 Escape。
- [ ] **P1 GALLERY-08** Dialog 关闭后焦点回到触发图片或按钮。
- [ ] **P1 GALLERY-09** 每张图使用媒体库 Alt Text；缺失时使用安全的 Listing fallback。
- [ ] **P0 GALLERY-10** Draft/private media URL 不出现在页面 HTML、RSC payload、公开 API 或图片请求中。
- [ ] **P1 GALLERY-11** 图片失败时 fallback 不导致页面宽高跳动或横向滚动。

### 5.5 About 与 Listing details

- [ ] **P1 CONTENT-01** About 正文只来自 `description`。
- [ ] **P1 CONTENT-02** Description 作为纯文本安全渲染，输入的 HTML/Script 不执行。
- [ ] **P1 CONTENT-03** Description 的段落换行可读。
- [ ] **P1 CONTENT-04** Details 正确显示 Bedrooms、Bathrooms。
- [ ] **P1 CONTENT-05** Square feet、Available、Pet policy 只在有值时显示。
- [ ] **P1 CONTENT-06** 日期使用 `en-CA` 可读格式，且不发生 UTC 跨日。
- [ ] **P1 CONTENT-07** 日期不晚于 Vancouver 当天时显示 `Available now`。
- [ ] **P1 CONTENT-08** 页面不存在 `null`、`undefined`、`NaN`、空 label 或只有边框的空卡片。
- [ ] **P0 CONTENT-09** 页面不显示当前数据库没有的 MLS、楼龄、Parking、Furnished、Lease、Amenities、Map、Score 或 Nearby 假数据。
- [ ] **P1 CONTENT-10** 页面不从 Description 猜测或生成 Property Type、Amenities 等事实。

### 5.6 Book a viewing

- [ ] **P0 CTA-01** 页面存在可见的 `Book a viewing` 主 CTA。
- [ ] **P0 CTA-02** CTA 打开现有 Contact Modal，而不是跳转到无效页面。
- [ ] **P1 CTA-03** Modal 的标题、body、field labels、contact options 和结果文案来自已发布 `contact` section。
- [ ] **P0 CTA-04** 表单提交到现有 `POST /api/public/contact`。
- [ ] **P0 CTA-05** 成功、失败、loading 状态正确；失败时保留访客已输入内容。
- [ ] **P1 CTA-06** 必填验证后焦点移动到第一个无效字段。
- [ ] **P1 CTA-07** Modal 可用 Escape 和 Close 关闭，关闭后焦点回到 CTA。
- [ ] **P1 CTA-08** 如果显示电话或邮件，其值来自 `contact` section，不得硬编码。

### 5.7 Similar rentals

- [ ] **P1 SIMILAR-01** 当前 Listing 不出现在 Similar rentals。
- [ ] **P1 SIMILAR-02** 只显示 published Listings。
- [ ] **P1 SIMILAR-03** 最多显示 4 条。
- [ ] **P1 SIMILAR-04** 按 `sortOrder` 升序选择。
- [ ] **P1 SIMILAR-05** 卡片正确显示 cover、price、title、address、location、bed、bath 和可选 square feet。
- [ ] **P1 SIMILAR-06** 卡片跳转到正确 slug。
- [ ] **P1 SIMILAR-07** `View all rentals` 跳转到 `/rentals`。
- [ ] **P1 SIMILAR-08** 没有其他 published Listing 时整个 section 隐藏。
- [ ] **P1 SIMILAR-09** 不显示无数据来源的收藏心形按钮。

## 6. Responsive 与视觉验收

### 6.1 通用

在每个 viewport 执行：

```js
document.documentElement.scrollWidth <= document.documentElement.clientWidth
```

结果必须为 `true`。

- [ ] **P1 RESP-01** 375 × 812 无横向滚动。
- [ ] **P1 RESP-02** 768 × 1024 无横向滚动。
- [ ] **P1 RESP-03** 1024 × 900 无横向滚动。
- [ ] **P1 RESP-04** 1440 × 900 无横向滚动。
- [ ] **P1 RESP-05** 200% browser zoom 下主要内容和操作仍可访问。
- [ ] **P1 RESP-06** 320px CSS 宽度下不丢失内容或操作。

### 6.2 Desktop 1440

- [ ] **P1 DESKTOP-01** Hero 为清晰的 Gallery + Summary 两栏，比例接近参考图。
- [ ] **P1 DESKTOP-02** Summary 不窄到产生逐字换行。
- [ ] **P1 DESKTOP-03** About 和 Details 层级清晰，正文行宽不过长。
- [ ] **P2 DESKTOP-04** 首屏黑色区域、白色内容区、绿色 CTA 和轻边框卡片形成一致视觉语言。
- [ ] **P2 DESKTOP-05** Similar rentals 卡片等高、间距一致。

### 6.3 Tablet 768

- [ ] **P1 TABLET-01** Gallery 在上，Summary 在下或以不拥挤方式排列。
- [ ] **P1 TABLET-02** 缩略图不会挤出 viewport。
- [ ] **P1 TABLET-03** About、Details、Similar rentals 阅读顺序自然。

### 6.4 Mobile 375

- [ ] **P1 MOBILE-01** Header 和 Breadcrumb 不重叠。
- [ ] **P1 MOBILE-02** 主图比例稳定，不造成异常超高首屏。
- [ ] **P1 MOBILE-03** 缩略图可横向操作，但页面本身不横向滚动。
- [ ] **P1 MOBILE-04** Facts、CTA、Details、Similar cards 为单列。
- [ ] **P1 MOBILE-05** 所有按钮和 Gallery 控件至少 44 × 44px。
- [ ] **P1 MOBILE-06** Contact Modal 在小屏内可滚动，Submit 与 Close 均可到达。

## 7. Accessibility 验收

- [ ] **P1 A11Y-01** Axe WCAG 2 A/AA、2.1 AA、2.2 AA 扫描无 serious/critical violations。
- [ ] **P1 A11Y-02** 页面只用键盘可以完成 Navbar、Gallery、Book a viewing、Contact Form 和 Similar rental 跳转。
- [ ] **P1 A11Y-03** Tab 顺序与视觉顺序一致。
- [ ] **P1 A11Y-04** 所有 focus-visible 状态清晰。
- [ ] **P1 A11Y-05** Gallery 当前状态不只依靠颜色表达。
- [ ] **P1 A11Y-06** Facts 使用语义化结构，screen reader 可理解 label/value。
- [ ] **P1 A11Y-07** Dialog 有可访问名称，开启时焦点不落到背景。
- [ ] **P1 A11Y-08** Icon-only 按钮都有明确 accessible name。
- [ ] **P1 A11Y-09** 装饰 Icon 对 screen reader 隐藏。
- [ ] **P1 A11Y-10** `prefers-reduced-motion: reduce` 下无非必要动画。
- [ ] **P1 A11Y-11** 文字、控件、focus ring 颜色对比满足 WCAG AA。

## 8. 数据安全与权限验收

### 8.1 Public projection

- [ ] **P0 SEC-01** `anon` 只能查询公开详情 projection。
- [ ] **P0 SEC-02** `anon` 不能直接读取 `rental_listings`、`rental_listing_images`、draft `media_assets`。
- [ ] **P0 SEC-03** 公开详情只返回 allowlist 字段。
- [ ] **P0 SEC-04** 公开图片聚合只包含 `state = 'published'` 且有 `public_url` 的媒体。
- [ ] **P0 SEC-05** View/RPC 不返回 storage path、actor、revision、source marker、audit 或 draft content。
- [ ] **P0 SEC-06** Draft 和 Archived 详情响应对匿名用户不可区分于不存在记录。

### 8.2 Regression

- [ ] **P0 SEC-07** 本次 migration 不改变 Admin 对 Listing 和媒体的正常读取/写入。
- [ ] **P0 SEC-08** 不修改已部署 migration 文件；使用新的 forward migration。
- [ ] **P1 SEC-09** Homepage/public list 继续只显示 published Listings。

## 9. SEO 验收

- [ ] **P1 SEO-01** `<title>` 使用 Listing title 和 Ting Ting Rentals 品牌。
- [ ] **P1 SEO-02** Meta description 来自纯文本 `description`，长度合理。
- [ ] **P1 SEO-03** Canonical 为当前 `/rentals/[slug]`。
- [ ] **P1 SEO-04** Open Graph title、description、URL 正确。
- [ ] **P1 SEO-05** 有 cover 时 Open Graph image 使用当前 Listing cover。
- [ ] **P1 SEO-06** Draft、Archived 和不存在 slug 不输出 Listing SEO 内容。
- [ ] **P1 SEO-07** 页面只有一个 H1。

## 10. 性能与稳定性验收

- [ ] **P1 PERF-01** 详情读取按 slug 查询，不通过拉取全部 Listings 再 `find()`。
- [ ] **P1 PERF-02** Similar rentals 查询或处理最多输出 4 条。
- [ ] **P1 PERF-03** 只有首屏主图使用 priority。
- [ ] **P1 PERF-04** 所有 `next/image` 提供准确 `sizes`。
- [ ] **P1 PERF-05** Gallery、卡片和 fallback 都有稳定 aspect ratio。
- [ ] **P1 PERF-06** 页面不引入新的 carousel、lightbox 或 animation 第三方依赖。
- [ ] **P1 PERF-07** Browser console 无 hydration、key、image sizing 或 accessibility error。
- [ ] **P1 PERF-08** Gallery 图片加载失败不会导致整个页面 crash。

## 11. 回归验收

- [ ] **P1 REG-01** Homepage Header、Hero、Search、Services、Featured rentals、About、Contact、Footer 正常。
- [ ] **P1 REG-02** Homepage 的最多 3 条 Featured rentals 规则不变。
- [ ] **P1 REG-03** `/rentals` 搜索和筛选正常。
- [ ] **P1 REG-04** Homepage、Rentals list、Similar rentals 使用一致的价格、bed、bath、area 格式。
- [ ] **P1 REG-05** Service pages 的 Header、Footer、Contact Modal 正常。
- [ ] **P1 REG-06** Contact Form 成功、失败和 validation 流程正常。
- [ ] **P0 REG-07** Admin Rental create/save/publish/unpublish/archive 正常。
- [ ] **P0 REG-08** Rental 图片上传、排序和 cover 选择正常。
- [ ] **P1 REG-09** Sitemap 和 Metadata build 不报错。

## 12. 建议新增自动化测试

### Unit

- public detail loader 只返回 published；
- unknown/draft/archived 返回 `null`；
- Gallery 图片按 `sortOrder`；
- private/unpublished image 被过滤；
- Similar rentals 排除当前、排序、限制 4 条；
- price/count/area/date/location formatter；
- Optional field condition；
- Metadata 与页面使用同一 Listing。

### Memory E2E

在现有 `public search, rental detail, validation, responsive layout, and accessibility` 用例中保留：

- Search → `/rentals`；
- View rental → detail；
- `Book a viewing` 可见。

并增加：

- Header/Footer；
- Gallery Dialog；
- Contact Modal；
- Optional field 隐藏；
- Similar rentals；
- 四个 viewport 的 overflow；
- Axe scan。

### Supabase / RLS

- `getPublicRentalBySlug` 公开查询；
- 多图 projection 顺序与 allowlist；
- Draft/Archived 不返回；
- draft media 不返回；
- anon 不能读基表；
- Admin 写入和 publish transaction 不回归。

## 13. 人工视觉比对方法

使用参考图并排检查，不做像素级复制，重点判断：

1. 是否有相同的“深色首屏 + 大图 + 右侧摘要卡”视觉重心；
2. 是否用绿色明确突出 Book a viewing；
3. 白色内容区是否有清晰的 About、Details、Similar rentals 层级；
4. 页面是否克制，没有为了填满版面而增加假字段；
5. Navbar/Footer 是否一眼可确认与 homepage 是同一套；
6. Mobile 是否仍保留完整信息与可操作性。

视觉差异可接受：

- 参考图中无数据库来源的模块被删除；
- 当前 Listing 较少时 Similar rentals 数量减少；
- 单图 Listing 不显示缩略图条；
- 当前品牌 token 与参考图具体字号、间距存在适度差异。

视觉差异不可接受：

- 为填充版面写死参考图数据；
- Header/Footer 与 homepage 不一致；
- 右侧摘要过密、移动端溢出；
- 图片被拉伸、裁切失控或无 Alt；
- 空字段显示为破折号堆叠或空卡片。

## 14. QA 记录模板

```text
Build / Commit:
Environment:
Backend: memory / Supabase
Browser:
Viewport:
Test data IDs:

Automated gates:
- lint:
- typecheck:
- unit:
- build:
- memory E2E:
- Supabase E2E:

P0 failures:
P1 failures:
P2 observations:

Final result: Pass / Conditional Pass / Fail
QA owner:
Date:
Product approval:
```

## 15. 上线批准

上线前必须由开发和 QA 共同确认：

- 全部 P0、P1 通过；
- Public projection 权限经过 Supabase 测试；
- Homepage 与 Listing 页面 chrome 同源；
- 参考图中无数据来源的模块没有被实现为假数据；
- Production 至少抽查一个完整 Listing 和一个可选字段较少的 Listing；
- 发布、下线 Listing 后，详情页公开状态符合预期。
