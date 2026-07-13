# 持久化Profile + 账号管理 + 一键发布 — 设计文档

**日期**: 2026-07-13
**状态**: 待实现
**方案**: B — 混合方案（扩展草稿 + CLI 账号管理 + Playwright 发布）

---

## 1. 背景与目标

当前 CLI 的 `--publish` 功能：
- 掘金已打通 Playwright 自动发布
- CSDN 存在覆盖层拦截等不稳定问题
- 无账号管理系统，每次使用需手动登录

本功能将 MultiPost publish-agent 的持久化 profile 方案完整移植到 WechatSync CLI 中。

### 成功标准

- [ ] `wechatsync login <platform>` — Playwright 打开登录页，用户登录后自动保存 profile
- [ ] `wechatsync accounts` — 列出所有平台的所有账号
- [ ] `wechatsync logout <id>` — 删除指定账号及 profile
- [ ] `wechatsync sync --publish` — 自动发布到已选平台的所有账号
- [ ] `wechatsync sync`（无 `--publish`）— 仅保存草稿，行为不变
- [ ] 同一平台多账号支持

---

## 2. 数据模型

### 2.1 accounts.json（`~/.wechatsync/accounts.json`）

```typescript
interface StoredAccount {
  id: string          // 格式: {platformKey}_{8位随机码}，如 "juejin_mrhnk93a"
  name: string        // 用户命名的昵称，如 "掘金大号"
  username?: string   // 从平台提取的用户名，如 "Sp4rk13"
  addedAt: string     // ISO 时间戳
}

// 顶层结构: Record<platformKey, StoredAccount[]>
```

示例：
```json
{
  "juejin": [
    { "id": "juejin_mrhnk93a", "name": "掘金大号", "username": "Sp4rk13", "addedAt": "2026-07-13T10:00:00Z" },
    { "id": "juejin_abc123de", "name": "掘金小号", "username": "Sparkle2", "addedAt": "2026-07-13T11:00:00Z" }
  ],
  "csdn": [
    { "id": "csdn_xyz789ab", "name": "CSDN主号", "username": "Sparkle_Genshin", "addedAt": "2026-07-13T10:30:00Z" }
  ]
}
```

### 2.2 Playwright Profiles（`~/.wechatsync/playwright-profiles/`）

```
playwright-profiles/
  juejin_mrhnk93a/       # Chromium user data directory
    Default/Cookies       # SQLite DB, Chromium 自动管理
    Default/Local Storage/
    Local State
  juejin_abc123de/
  csdn_xyz789ab/
```

每个账号一个完整 Chromium profile 目录。Cookie 由 Chromium 自动持久化，**无需代码管理 Cookie**。

---

## 3. CLI 命令设计

### 3.1 `wechatsync login <platform>`

```
wechatsync login juejin
wechatsync login csdn
wechatsync login --list    # 列出可登录的平台（别名: accounts 命令）
```

**流程：**
1. 校验 `<platform>` 在平台配置表中存在
2. 生成账号 ID: `{platformKey}_{8位随机码}`
3. 创建 profile 目录: `~/.wechatsync/playwright-profiles/{id}/`
4. 启动 Playwright persistent context（可见模式）
5. 注入反检测脚本
6. 导航到平台登录页（从配置表获取 `loginUrl`）
7. 用户手动登录（可见浏览器窗口）
8. 检测登录成功：
   - URL 不再包含 `login` / `passport` / `signin` / `auth`
   - 或通过 API 调用验证（如掘金 `/user_api/v1/user/get`）
9. 提取用户名（API 或 DOM）
10. 提示输入昵称，默认使用提取的用户名
11. 保存到 `accounts.json`
12. 关闭浏览器

### 3.2 `wechatsync accounts`

列出所有平台的所有已登录账号：
```
  掘金:
    掘金大号 (Sp4rk13)  juejin_mrhnk93a ✅
    掘金小号 (Sparkle2)  juejin_abc123de ✅
  CSDN:
    CSDN主号 (Sparkle_Genshin)  csdn_xyz789ab ✅
```

✅ = profile 目录存在（可正常使用）
⚠️ = profile 目录不存在（需重新登录）

### 3.3 `wechatsync logout <id>`

```
wechatsync logout juejin_mrhnk93a
```

删除账号记录 + 删除对应的 profile 目录。需要二次确认。

### 3.4 `wechatsync sync --publish`（改进）

现有流程 + Playwright 发布：

```
1. 扩展保存草稿 → 获取 articleId（不变）
2. 如果 --publish:
   a. 读取 accounts.json[platformKey] 获取该平台所有账号
   b. 如果没有账号记录，回退到无账号模式（打开浏览器，用户可能需登录）
   c. 对每个账号：
      - 用对应 profile 启动 Playwright
      - 导航到编辑器 URL（含 articleId）
      - 调用平台的 doPublish()
      - 关闭浏览器
   d. 汇总所有账号的发布结果
```

