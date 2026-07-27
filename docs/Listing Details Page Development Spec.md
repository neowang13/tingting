# Listing Details 页面开发文档

- **状态：** Ready for development
- **适用路由：** `/rentals/[slug]`
- **视觉参考：** `ChatGPT Image Jul 27, 2026, 08_10_55 AM.png`
- **数据基线：** 当前已实施的 Rental Listing V1 数据库与公开 projection
- **最后更新：** 2026-07-27

## 1. 开发目标

重做 Listing Details 页面，使其延续参考图的高级、克制、信息清晰的房产详情页风格，同时满足以下硬性要求：

1. Navbar 和 Footer 必须直接复用 homepage 的 `SiteHeader`、`SiteFooter` 及同一份已发布内容，不能复制组件或硬编码第二套品牌、联系方式、导航和 legal copy。
2. 页面只显示当前数据库、公开媒体和 homepage 已发布内容中真实存在的数据。
3. 不为贴近参考图而虚构 MLS、楼龄、停车、家具、租期、设施、地图、评分或 Nearby 等信息。
4. 公开页面只读取 `published` Listing 和已发布媒体；Draft、Archived、内部字段和后台预览 URL 不得出现在公开响应中。
5. 页面在 375px、768px、1024px 和 1440px 下都必须完整、易读、无横向滚动。

参考图是视觉与信息层级的方向，不是数据库字段清单，也不是逐像素复制要求。

## 2. 现状与关键决策

### 2.1 当前可复用组件

| 能力 | 当前实现 | 本页面要求 |
|---|---|---|
| Navbar | `src/components/public/site-chrome.tsx` 的 `SiteHeader` | 直接复用 |
| Mobile Navbar | `src/components/public/mobile-navigation.tsx` | 直接复用 |
| Footer | `src/components/public/site-chrome.tsx` 的 `SiteFooter` | 直接复用 |
| 联系表单 | `src/components/public/contact-form.tsx` | 通过现有 Contact Modal 复用 |
| 联系弹窗 | `src/components/public/contact-modal.tsx` | 用于 Book a viewing |
| 首页公开内容加载 | `loadPublicHomepageData()` | 详情页建立更轻量的共享 chrome/contact loader，或复用其 section 解析逻辑 |
| 当前详情页 | `src/app/rentals/[slug]/page.tsx` | 重构为薄路由 + 页面组件 |

### 2.2 页面数据权威

数据优先级固定为：

1. 当前 Listing 的公开已发布数据；
2. Listing 关联的已发布媒体；
3. Homepage 已发布的 `header`、`contact`、`footer` section；
4. 仅用于格式化、标签、交互提示的代码内 UI 文案。

禁止从 Description 猜测 Property Type、Parking、Amenities 或其他结构化事实。禁止从图片内容推断房源事实。

### 2.3 数据模型边界

本页面按当前已经实施的字段开发，不依赖状态为 Planned 的 Listing V2 方案。Listing V2 将来上线后可以增加新的条件模块，但不应阻塞本次页面重构。

本次允许新增安全的公开只读 projection 或 repository 查询方法，以读取数据库中已经存在的多图关联；不得为了参考图新增并无内容来源的业务字段。

## 3. 当前数据库字段与页面映射

### 3.1 可直接使用的 Listing 字段

| 数据字段 | 页面位置 | 展示规则 |
|---|---|---|
| `slug` | URL | 仅用于 `/rentals/[slug]` 查找 |
| `title` | 唯一 H1、SEO title、相似房源卡 | 必填，原样显示 |
| `addressLine` | 首屏摘要 | 必填，原样显示 |
| `neighbourhood` | 地址次级信息 | 非空时显示 |
| `city` | 地址次级信息、SEO | 必填 |
| `monthlyRentCents` | 首屏价格、相似房源卡 | CAD，格式为 `$2,450 / month` |
| `bedrooms` | 首屏 Facts、详情卡 | 支持 `0`、整数和 `0.5` |
| `bathrooms` | 首屏 Facts、详情卡 | 支持整数和 `0.5` |
| `squareFeet` | 首屏 Facts、详情卡 | 非空时显示，例如 `620 sq. ft.` |
| `availableOn` | Listing Details 卡 | 非空时按 `en-CA` 显示；日期不晚于当天时显示 `Available now` |
| `petPolicy` | Listing Details 卡 | 非空时显示，不做自动分类 |
| `description` | About this rental | 保留段落换行；不解析为 Amenities |
| `coverImageUrl` | 首屏主图、Open Graph | 有效 URL 时使用 |
| `images[]` | 图片画廊 | 按 `sortOrder` 排序，只允许已发布媒体 |
| `status` | 公开可见性、可选 `For rent` badge | 只有 `published` 可访问 |
| `sortOrder` | Similar rentals 顺序 | 不直接显示 |
| `publishedAt` | 公开可见性校验 | 不直接显示 |

