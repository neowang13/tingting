# 私有管理员 MCP / Muse 接入

更新：2026-10-17。接口为 `https://silverkey.ca/api/mcp`，官方 MCP SDK、无会话 Streamable HTTP、JSON 响应。默认关闭；生产通过环境变量启用，当前版本需要迁移065–068。实际 Muse 连接须单独联调。

Owner 确认的“上架”包含填写房源资料、上传照片、创建草稿、检查并发布，不能只操作已有房源的发布状态。首次授权可以包含房源读写权限，不设只读过渡阶段。申请与预约权限独立选择。

## Admin 登录是连接前提

流程：Muse 发起连接 → 网站 Admin 登录 → 网站展示接入方名称、回调网站和权限 → 管理员允许 → Muse 获得绑定该管理员的 OAuth 令牌。

- 复用现有 Admin 登录、active admin profile、会话检查和已配置的 MFA，不新增普通用户注册入口。
- 普通 Muse 账号、网站 Client 账号都不能取得管理权限。公开的客户端注册只登记接入程序及回调地址，不授予任何管理权限。
- Admin 密码只在网站登录页填写，不交给 Muse，不粘贴进聊天。`MCP_CREDENTIALS_JSON`、静态 Bearer key 和生成密钥脚本已移除，不是备用入口。
- `/api/mcp` 接受本网站 OAuth 签发的访问令牌；网站后台 Cookie 不会直接成为 Muse 的凭据。每次工具调用仍检查连接有效期、撤销状态、管理员是否有效、Auth 用户是否存在/被封禁和权限范围。
- OAuth 授权码 + S256 PKCE；注册的回调地址严格匹配；令牌仅适用于此 MCP resource。授权码五分钟、同浏览器授权请求十分钟、access token 十五分钟、整个授权最多七天。Refresh token 每次轮换，重放会撤销连接。
- 管理员在 `/admin/mcp` 的 Connected apps 可撤销自己的连接。停用管理员也会阻断调用。退出网站 Admin 并不等于撤销已批准的 OAuth 连接；需要在 Connected apps 撤销。

## 16个工具

| 工具 | 权限 | 行为 |
|---|---|---|
| `list_rentals` / `get_rental` | rentals:read | 查房源、完整可编辑资料、日历草稿、版本和发布缺项 |
| `get_rental_editor` | rentals:read | 获取完整字段结构和新房源空白模板 |
| `list_rental_images` | rentals:read | 获取已有图片的 ID、描述和尺寸 |
| `upload_rental_image` | rentals:write | 上传照片并生成可用于房源的图片 ID；不发布 |
| `create_rental` | rentals:write | 创建完整房源草稿和初始看房日历；不发布 |
| `update_rental` | rentals:write | 修改房源资料、租金和图片选择；不立即改变公开内容 |
| `set_rental_publication` | rentals:write | 房源与看房日历一起上架，或将房源下架 |
| `list_applications` / `get_application` | applications:read | 查申请表、共同申请人资料及附件筛查状态 |
| `set_application_status` | applications:write | 按现有流程变更申请状态；批准沿用申请人邮件 |
| `list_showings` / `get_showing` | showings:read | 查预约、联系人、日期/时间和版本 |
| `manage_showing` | showings:write | 确认、安排具体时间、改期、拒绝、取消 |
| `update_viewing_calendar` | showings:write | 保存私有日历草稿，另行发布才公开 |
| `get_operation` | 对应写权限 | 查本连接的写操作结果，处理失败/重试 |

列表 offset/limit 默认25、最多100。工具发现按授权范围过滤。房源写流程应同时授予 rentals:read、rentals:write；用户可授权全部现有管理功能或缩小范围。

## 从资料录入到上架