**输出示例：**
```
  [自动发布] juejin
    ✓ juejin (掘金大号) 已发布  https://juejin.cn/post/...
    ✓ juejin (掘金小号) 已发布  https://juejin.cn/post/...
  [自动发布] csdn
    ✓ csdn (CSDN主号) 已发布  https://blog.csdn.net/article/details/...
```

---

## 4. 平台配置表

```typescript
interface PlatformPublishConfig {
  name: string                        // 平台显示名
  loginUrl: string                    // 登录页 URL
  editorUrl: (articleId: string) => string  // 编辑器页 URL 模板
  postLoginUrl?: string               // 登录后跳转页（用于验证）
  doPublish: (page: Page) => Promise<void>  // 发布操作
  checkUsername?: (page: Page) => Promise<string | null>  // 提取用户名
}
```

首批支持平台：

| 平台 | loginUrl | editorUrl | doPublish |
|------|----------|-----------|-----------|
| **掘金** | `juejin.cn/login` | `juejin.cn/editor/drafts/{id}` | 等发布按钮 enabled → 点击 |
| **CSDN** | `passport.csdn.net/login` | `mp.csdn.net/mp_blog/creation/editor/{id}` | 定时发布 → 发布博客 |
| **知乎**（后续） | TBD | TBD | TBD |
| **微博**（后续） | TBD | TBD | TBD |

---

## 5. 文件结构

```
packages/cli/src/
  index.ts                          # 新增 login/accounts/logout 命令
  playwright/
    account-manager.ts              # 新建：accounts.json 读写
    profile-manager.ts              # 新建：profile 目录管理
    platform-config.ts              # 新建：平台配置表
    anti-detect.ts                  # 新建：反检测脚本（从 MultiPost 移植）
    publish-engine.ts               # 新建：发布引擎（取代现有 publish-dom.ts）
```

### 5.1 account-manager.ts
```typescript
loadAccounts(): Record<string, StoredAccount[]>
saveAccounts(data): void
getAccount(id: string): StoredAccount | null
getAccountsForPlatform(platform: string): StoredAccount[]
addAccount(platform: string, name: string, username?: string): StoredAccount
removeAccount(id: string): void
```

### 5.2 profile-manager.ts
```typescript
getProfileDir(accountId: string): string    // ~/.wechatsync/playwright-profiles/{id}
profileExists(accountId: string): boolean
removeProfile(accountId: string): void
launchProfile(accountId: string): Promise<BrowserContext>  // 启动持久化 Chrome
```

### 5.3 platform-config.ts
```typescript
getPlatformConfig(platformKey: string): PlatformPublishConfig | null
getSupportedPlatforms(): string[]  // 返回所有支持 Playwright 发布的平台 ID
```

### 5.4 anti-detect.ts
从 MultiPost 移植的反检测脚本：
```typescript
export const ANTI_DETECT_SCRIPT = `
  Object.defineProperty(navigator, "webdriver", { get: () => false });
  window.chrome = { runtime: {} };
  // ... Shadow DOM 破解等
`
```

### 5.5 publish-engine.ts（重写 publish-dom.ts）
```typescript
publishArticle(
  platform: string,
  articleId: string,
  accountId?: string   // 可选，指定账号；不指定则使用默认
): Promise<PublishResult>

publishToAllAccounts(
  platform: string,
  articleId: string
): Promise<PublishResult[]>
```

---

## 6. 同步流程改动

### index.ts 中的 `sync --publish` 改动

```typescript
// 现有：draftOnly: !options.publish → 扩展保存草稿
// 新增：after sync, if --publish:
for (const result of results) {
  if (result.success && options.publish && result.postId) {
    const accounts = getAccountsForPlatform(result.platform)
    if (accounts.length > 0) {
      // 账号模式：每个账号发布一次
      const pubResults = await publishToAllAccounts(result.platform, result.postId)
      // 更新 result 状态
    } else {
      // 无账号模式：回退到旧行为（单次 Playwright 发布，可能需登录）
      await publishArticle(result.platform, result.postId)
    }
  }
}
```

---

## 7. 不包含

- 扩展 UI 中的账号管理界面（后续迭代）
- 多账号并发发布（当前串行，后续可并行）
- 知乎/微博等其他平台的 Playwright 发布配置（后续添加）
- WordPress/Typecho 的 Playwright 发布（已有 API 支持）
- MCP Server 层面的账号管理（仅 CLI）

---

## 8. 风险与注意

- Playwright Chromium 首次运行需下载 ~130MB，需在 `login` 命令中友好提示
- Windows 下 Chromium profile 路径可能有长度限制
- CSDN 发布按钮被日期选择器覆盖的问题，需用 `force: true` 或 JS 点击解决
- 掘金发布按钮可能需要等待 `brief_content` 满足 50-100 字要求