`id`、`createdAt`、`updatedAt` 是系统字段，不在访客页面显示。

### 3.2 参考图中当前不能显示的内容

以下模块没有可靠的当前数据库字段，必须从本次页面中删除，而不是显示假数据、静态示例或空卡片：

- 收藏心形按钮和用户收藏状态；
- Postal code 和 Province；
- Property Type；
- Parking、Furnished、Lease Term；
- Storage、Heating、Cooling；
- MLS Number、Year Built；
- Building Name、Stories、Units in Building；
- Building Amenities 和 Property Features；
- Map、Latitude、Longitude；
- Walk Score、Transit Score、Bike Score；
- Nearby 地点和步行时间；
- Rental policy、信用检查、References、Utilities 和 Fees。

当 Listing V2 的对应 migration、公开 projection、Admin 写入和发布快照全部上线后，这些模块才可以按字段非空条件加入。

## 4. 信息架构

页面顺序固定为：

1. Homepage Navbar；
2. 深色 Listing Hero；
3. Back to Rentals；
4. 图片画廊；
5. 房源摘要与 Book a viewing 卡；
6. About this rental；
7. Listing details；
8. Similar rentals；
9. Homepage Footer。

不得保留当前详情页中没有 navbar/footer 的孤立页面结构。

## 5. 页面视觉与布局规范

### 5.1 整体视觉

- 沿用现有全站 token：`--ink`、`--muted`、`--green`、`--line`、`--warm`、`--navy`。
- 沿用 homepage 的 Arial 字体、按钮、container 宽度和 focus ring。
- 首屏背景使用纯黑或接近黑色，形成与参考图一致的沉浸式房源展示区域。
- 内容区使用白色或 `--warm`，卡片使用白底、细边框、轻阴影。
- 圆角保持 10–14px；主要 CTA 使用现有绿色按钮语言。
- 不增加渐变、玻璃拟态、统计数字、推荐徽章或装饰性组件。

### 5.2 Navbar

- 渲染 `SiteHeader`，数据来自已发布 `header` section。
- Brand、Rent、Service、About 和 Ask Ting Ting 的文字与 URL 必须和 homepage 相同。
- Listing 页面可在同一个 `SiteHeader` 组件中通过可选 `activeKey` 标记 Rent 为当前栏目；不得复制一个“详情页专用 Header”。
- Header 保持白色文字，放在深色 Hero 上方；Hero 必须预留足够顶部空间，避免内容被 absolute header 覆盖。
- Mobile 继续使用现有可访问菜单。

### 5.3 Breadcrumb

- 位于 Header 下方、画廊上方。
- 文案为 `Back to Rentals`，链接到 `/rentals`。
- 使用真实链接，不使用只执行 `router.back()` 的按钮。
- 触控目标至少 44px，高对比度白色或浅灰文字。

### 5.4 Hero 主布局

桌面端使用两栏：

- 左侧约 65%：图片画廊；
- 右侧约 35%：房源摘要与联系 CTA；
- 两栏顶部对齐，间距 20–24px；
- container 沿用 homepage 的最大宽度 1180px。

Hero 右侧摘要卡信息顺序：

1. `For rent` 状态标签；
2. Listing `title`，唯一页面 H1；
3. 月租；
4. `addressLine`；
5. `neighbourhood, city`，只连接存在的值；
6. Bedrooms、Bathrooms、Square Feet 的图标 Facts；
7. Book a viewing CTA 区域。

