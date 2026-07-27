# Rental Listing V2 测试计划

**状态：** Planned，配合 Listing V2 实施逐步落地  
**适用范围：** 数据库迁移、Admin 创建/编辑、草稿预览、发布与下线、公开列表与详情、搜索、OpenClaw v1/v2 兼容、权限与回滚  
**关联方案：** [Rental Listing Database and Admin Creation Plan](../plans/rental-listing-schema-admin-plan.md)

## 1. 测试目标

这份测试计划验证 Listing V2 改造满足以下结果：

1. Admin 可以用结构化字段创建完整房源，不需要把停车、utilities、宠物、设施和费用塞进 Description。
2. `Save privately` 只保存后台草稿，不会改变已经上线的房源。
3. `Publish to website` 或 `Publish updates` 创建不可变公开快照，并且公开页面只读取该快照。
4. 现有 Listing 升级后不会丢失、下线或丢掉标题、地址、价格、图片等原有内容。
5. Admin、公开页面、搜索和 OpenClaw 使用同一套业务规则。
6. 未登录用户无法读取草稿、内部备注、迁移标记、来源信息或审计数据。
7. 数据库父记录、Amenities、Utilities、Fees 和 Images 要么全部保存成功，要么全部不变。

## 2. 不在本次测试范围

- 自动抓取 Rentals.ca 内容。
- 租客与 `rental_properties` 的正式关联。
- 第三方地图或 geocoding 服务。
- 第三方租金趋势、walk score、affordability score。
- 真实邮件、短信或真实支付。
- Listing revision 的用户可操作 Restore 功能；本次只验证 revision 完整、不可变和公开指针正确。

## 3. 质量风险与优先级

| 优先级 | 风险 | 必须验证的结果 |
|---|---|---|
| P0 | 私下保存意外改变公开网站 | 保存已上线房源后，公开 API 和页面内容完全不变 |
| P0 | 数据迁移导致已上线 Listing 消失 | 切换前后公开 Listing ID 和数量一致 |
| P0 | 部分子表保存成功 | 任意子表或版本冲突失败时，整个 aggregate 不发生变化 |
| P0 | 草稿或内部数据泄露 | anon/authenticated 无权读取私有表和草稿预览 |
| P0 | 发布快照引用了其他 Listing 的 revision | 数据库拒绝跨 Listing 的 `published_revision_id` |
| P0 | OpenClaw v1 兼容破坏 | v1 写入仍可创建草稿，且被正确标记为 Needs review |
| P1 | 条件字段产生矛盾数据 | Parking/Pets/Availability 等隐藏字段被正确清空 |
| P1 | 搜索继续解析 Description | Property type 查询只使用结构化字段 |
| P1 | Admin 表单难以操作 | 错误定位、键盘、移动端和 accessibility 通过 |
| P1 | 媒体已提升但数据库发布失败 | 重试不重复创建资源，孤儿媒体可检测和清理 |
| P2 | 非关键展示细节不一致 | 缺失的可选分组不显示空标题或空值 |

任何 P0 测试失败都阻止 Listing V2 上线。

## 4. 测试分层

| 层级 | 工具 | 目标 | 建议位置 |
|---|---|---|---|
| Schema/validation unit | Vitest | 字段、条件、normalization、v1 adapter | `tests/unit/` |
| Repository unit | Vitest | Mapping、发布前校验、错误转换 | `tests/unit/` |
| SQL behavior | PostgreSQL SQL suite | 约束、事务、revision、grants、backfill | `tests/sql/migration-behavior.sql` |
| RLS integration | Vitest + Supabase anon client | 私有表阻止、公开 view allowlist | `tests/integration/supabase-rls.test.ts` |
| Memory-mode E2E | Playwright | Admin 控件和公开页面浏览器流程 | `tests/e2e/` |
| Supabase E2E | Playwright + 专用 Supabase | 真实 RPC、Auth、Storage、事务和审计 | `tests/e2e-supabase/` |
| Cutover verification | SQL + API parity script | v1/v2 数据数量和公开输出对比 | `tests/sql/` 或 `scripts/` |
| Manual acceptance | Chrome responsive | 管理员最终验收和文案确认 | 本文第 14 节 |