1. 调用 `get_rental_editor` 获取表单结构和空白模板，向管理员收集真实资料。必需信息缺失应询问，不推测租金、地址、政策或看房日期。
2. 用 `upload_rental_image` 上传管理员提供的照片，或从已有图片中选取。工具的 base64 文件内容应由接入程序从附件读取并发送，不放入普通聊天或模型上下文。单张最多8 MiB，复用网站的真实文件验证和图片优化，不抓取外部 URL。
3. `create_rental` 保存新房源、照片/封面及初始看房日历，返回房源 ID、版本、发布缺项。未提供日历时默认没有开放日期，不能凭空排期。
4. `get_rental` 返回完整 listing；`update_rental` 可修改资料、租金及图片选择。修改已发布房源时，原公开版本保持到再次发布。
5. 缺项补齐、管理员授权后调用 `set_rental_publication` 上架。发布要求包括省份、可入住状态、至少一张照片及唯一封面。房源和日历草稿一起发布。下架保留记录，不等于删除。

创建、上传、保存和发布都是分别可核对的步骤；Muse 可在同一次任务中完成整个流程。不提供删除房源、签租约、转租客或收租工具。中途失败可能留下私有草稿，不能声称已上架。

## 申请与预约边界

申请状态遵循 submitted → under_review → approved / declined；submitted 和 under_review 可转为 needs_information，补资料后直接进入 under_review。未终结的已提交申请可撤回。网站和 MCP 均不再提供“标记已接收”操作，历史 received 记录仍可直接进入审核、要求补资料或撤回。不能从 draft 或 submitted 直接批准。审核和审批不再要求逐个 Mark cleared；明确拒绝的附件仍阻止批准，但不阻止审核或拒绝申请。上传时保留格式、大小及危险 PDF 检查；MCP 不提供文件下载。批准不等于签约或转租客。

批准邮件发往主申请人的已验证登录账号邮箱，不使用独立填写的表单联系邮箱替代；返回实际收件地址。queued 表示邮件服务接受请求，不代表收件箱已收到。网站对已批准申请提供 Resend approval email；重发不重新审批或更改申请状态，受 Admin 权限和频率限制。needs_information 和 declined 目前不会自动通知申请人。approved、declined、withdrawn 是终止状态，当前流程不能重新打开申请。

预约支持同日期多组。accepted 且时间为空只表示日期登记；具体时间统一 America/Vancouver，需在将来且无夏令时歧义。改期/确认限已发布日历和一个月窗口。取消/拒绝后不能重新打开；变更不会自动发访客邮件或 SMS，返回 `notification: not_sent`，管理员应自行联系。修改开放日期不改变已有预约。MCP 暂不新建预约。

## 部署与 Muse 自用连接

1. 在隔离数据库验证并应用065–068（依赖001–064），再部署代码。迁移不会随网站构建自动执行。保持 MCP 关闭直到数据库准备好。
2. 生产使用 Supabase、HTTPS、正确 APP_BASE_URL 和已有有效 Admin；设置 `MCP_ENABLED=true`。不配置静态密钥。
3. 在 Muse 创建仅供自己使用的 Custom Connector，不需要公开上架。可使用以下说明：

```text
为我创建并保存私用的 Silverkey Admin Custom Connector。
接入说明：https://silverkey.ca/api/mcp/setup
MCP：https://silverkey.ca/api/mcp，remote stateless Streamable HTTP。
认证使用 OAuth authorization code + S256 PKCE，读取 resource 和 authorization server metadata。
请打开网站的授权页，让我用 Admin 账号登录并选择权限；不要索取 Admin 密码或 Cookie。
房源需要查询、填写资料、上传照片、创建/编辑、上架和下架权限，不设只读阶段。
根据我明确授权的目标执行写操作；目标不清楚时询问。
```

4. Muse 接入程序使用公开动态注册接口登记真实 HTTPS 回调，`token_endpoint_auth_method=none`。此实现不提供 client secret、密码授权或隐式授权，不获取 URL 型客户端 metadata，避免额外 SSRF 面。若 Muse 实际客户端不支持此 OAuth 流程，需要适配，不能跳过 Admin 登录或声称已连接。
5. 在 Muse 实测工具发现、真实 Admin 授权和受控上下架，确认未经授权/撤销的连接无法访问。当前本地浏览器测试替代不了真实 Muse 账号验收。