`squareFeet` 为空时，对应 Fact 不渲染，剩余 Facts 自动均分；不得显示 `— sq. ft.`。

### 5.5 图片画廊

图片来源：

1. 优先使用按 `sortOrder` 排序的公开 `images[]`；
2. 如果公开查询暂时只返回 `coverImageUrl`，将其作为唯一图片；
3. 不允许使用参考图、Homepage Hero 图或随机 Unsplash 图填充缺失房源图片。

画廊规则：

- 第一张为大图，使用数据库 Alt Text；Alt 缺失时回退到 `${title} in ${city}`。
- 2 张及以上时显示缩略图条；1 张时不显示空缩略图槽。
- 最多展示 5 个可见缩略入口，多余图片在最后一个入口显示 `+N photos`。
- 点击主图或缩略图打开可访问的图片 Dialog。
- Dialog 支持上一张、下一张、Escape 关闭、明确的 Close 按钮、焦点恢复。
- `next/image` 使用稳定的 aspect ratio 和正确 `sizes`；首屏主图可 `priority`，缩略图不可全部 priority。
- 图片加载失败时保留固定尺寸的中性 fallback，不得引发布局跳动。

### 5.6 Book a viewing

- 使用现有 `ContactModalProvider` 和 `ContactTrigger`，不得创建第二套提交 API。
- 联系表单 labels、preferred contact options、submit/success/error copy 来自已发布 `contact` section。
- 主 CTA 的可见文案保持 `Book a viewing`，以兼容现有公开 E2E。
- CTA 打开 Dialog 后，焦点进入表单；关闭后回到触发按钮。
- Contact API 仍为 `POST /api/public/contact`。
- 当前 API 没有 Listing ID 字段，因此本次不修改 enquiry 数据结构；访客可在 message 中填写需求。
- 可以显示来自 `contact.publicPhone` 和 `contact.publicEmail` 的次级电话/邮件链接，但不得硬编码联系方式。

### 5.7 About this rental

- 标题为 `About this rental`。
- 正文只使用 `description`。
- 保留原始换行并安全渲染为段落；不支持 HTML 注入。
- 桌面正文建议最大行宽 680–760px，保证阅读舒适。

### 5.8 Listing details

该卡片只显示当前字段：

- Bedrooms；
- Bathrooms；
- Square feet，非空时；
- Available，非空时；
- Pet policy，非空时。

不重复显示价格、标题和地址。可选字段为空时整行不渲染；如果除 Bedrooms/Bathrooms 外没有其他可选数据，卡片仍保持自然高度，不渲染空分组。

### 5.9 Similar rentals

- 数据源为其他 `published` Listings；
- 排除当前 Listing；
- 按 `sortOrder` 升序，最多 4 条；
- 复用 homepage Rental Card 的视觉语言或提取共享 `RentalCard` 组件；
- 显示 cover、价格、title、address、neighbourhood/city、bed、bath、square feet（如有）；
- 卡片链接到对应 `/rentals/[slug]`；
- 右上方提供 `View all rentals` → `/rentals`；
- 没有其他公开 Listing 时整个 Similar rentals section 不渲染，不显示空状态。

不显示收藏心形按钮，因为当前系统没有访客身份或收藏数据。

### 5.10 Footer

- 直接渲染 `SiteFooter`，数据来自已发布 `footer` section。
- Brand、summary、phone、email、office、social links、disclosures 与 homepage 完全一致。
- 不在页面组件中复制 footer 文案或联系方式。

## 6. Responsive 规则

### 6.1 1440px / Desktop

- Hero 图片与摘要为 65/35 两栏；
- About + Listing details 可为 `minmax(0, 1.7fr) minmax(280px, 0.8fr)`；
- Similar rentals 最多四栏；
- 首屏主体尽量在 Navbar 下完整出现主要图片、价格和 CTA。

### 6.2 1024px / Small desktop

- Hero 仍可保持两栏，但右侧最小宽度不得小于 320px；
- 如果摘要内容发生拥挤，切换为单栏，不能缩小到难读字号；
- Similar rentals 两栏。

### 6.3 768px / Tablet