## 5. 测试环境

### 5.1 Memory-mode

用途：

- Admin 表单交互；
- 条件字段显示/隐藏；
- 基础发布流程；
- 公开搜索和详情展示；
- responsive 和 accessibility。

命令：

```bash
pnpm test:e2e
```

现有 Playwright 配置：

- URL：`http://127.0.0.1:3200`
- Browser：Desktop Chrome
- Backend：memory
- Email/SMS：mock
- Trace：失败时保留
- Screenshot：失败时保留

### 5.2 Supabase E2E

用途：

- Migration 后的真实 Postgres 结构；
- RLS、grants 和 security-definer RPC；
- Admin Cookie + MFA；
- Storage 媒体提升；
- Listing aggregate transaction；
- Audit、idempotency 和 revision pointer。

命令：

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

- 只能连接本地 Supabase 或专用测试项目；
- `TEST_SUPABASE_URL` 不得等于 `PRODUCTION_SUPABASE_URL`；
- Next.js 测试服务器只能是 `127.0.0.1` 或 `localhost`；
- 测试数据标题、地址和图片 Alt 必须明确标记为 synthetic/test；
- 测试清理只删除本次生成的明确 ID，不使用宽泛条件。

### 5.3 Migration verification

必须覆盖两种路径：

1. 从空数据库按顺序执行全部 migration。
2. 从包含现有 published/draft/archived Listing 的旧 schema 升级。

Schema migration 和 data backfill migration 必须分开验证。

## 6. 标准测试数据

### DATA-01：完整手动 Listing

```text
Title: Seasons 1703 Test
Property type: Condo
Building: Seasons
Unit: 1703
Street: 5028 Kwantlen Street
Neighbourhood: Lansdowne Village
City: Richmond
Province: BC
Postal code: V6X 4K2
Country: CA
Rent: CAD 2600
Bedrooms: 2
Bathrooms: 2
Dens: 0
Square feet: 838
Availability: Available now
Furnishing: Unfurnished
Lease: Fixed term, 12 months
Parking: Underground, 1 stall, included
Storage: 1 locker, included
Pets: Considered, cats and dogs, maximum 2
Smoking: Not allowed
Credit check: Required
References: Required
Utilities: Water, Hot water, Gas, Sewage, Garbage collection
Amenities: Balcony, Dishwasher, In-suite washer, In-suite dryer,
           Elevator, Fitness room, Video surveillance, Public transit,
           Shopping, Parks, Schools
Contact: Use Ting Ting website contact
Photos: 3 selected, exactly 1 cover
```

用途：

- 完整创建、保存、预览、发布；
- 公开详情字段分组；
- search/filter；
- revision snapshot；
- publish update。

### DATA-02：最小可保存草稿

包含：

- title；
- property type；
- street address；
- city；
- monthly rent；
- bedrooms；
- bathrooms；
- description。

缺少：

- postal code；
- availability；
- furnishing；
- lease；
- smoking；
- pet policy；
- cover image。

预期：

- 可以 `Save privately`；
- 不能 Publish；
- 页面显示具体缺失字段和对应 Card issue count。

### DATA-03：已上线后有未发布修改

步骤：

1. 发布 DATA-01。
2. 修改 rent、description、amenity 和一张图片。
3. 只执行 `Save privately`。

预期：

- Admin 显示 `Live with unpublished changes`；
- `draft_digest` 与 live revision `source_digest` 不同；
- 公开 API、列表和详情仍显示旧值；
- 点击 `Publish updates` 后才显示新值。

### DATA-04：Legacy published Listing

旧字段：

- `address_line` 有值；
- `city` 有值；
- `pet_policy` 为自由文本；
- 没有 property type、postal code、lease、furnishing 或 structured amenities。