发现地址：`/.well-known/oauth-protected-resource/api/mcp`、`/.well-known/oauth-protected-resource`、`/.well-known/oauth-authorization-server`。OAuth 端点在 `/api/mcp/oauth/{register,authorize,token,revoke}`。MCP 客户端应在授权、换令牌及刷新时带准确 resource `https://silverkey.ca/api/mcp`。实际 Muse Custom Connector 授权请求可能省略该参数；服务器按照 RFC8707 的固定默认资源规则，将省略值绑定到这个唯一 MCP 地址。显式传入错误地址、空值或重复参数仍拒绝；Admin 登录、同意、回调匹配、PKCE、scope、令牌资源绑定及撤销检查均保留。401 返回 resource metadata challenge。

服务器调用可以不带 Origin；存在的 Origin 必须在 APP_BASE_URL 或已确认的 `MCP_ALLOWED_ORIGINS` 中，不使用通配符或浏览器 CORS。生产不接受 memory 数据。关闭返回404，未连接/过期/撤销401，管理员/权限/Origin拒绝403，配置/存储不可用503。

## 写入确认、审计和失败恢复

所有写工具要求 `confirmed: true`、独立 operationId UUID 和需要时的最新版本。明确的上下架指令可以作为该次授权；工具参数本身不能证明有人类确认。Muse 的确认行为需要实测，不能把 MCP annotation 当成人工审批强保证。

执行前保存 `mcp_operations` 审计及去重记录。相同 ID/参数重试返回已保存结果；换参数复用或并行重复会被拒绝。查询结果按同一连接和当前权限隔离。每分钟每连接120请求、20写调用；公开注册/换令牌另有限流。

业务写入与结果记录不是同一事务。pending/uncertain 可能表示业务已成功，须用 get_operation 和目标记录核对；不要换编号盲目重试。照片或房源保存成功后后续发布失败，也不能重新上传/创建以替代核对。

数据库只保存授权码、浏览器 nonce 和令牌的哈希；不保存 Admin 密码或明文令牌。OAuth 同意、撤销有审计记录。授权和审计数据只能由服务端访问。申请表和预约联系人会通过授权工具返回 Muse，撤销连接不能收回已进入对话/记忆的数据。审计及去重记录清理前须撤销对应授权并对账。

## 验证

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm exec playwright test --config=playwright.mcp.config.ts
```

专项单元测试覆盖 OAuth Admin 登录边界、scope、PKCE、回调和 resource 绑定、刷新重放、撤销、静态密钥拒绝，以及官方 MCP 客户端完成新建房源/上传/编辑/上架/下架。浏览器测试使用真实本地 Admin 登录和授权页，验证权限选择、移动布局、无障碍及撤销后401。SQL 测试为 `tests/sql/admin-mcp.sql` 和 `tests/sql/admin-mcp-oauth.sql`，只能在隔离数据库执行。

官方说明：[Muse 自用 Custom Connector](https://www.meta.com/help/artificial-intelligence/1687253048996149/)、[MCP HTTP 授权](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)。真实 Muse 账号联通仍待验收，网站部署成功也不能代替此项验证。

本地验收记录：412项测试通过，29项需要独立 Supabase 的测试跳过；22项 MCP/OAuth 专项通过。真实本地浏览器完成 Admin 登录、权限选择、手机导航撤销及撤销后401，授权页无障碍检查通过。全部67个迁移在隔离 PostgreSQL 17 从头重放，管理与 OAuth SQL 行为测试通过并回滚。浏览器和工具测试使用 memory 数据和 mock 通知；这些验收未写入生产业务记录、发送真实通知或连接实际 Muse 账号。

2026-10-17 流程简化验收：网站与 MCP 不再接受 received 作为新目标状态；提交后及补资料后均可直接进入审核，历史 received 记录可继续处理。412项自动测试通过（29项 Supabase 集成测试跳过），lint / typecheck 通过；67个迁移和两组 MCP SQL 测试通过。单人申请、共同申请及 Admin 闲置退出的浏览器验证通过；共同申请验证使用启用第二个演示账号的本地测试配置。生产尚未部署。

2026-10-17 MCP 初版已通过 PR #28 上线并启用；本轮审核和邮件修复依赖迁移068。实际 Muse 联调须单独完成。