- Hero 改为单栏：画廊在上，摘要卡在下；
- 缩略图横向滚动或等宽 4 列；
- About 与 Listing details 改为单栏；
- Similar rentals 两栏。

### 6.4 375px / Mobile

- container 左右边距沿用全站 16px；
- Header 高度沿用 mobile homepage；
- Hero 顶部 padding 不得被 Header 覆盖；
- 主图建议 4:3，避免超高首屏；
- 缩略图使用横向滚动，滚动容器不影响页面整体宽度；
- 摘要卡、Facts、CTA、详情卡、Similar cards 全部单列；
- 所有按钮至少 44px 高；
- 页面不得产生横向滚动。

## 7. 数据加载与安全设计

### 7.1 新的详情数据边界

建议新增：

```ts
type PublicRentalDetailData = {
  rental: RentalListing;
  similarRentals: RentalListing[];
  sections: {
    header: ParsedHeader;
    contact: ParsedContact;
    footer: ParsedFooter;
  };
};

loadPublicRentalDetailData(slug: string): Promise<PublicRentalDetailData | null>
```

路由组件只负责：

1. 解析 `slug`；
2. 调用 loader；
3. 不存在时执行 `notFound()`；
4. 渲染 `RentalDetailPage` 组件；
5. 使用同一公开数据生成 Metadata。

### 7.2 Repository 改造

当前详情页通过 `listRentals(false).find()` 查找 Listing，既读取了不必要的列表数据，也无法在 Supabase public projection 中取得完整 `images[]`。

建议为 `DataRepository` 增加：

```ts
getPublicRentalBySlug(slug: string): Promise<RentalListing | null>;
```

Memory adapter：

- 仅在 `status === "published"` 且有 `publishedAt` 的记录中查找；
- 返回排序后的公开图片。

Supabase adapter：

- 按 slug 查询新的公开详情 projection；
- 不使用 service role 绕过公开边界；
- 查询不到或非 published 时返回 `null`。

### 7.3 公开图片 projection

当前数据库已经有 `rental_listing_images` 和 `media_assets`，但现有 `public_rental_listings` 主要提供 cover，没有完整 public `images[]`。为实现真实画廊，新增专用于详情的 `public_rental_listing_details` view，或安全扩展现有 public projection。

公开图片聚合必须满足：

- Listing `status = 'published'`；
- Media `state = 'published'`；
- `public_url is not null`；
- 返回字段仅为 `mediaAssetId`、`url`、`alt`、`sortOrder`、`isCover`；
- 按 `sort_order` 排序；
- 不返回 draft storage path、created_by、updated_by、revision、source marker 或内部备注；
- View 使用 `security_barrier`；
- 只向 `anon`、`authenticated` grant `select`；
- 私有基表权限维持不变。

本次只增加公开读取路径，不增加新的 Listing 业务字段。

### 7.4 404 与公开状态

以下情况统一返回 Next.js 404：

- slug 不存在；
- Listing 为 `draft`；
- Listing 为 `archived`；
- Listing 已经 unpublish；
- URL 使用旧 slug 且没有明确 redirect 规则。

不得通过不同错误文案让匿名用户判断某个私有 Listing 是否存在。

## 8. 建议组件拆分

```text
src/features/content/public-rental-detail.ts
src/components/public/rental-detail-page.tsx
src/components/public/rental-gallery.tsx
src/components/public/rental-summary-card.tsx
src/components/public/rental-details-card.tsx
src/components/public/rental-card.tsx
src/app/rentals/[slug]/page.tsx
```

边界建议：

- Server Component：页面壳、数据映射、About、Details、Similar rentals；
- Client Component：Gallery Dialog、缩略切换、Contact Modal trigger；
- 共享 `RentalCard` 同时供 homepage、rentals list 和 Similar rentals 使用，避免三个页面各自格式化同一字段。

## 9. 格式化与内容规则

建立共享 formatter，避免页面之间出现不同格式：

```ts
formatRentalPrice(monthlyRentCents) // "$2,450"
formatRentalCount(1.5)              // "1.5"
formatRentalArea(620)               // "620 sq. ft."
formatRentalAvailability(date)      // "Aug 1, 2026" / "Available now"
formatRentalLocation(neighbourhood, city)
```