预期：

- Backfill 创建 property 和 initial revision；
- 公开页面继续显示；
- `review_required_fields` 记录无法安全推断的字段；
- 下一次 Publish 被阻止，直到 Admin 完成 review；
- review flags 不出现在公开 API。

### DATA-05：OpenClaw v1 输入

使用当前 `/api/automation/v1/rentals` flat payload。

预期：

- v1 response 继续保持 flat shape；
- 内部通过 v2 adapter 保存；
- `addressLine` 整体映射到 `streetAddress`；
- 缺失 property type 和 policy 字段进入 review flags；
- `source_system`、`external_reference`、actor user、service account 和 request ID 正确记录；
- 同一个 idempotency key 不重复创建。

### DATA-06：并发冲突

- Browser A 读取 listing/property version。
- Browser B 保存修改。
- Browser A 使用旧 listing 或 property version 保存。

预期：

- 返回 `409`；
- Property、Listing、Amenities、Utilities、Fees、Images 全部保持 Browser B 的版本；
- Browser A 输入仍可复制或重新加载。

### DATA-07：迁移边界集合

至少包含：

- published Listing；
- published Listing with images；
- draft Listing without cover；
- archived Listing；
- null square feet；
- free-text pet policy；
- duplicate-looking but合法的不同 unit；
- source/external reference Listing。

## 7. Database Migration 测试

### MIG-001：空库 migration

**步骤**

1. 创建空测试数据库。
2. 按文件名顺序执行所有 migration。
3. 执行 seed/provision。

**预期**

- 所有 migration 成功；
- Catalog seed 数量和 code 唯一；
- 新表全部启用 RLS；
- 公开 view 和 service-role RPC 权限正确。

### MIG-002：旧库升级

**步骤**

1. 准备旧 schema 和 DATA-07。
2. 先执行 expand migration。
3. 在切换 public reader 前执行 backfill。

**预期**

- 原 Listing 行数、ID、slug 和 status 不变；
- 每个 Listing 恰好有一个 Property；
- 每个原 published Listing 都有 `published_revision_id`；
- published revision 属于同一 Listing；
- 原 title、display address、rent、beds、baths、size、description 和 cover 保持一致。

### MIG-003：不安全字段不自动猜测

**预期**

- `address_line` 不被猜测拆成错误的 building/unit；
- 模糊 pet text 不被自动设置为 Allowed 或 Not allowed；
- 缺失字段进入 `review_required_fields`；
- legacy Listing 继续公开，但不能 Publish updates。

### MIG-004：Catalog 约束

**预期**

- 非法 property type、availability、lease、pet、smoking、fee frequency 被数据库拒绝；
- 已被引用的 amenity/utility code 不能删除；
- Listing 删除时对应 association/fee rows 按设计 cascade；
- Revision 历史不会被意外 cascade 删除。

### MIG-005：Published revision ownership

**步骤**

1. 创建 Listing A 和 Listing B 的 revisions。
2. 尝试让 Listing A 指向 Listing B 的 revision。

**预期**

- Composite FK 或等价数据库约束拒绝更新。

### MIG-006：View compatibility

**预期**

- Compatibility 期间旧 view 不被破坏；
- `public_rental_listings_v2` 只读取 live revision snapshot；
- `admin_rental_listings_v2` 返回 draft aggregate 和 live status；
- view column 类型和顺序可由 repository 正确 mapping。

### MIG-007：Forward-only correction

**预期**

- 已执行 migration 不需要修改；
- backfill 问题可以用新的 forward migration 修复；
- v2 写入开始后，不允许恢复 legacy-only mutation。

## 8. Schema 与 Domain Unit 测试

建议新增：

```text
tests/unit/rental-listing-schema-v2.test.ts
tests/unit/rental-listing-v1-adapter.test.ts
tests/unit/rental-listing-digest.test.ts
tests/unit/supabase-rental-publication.test.ts
```

### VAL-001：最小草稿

- DATA-02 通过 draft validation。
- 同一 payload 不通过 publish validation。

### VAL-002：手动创建必填字段

逐项删除以下字段并断言明确错误：

- title；
- property type；
- street address；
- city；
- monthly rent；
- bedrooms；
- bathrooms；
- description。

### VAL-003：Availability 条件

| Input | Expected |
|---|---|
| `available_now` + null date | Pass |
| `contact` + null date | Pass |
| `available_on` + valid date | Pass |
| `available_on` + null date | Publish fail |
| hidden old date after switching to `available_now` | Normalize date to null |

### VAL-004：Parking 条件

| Input | Expected |
|---|---|
| Parking = No | type/stalls/included/notes normalized as designed |
| Parking = Yes, no type | Publish fail |
| Negative stalls | Fail |
| Included + parking fee row | Allowed only if fee meaning is not contradictory; otherwise fail with repair text |

### VAL-005：Storage 条件

- Storage = No 时 locker count/included/details 不产生公开数据。
- Storage = Yes 时 count 不得为负数。

### VAL-006：Pet 条件

| Input | Expected |
|---|---|
| Not allowed + cats/dogs false | Pass |
| Not allowed + cats true | Fail or normalize cats false consistently |
| Considered/Allowed | cats/dogs/count/size/notes accepted |
| Negative max count/size | Fail |

### VAL-007：Contact 条件

- `site_default` 不要求 custom fields。
- `custom` 要求 name，并至少有 email 或 phone。
- 非法 email 和 phone 返回 field-level error。

### VAL-008：Normalization

- Postal code 输出 `A1A 1A1`。
- Province/country/currency code 大写。
- 文本首尾空白移除。
- Email 比较使用 normalized value。
- Unit number 保留字母和前导零。

### VAL-009：Slug

- 标题生成合法 slug。
- 重名时返回明确 conflict，并提供稳定 suffix。
- 首次 Publish 后 slug 不可修改。

### VAL-010：Digest

- 相同 aggregate 不受 JSON key 顺序影响，得到相同 digest。
- 修改 Property、Amenity、Utility、Fee、Image order 或 cover 都会改变 digest。
- `sort_order` 不参与 listing content digest。

### VAL-011：Legacy v1 adapter

- DATA-05 的字段按映射表转换。
- 缺失字段保持 nullable，不伪造事实。
- v1 response 仍是 flat response。
- review flags 不进入 public output。

## 9. Repository、RPC 与事务测试

### RPC-001：完整 aggregate 创建

执行 DATA-01 创建。

预期：

- Property、Listing、Amenities、Utilities、Fees、Images 全部写入；
- Listing `updated_at` 和 `draft_digest` 更新；
- 返回 aggregate 与随后 GET 一致；
- 只产生预期的 attributed audit event。

### RPC-002：子记录失败时整体回滚

分别制造：

- 非法 amenity code；
- 非法 utility code；
- 非法 fee；
- 不存在的 media ID；
- 重复 cover；
- stale listing version；
- stale property version。

每次失败后断言所有父子表与 digest 都没有变化。

### RPC-003：替换 associations

保存时移除和增加 Amenities、Utilities、Fees、Images。

预期：

- 目标 Listing 的 association 精确等于 payload；
- 其他 Listing 不受影响；
- image sort order 和唯一 cover 正确。

### RPC-004：Save privately 隔离

使用 DATA-03。

预期：

- `published_revision_id` 不变；
- live revision snapshot 不变；
- public view/API 不变；
- Admin draft aggregate 更新；
- 状态为 `Live with unpublished changes`。

### RPC-005：首次 Publish

预期：

- 创建 schema-versioned immutable revision；
- revision `source_digest = draft_digest`；
- pointer 指向新 revision；
- `status = published`；
- public view 显示 snapshot；
- audit attribution 完整。

### RPC-006：Publish updates

预期：