- Locale 使用 `en-CA`；
- 日期按 `America/Vancouver` 的产品语义处理，避免 UTC 跨日；
- UI labels 可代码维护，业务内容不得写死；
- Description 作为纯文本处理；
- 不显示 `null`、`undefined`、空字符串或仅包含标点的行。

## 10. SEO

保留并完善当前 Metadata：

- Title：`${rental.title} | Ting Ting Xu Rentals`；
- Description：`description` 的纯文本前 150–160 字符；
- Canonical：`/rentals/${slug}`；
- Open Graph title、description、URL；
- Open Graph image 优先使用 cover；
- 页面只允许一个 H1；
- 图片 Alt 使用媒体库 Alt Text，不重复堆砌关键词。

Metadata 和页面正文必须使用同一份公开 Listing 数据，避免重复查询得到不同状态。

## 11. Accessibility

- 页面通过 WCAG 2.2 AA 自动扫描，不得有 serious/critical violations；
- Breadcrumb 使用导航语义或明确 label；
- Facts 使用语义化 `<dl>`；
- Icon 为装饰时使用 `aria-hidden`；
- Gallery 控件有可读名称，例如 `View photo 2 of 6`；
- Dialog 有 title、Close、Escape、焦点圈定与关闭后焦点恢复；
- Mobile menu 延续现有键盘行为；
- 所有可交互目标至少 44 × 44px；
- 颜色不能作为唯一信息来源；
- 尊重 `prefers-reduced-motion`；
- 键盘 Tab 顺序与视觉顺序一致。

## 12. 性能要求

- 首屏主图是唯一可设置 `priority` 的 Listing 图片；
- 所有图片提供准确 `sizes`；
- 主图、缩略图和卡片预设 aspect ratio；
- 不引入 carousel、lightbox、state 或 animation 第三方库；
- 详情查询按 slug，不为加载一条详情拉取全部 Listing；
- Similar rentals 限制最多 4 条；
- 不让 gallery 图片聚合进入不需要多图的 list/homepage 查询。

## 13. 预计改动文件

主要改动：

- `src/app/rentals/[slug]/page.tsx`
- `src/app/globals.css`
- `src/data/repository.ts`
- `src/data/store.ts`
- `src/data/supabase-repository.ts`
- `src/lib/contracts.ts`
- `src/features/content/public-rental-detail.ts`
- `src/components/public/*` 新增或提取的详情组件
- `tests/e2e/application.spec.ts`
- 相关 unit tests
- 新 Supabase migration：公开详情 projection

可能改动：

- `src/components/public/site-chrome.tsx`：仅增加可选 active state；
- `src/components/public/contact-modal.tsx`：仅在需要 Listing 上下文时扩展，不改变现有调用；
- Homepage 和 rentals list：改用共享 `RentalCard`，视觉与行为不应回归。

不得修改：

- Admin Listing 字段和写入流程；
- Tenant、Reminder、Notification 领域；
- Homepage 固定 section registry；
- 已部署 migration 文件。

## 14. 开发顺序

1. 新增 public rental detail repository method 与安全 projection；
2. 增加 loader，统一读取 Listing、Similar rentals、header/contact/footer；
3. 提取共享 formatter 和 Rental Card；
4. 实现 Server Component 页面骨架；
5. 实现 Gallery Client Component 与 Dialog；
6. 接入现有 Contact Modal；
7. 编写 desktop/tablet/mobile CSS；
8. 更新 Metadata；
9. 增加 unit、E2E、Supabase/RLS 测试；
10. 按验收文档完成自动与人工验收。

## 15. 完成定义

只有同时满足以下条件才算开发完成：

- 页面视觉层级与参考图一致，但没有任何伪造模块；
- Navbar/Footer 与 homepage 使用同一组件和同一已发布内容；
- 当前数据库有值的公开字段都在合理位置展示；
- 可选字段为空时自然隐藏；
- 多图来自真实已发布媒体；
- Draft/Archived/private media 无法公开访问；
- 375/768/1024/1440 无横向滚动；
- lint、typecheck、unit、build、E2E 和相关 Supabase 测试通过；
- 验收文档中的全部 P0、P1 项通过。