- 旧 revision 不可变；
- 创建新 revision；
- pointer 切换；
- Admin 不再显示 unpublished changes；
- public view 只显示新 revision。

### RPC-007：Unpublish

预期：

- pointer 清空；
- status 变为 draft；
- public view 不再返回该 Listing；
- 历史 revisions 保留。

### RPC-008：Archive

预期：

- pointer 清空；
- status 变为 archived；
- 公开不可见；
- 后续 v2 update/publish 按产品规则被阻止；
- 历史保留。

### RPC-009：Website order

预期：

- 独立 `Update website order` 一次更新全部受影响 Listing；
- 不创建或修改 listing content revision；
- 不改变 draft digest；
- public collection 顺序改变；
- 单个失败不会留下部分顺序。

### RPC-010：Media 两阶段失败

覆盖：

1. Media prepare 失败，DB 不发布。
2. Media prepare 成功，DB commit 失败。
3. 同 request/idempotency key 重试。

预期：

- 不产生重复公开媒体路径；
- public pointer 不会指向不完整 revision；
- orphan promotion 被记录并可清理；
- 重试得到一致结果。

## 10. Admin Browser E2E

建议拆分现有大型 `application.spec.ts`：

```text
tests/e2e/pages/rental-editor-page.ts
tests/e2e/rental-listing-admin.spec.ts
tests/e2e/rental-listing-public.spec.ts
```

Page Object 只封装稳定的业务动作和 locator，不隐藏断言。

### ADM-001：表单结构

验证存在以下 Cards：

1. Home and address
2. Rent, layout, and availability
3. Parking and storage
4. Pets, smoking, and application requirements
5. Utilities included in rent
6. Features and amenities
7. Fees and deposits
8. Contact
9. Description and photos

Advanced 中显示 slug/source/metadata，不显示 UUID 和 revision JSON。

### ADM-002：Control 类型

验证：

- Text/number/date 输入使用 textbox/spinbutton；
- Property type、lease、parking type 使用单选 select；
- Availability、furnishing、pet、smoking 使用 radio group；
- Utilities 和 Amenities 使用 checkbox group；
- Cover image 使用 radio；
- 每组 checkbox/radio 有 `fieldset` 和 `legend`。

### ADM-003：条件显示

- Availability = date 才显示 date。
- Parking = Yes 才显示 type/stalls/included。
- Storage = Yes 才显示 locker fields。
- Pets = Considered/Allowed 才显示 cat/dog/details。
- Contact default unchecked 才显示 custom contact。
- 隐藏后旧值不会继续提交。

### ADM-004：最小草稿

使用 DATA-02：

- Save privately 成功；
- URL 切到 Listing edit route；
- 显示 `Saved privately`；
- 明确说明公开网站没有改变。

### ADM-005：Publish blockers

从 DATA-02 依次触发：

- 缺邮编；
- 缺 availability；
- 缺 policy；
- 无图片；
- 有图片但无 cover；
- custom contact 不完整。

预期：

- Publish 不发起或返回可理解的 validation；
- 页面 summary、Card count 和字段错误同时出现；
- focus 移到第一个错误；
- 已输入内容不丢失。

### ADM-006：完整 Publish

使用 DATA-01：

- 上传并选择三张图；
- 选择唯一 cover；
- Preview；
- Publish；
- 显示 `Live on website`；
- 提供 View live page；
- 公开页面内容正确。

### ADM-007：Private preview

预期：

- 登录 Admin 可访问；
- 显示 Private draft preview banner；
- 使用 draft aggregate 和 draft media；
- 返回 Admin 链接可用；
- 未登录访问跳转登录或返回未授权；
- 页面源代码/API 不暴露长期 draft-media URL。

### ADM-008：已上线后的私下修改

使用 DATA-03：

- 保存后显示 `Live with unpublished changes`；
- 主操作变为 `Publish updates`；
- 公开页仍显示旧值；
- Publish updates 后显示新值。

### ADM-009：版本冲突

使用 DATA-06：

- 显示 Version conflict；
- 提供 Reload latest；
- 提供 Copy unsaved text；
- 不静默覆盖。

### ADM-010：Fees

- 添加 Security deposit 和 Monthly parking fee。
- 删除其中一行。
- Reorder（如支持）。
- Other fee 没有 label 时阻止保存/发布。
- Admin 和公开页只有一个费用数据来源。

### ADM-011：Photos

- 最多 20 张；
- 同一 media 不能重复选择；
- Exactly one cover；
- Move earlier/later 改变公开顺序；
- Alt text 缺失阻止 Publish；
- 取消 cover 图片时清空 cover selection。

### ADM-012：Homepage order

- Create/Edit 主表单没有 Homepage order 数字输入。
- Listing collection 提供独立 reorder。
- 未确认前公开顺序不变。
- 成功文案明确说明网站顺序已更新。

### ADM-013：Archived

- Archive 使用明确确认。
- Archive 后公开不可见。
- Archived editor 不允许误发布。

### ADM-014：Responsive

至少验证：

```text
375 × 812
768 × 1024
1440 × 900
```

预期：

- 无水平滚动；
- Sticky actions 不遮挡字段或错误；
- Checkbox columns 在窄屏可读；
- 图片管理可操作；
- Advanced 不占据主流程。

### ADM-015：Accessibility

用 `@axe-core/playwright` 检查 WCAG 2A/2AA/2.1AA/2.2AA serious violations。

同时手工/自动验证：

- 键盘可以操作全部字段、图片和 sticky actions；
- focus 顺序与页面顺序一致；
- 错误与字段通过 `aria-describedby` 关联；
- radio/checkbox group 有可读 group name；
- status 更新通过适当 live region 宣布；
- color 不是唯一状态表达方式。

### ADM-016：Session expiry

- 保存前模拟 session 失效。
- 重新登录后输入仍可恢复。
- 不把失败显示成 Saved privately 或 Published。

## 11. Public Website 测试

### PUB-001：Listing card

Card 只显示适合快速浏览的内容：

- cover；
- rent；
- title；
- display address；
- bedrooms/bathrooms；
- property type 或必要摘要。

Amenities、fees 和长 Description 留在详情页。

### PUB-002：Detail 分组

DATA-01 公开详情按组显示：

- home facts；
- availability/lease；
- parking/storage；
- pets/smoking；
- included utilities；
- amenities；
- fees；
- contact；
- photos。

没有内容的可选分组不显示空标题。

### PUB-003：Structured address

- 有 unit 时正确组合。
- 无 unit/building 时不产生多余逗号或空格。
- Postal code 标准化显示。

### PUB-004：Property type search

分别测试：

```text
apartment
condo
townhome
house
basement_suite
room
other
```

预期：

- Homepage query、list filter 和 URL parser 使用一致 vocabulary；
- 查询只比较结构化 `property_type`；
- Description 中出现 “condo” 不会让 House 被错误匹配。

### PUB-005：Availability

- Available now 显示对应文案。
- Available on date 显示格式化日期。
- Contact 显示联系确认文案。

### PUB-006：Public allowlist

公开 API/HTML 不得出现：

- actor user/service-account ID；
- request/idempotency key；
- source system/external reference；
- review flags；
- internal notes；
- draft digest；
- raw revision JSON；
- private media path。

### PUB-007：Unpublish/Archive

- 操作完成后 list、detail 和 sitemap 不再出现。
- 旧 detail URL 返回产品定义的 not-found/不可用状态。

### PUB-008：SEO/metadata

- Canonical URL 使用 immutable slug。
- JSON-LD 只使用已公开且验证过的 snapshot 字段。
- 未提供的字段不会生成错误或猜测值。

## 12. Security 与权限测试

更新 `tests/integration/supabase-rls.test.ts` 的私有表清单：

```text
rental_properties
rental_amenities
rental_listing_amenities
rental_utilities
rental_listing_utilities
rental_listing_fees
rental_listing_revisions
```

### SEC-001：匿名表访问

anon 对所有私有表 `select` 返回错误。

### SEC-002：Authenticated 非 Admin

- 无法访问 Admin aggregate。
- 无法调用 save/publish/unpublish/archive/order RPC。
- 无法访问 private preview。

### SEC-003：Function grants

- `PUBLIC`、`anon`、`authenticated` 没有 v2 mutation execute 权限。
- `service_role` 有预期权限。
- Function 使用固定 `search_path`。

### SEC-004：Public projection allowlist

- anon/authenticated 只能读取 `public_rental_listings_v2` 中批准字段。
- 通过 `select("*")` 也不会出现内部字段。

### SEC-005：Custom contact

- 只公开 Listing 明确选择的 contact mode。
- Site default 不重复暴露后台配置或私有 profile 数据。

### SEC-006：Draft media

- 私有 media URL 有短期有效期。
- URL 失效后不能访问。
- Published snapshot 不引用 draft bucket path。

## 13. OpenClaw v1/v2 测试

建议新增或更新：

```text
tests/unit/automation-api.test.ts
tests/unit/automation-confirmations.test.ts
tests/unit/automation-idempotency.test.ts
docs/openclaw-integration/openapi.yaml
integrations/openclaw/**
```

### AUT-001：v1 create compatibility

使用 DATA-05，断言：

- `201`；
- response flat shape；
- v2 内部记录完整；
- Needs review 正确；
- external reference unique。

### AUT-002：v2 create/update

- Nested aggregate 通过 v2 route 保存。
- Exact scopes 生效。
- Listing/property expected version 生效。

### AUT-003：Idempotency

- 相同 key + 相同 payload 重放同一 response。
- 相同 key + 不同 payload 返回 conflict。
- 不重复写 Property、Listing、child rows 或 audit。

### AUT-004：Attributed audit

Audit 同时包含：

- delegated actor user；
- service account；
- request ID；
- source system；
- target Listing。

公开 view 不包含这些值。

### AUT-005：Publish confirmation

- Confirmation digest 绑定完整 v2 aggregate version/digest。
- Draft 修改后旧 confirmation 失效。
- ownership、expiry、acknowledgement、single-use 继续生效。

### AUT-006：v1 retirement safety

V2 写入启用后：

- v1 mutation 调用 v2 adapter，或明确只读；
- 不允许 legacy-only write；
- v1 GET 保持兼容直到 retirement criteria 达成。

## 14. Manual Acceptance Checklist

由业务管理员在 staging 完成。

### 创建

- [ ] 我能理解每个 Card 的目的，不需要知道数据库字段。
- [ ] 我知道哪些是填写、单选和多选。
- [ ] 关闭 Parking/Pets 等选项后，相关内容不会误显示。
- [ ] Save privately 明确告诉我网站没有改变。
- [ ] 缺少 Publish 必填信息时，页面告诉我去哪里修复。

### 预览与发布

- [ ] Preview 明确标记为 Private draft。
- [ ] Publish confirmation 能让我确认地址、租金、照片和联系信息。
- [ ] 发布后可以打开公开页面。
- [ ] 已上线 Listing 修改并 Save privately 后，公开页面保持原样。
- [ ] Publish updates 后公开页面才更新。

### 公开页面

- [ ] 地址、价格、房卫和面积正确。
- [ ] Parking、Utilities、Pets、Amenities 和 Fees 分组清楚。
- [ ] 没有内容的分组不会显示空白。
- [ ] 手机和桌面都容易阅读。
- [ ] Contact 操作正确。

### 下线与归档

- [ ] Remove from website 后公开页面消失，但后台记录保留。
- [ ] Archive 的影响清楚，并且不会误操作。

## 15. Cutover 测试

### CUT-001：切换前 Gate

必须满足：

- 所有 published Listing 有 initial v2 revision；
- v1/v2 public parity report 通过；
- RLS/public allowlist 通过；
- P0 unit、SQL 和 Supabase E2E 全部通过；
- orphan media cleanup 已验证；
- v1 mutation 已路由 v2 或设为只读。

### CUT-002：切换顺序

1. 启用 v2 public reader。
2. 验证 Listing 数量和关键字段。
3. 启用 v2 Admin editor。
4. 启用 OpenClaw v2，并保持 v1 adapter。
5. 监控后停止 legacy field 写入。

任何顺序变化都需要重新评估 Save privately leakage 和 legacy Listing visibility。

### CUT-003：切换后 smoke

- 打开公开列表和一个 legacy detail。
- 创建并保存一个新草稿。
- 发布一个新 Listing。
- 修改一个 live Listing 并 Save privately。
- 确认公开仍是旧值。
- Publish updates。
- Unpublish。
- 检查 Audit 和 revision。

### CUT-004：安全回退

- 如果没有 v2-only publication，可以切回旧 public reader。
- 一旦 v2-only revision 已发布，必须使用 compatibility projector 才能回退 public reader。
- V2 写入开始后绝不恢复 legacy-only mutation。
- 数据修复使用新的 forward migration。

## 16. CI 与执行顺序

### 每次 PR

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

### 涉及 migration、RPC、RLS、Storage 或发布流程的 PR

额外执行：

```bash
E2E_SUPABASE_TEST_PROJECT_CONFIRMED=true pnpm test:e2e:supabase
```

并执行 SQL migration behavior suite。

### 合并前重复性检查

对关键 browser tests：

```bash
pnpm exec playwright test tests/e2e/rental-listing-admin.spec.ts --repeat-each=3
```

不允许用固定 `waitForTimeout` 解决 flaky test。等待具体 response、状态或 locator。

## 17. Release Exit Criteria

Listing V2 可以上线必须同时满足：

- [ ] 所有 P0 测试通过。
- [ ] 所有 P1 测试通过，或有书面接受的非发布阻塞问题。
- [ ] Migration 空库和旧库升级路径通过。
- [ ] Published Listing parity 为 100%。
- [ ] Save privately isolation 通过 Supabase E2E。
- [ ] Public allowlist/RLS 通过。
- [ ] OpenClaw v1 compatibility 和 v2 idempotency 通过。
- [ ] Admin responsive 和 accessibility 通过。
- [ ] Manual acceptance checklist 完成。
- [ ] 没有未解释的 flaky 或 skipped P0 测试。

## 18. 测试报告模板

```markdown
# Rental Listing V2 Test Report

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
| RPC-004 Save privately isolation | | |
| MIG-002 Legacy upgrade | | |
| SEC-004 Public allowlist | | |
| AUT-001 v1 compatibility | | |

## Failures

### Test ID

- Expected:
- Actual:
- Reproduction:
- Screenshot/trace/log:
- Recommended owner:

## Migration parity

- Legacy published count:
- V2 published count:
- Missing IDs:
- Field mismatches:

## Artifacts

- Playwright report:
- Trace:
- Screenshots:
- SQL output:
- Supabase logs:
```

## 19. Requirement Traceability

| Requirement | Primary tests |
|---|---|
| Structured property/listing model | MIG-002, RPC-001, ADM-001 |
| Save privately does not change website | RPC-004, ADM-008 |
| Immutable published revision | MIG-005, RPC-005, RPC-006 |
| Structured control types | ADM-002, ADM-003 |
| Amenities/utilities/fees | RPC-003, ADM-010, PUB-002 |
| Images and cover | RPC-002, ADM-011 |
| Search uses property type | VAL-011, PUB-004 |
| Legacy listing remains visible | MIG-002, MIG-003, CUT-001 |
| RLS/public allowlist | SEC-001–SEC-006 |
| OpenClaw v1/v2 | AUT-001–AUT-006 |
| Accessibility/responsive | ADM-014, ADM-015 |
| Safe cutover | CUT-001–CUT-004 |

