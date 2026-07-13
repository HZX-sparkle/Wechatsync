# 一键自动发布功能 — 设计文档

**日期**: 2026-07-13
**状态**: 待实现
**方案**: C — 分层渐进（基础设施 + 3 个平台）

---

## 1. 背景与目标

当前 WechatSync 所有平台适配器默认保存为草稿（`draftOnly: true`），用户在 CLI/扩展中同步文章后需要手动到各平台点击"发布"。本功能增加「一键自动发布」选项，让用户选择跳过草稿直接发布。

### 成功标准

- [ ] CLI `--publish` flag 可用，不加 flag 行为不变
- [ ] MCP `sync_article` 工具支持 `publish` 参数
- [ ] 扩展 SyncDialog 有「直接发布」开关，默认关闭
- [ ] CSDN、掘金、知乎 3 个平台率先支持真正自动发布
- [ ] 不支持发布的平台自动降级为草稿，不丢内容
- [ ] 已有测试全部通过，无回归

---

## 2. 范围

### 包含

- 基础设施：CLI flag、MCP 参数、扩展 UI、消息传递链
- 平台适配：CSDN、掘金、知乎实现发布 API 调用
- 容错降级：发布失败 → 草稿，不支持发布 → 草稿

### 不包含

- 其他 6 个已登录平台（微博、B站、百家号、微信公众号、51CTO、SegmentFault）的发布实现——后续迭代
- 其他未登录平台——后续迭代
- 定时发布/排期发布

---

## 3. 数据流

```
CLI (--publish)
    ↓ params.publish = true
ExtensionBridge.request('syncArticle', { ..., publish: true })
    ↓
Chrome Extension (background/index.ts)
    ↓ draftOnly: false
syncPlatforms(article, platformIds, { draftOnly: false })
    ↓
Adapter.publish(article, { draftOnly: false })
    ├─ 支持发布 → 保存草稿 → 调用发布API → SyncResult { draftOnly: false }
    └─ 不支持/失败 → 保存草稿 → SyncResult { draftOnly: true, message: '已保存为草稿' }
```

### 同步时的 UI 也走同样链路

```
SyncDialog [直接发布] toggle ON
    ↓ SYNC_ARTICLE { draftOnly: false }
background/index.ts → syncPlatforms(article, platformIds, { draftOnly: false })
    ↓
Adapter.publish(article, { draftOnly: false })
```

---

## 4. 基础设施层改动

### 4.1 CLI — `packages/cli/src/index.ts`

**新增 flag**:
```
wechatsync sync article.md -p zhihu,juejin --publish
```

`sync` 命令新增 option:
```typescript
.option('--publish', '直接发布文章（跳过草稿）')
```

传递给 bridge 的 params:
```typescript
const response = await bridge.request('syncArticle', {
  markdown: article.markdown,
  html: article.html,
  title: article.title,
  cover: article.cover,
  platforms: platforms,
  draftOnly: !options.publish,  // --publish → draftOnly: false
})
```

结果展示时区分显示:
```
同步结果:
  ✓ juejin (已发布)     ← draftOnly: false
  ✓ zhihu (草稿)        ← draftOnly: true（降级）
```

### 4.2 MCP Server — `packages/mcp-server/src/index.ts`

`sync_article` 工具新增 `publish` 参数:
```typescript
{
  name: 'sync_article',
  inputSchema: {
    type: 'object',
    properties: {
      platforms: { type: 'array', ... },
      title: { type: 'string', ... },
      markdown: { type: 'string', ... },
      content: { type: 'string', ... },
      cover: { type: 'string', ... },
      publish: { type: 'boolean', description: '直接发布（跳过草稿）' },  // NEW
    },
    required: ['platforms', 'title', 'markdown'],
  },
}
```

处理逻辑:
```typescript
const { platforms, title, markdown, content, cover, publish } = args
const result = await bridge.request('syncArticle', {
  platforms, title, markdown, content, cover,
  draftOnly: !publish,
})
```

### 4.3 MCP Client — `packages/extension/src/mcp/client.ts`

`handleRequest` 的 `syncArticle` case 中，透传 `draftOnly`:
```typescript
case 'syncArticle': {
  const { platforms, title, markdown, content, cover, draftOnly } = message.params || {}
  return await performSync({ platforms, title, markdown, content, cover }, { draftOnly })
}
```

### 4.4 Extension 后台 — `packages/extension/src/background/index.ts`

`SYNC_ARTICLE` 消息处理:
```typescript
case 'SYNC_ARTICLE': {
  const { article, platformIds, draftOnly } = data
  // draftOnly 默认为 true（保持现有行为）
  syncPlatforms(article, platformIds, { draftOnly: draftOnly ?? true }, sendProgress)
}
```

### 4.5 Extension 同步引擎 — `packages/extension/src/adapters/index.ts`

`syncPlatforms` 函数中，透传 `draftOnly` 给每个适配器的 `publish()`:
```typescript
// 现有代码已经是:
adapter.publish(platformArticle, {
  draftOnly: options?.draftOnly ?? true,
  onImageProgress: ...
})
// 无需改动，只需确认 options.draftOnly 能正确传入
```

### 4.6 Extension UI — `packages/extension/src/components/sync-dialog/SyncDialog.tsx`

新增「直接发布」Toggle:
```tsx
// 在平台列表下方、同步按钮上方
<div className="flex items-center gap-2 py-2">
  <Switch
    checked={publishMode}
    onCheckedChange={setPublishMode}
  />
  <Label>直接发布（跳过草稿，立即发布到各平台）</Label>
</div>
```

同步时传递:
```typescript
chrome.runtime.sendMessage({
  type: 'SYNC_ARTICLE',
  data: {
    article,
    platformIds: selectedPlatforms,
    draftOnly: !publishMode,
  },
})
```

### 4.7 Extension 同步服务 — `packages/extension/src/background/sync-service.ts`

`performSync` 函数签名不变，内部将 `draftOnly` 传给 `syncPlatforms`。CMS 适配器（WordPress/Typecho）暂时保持 `draftOnly: true`，不变。

---

## 5. 平台适配层改动（第一批：3 个平台）

### 5.1 容错模式（所有适配器统一）

```typescript
// 所有适配器的 publish() 采用同一容错模式:
const shouldPublish = options?.draftOnly === false

// 1. 先保存草稿（无论是否发布，都先存草稿确保内容不丢）
const draftId = await this.saveDraft(article) // 现有逻辑

if (shouldPublish) {
  try {
    await this.doPublish(draftId) // 新增：调用平台发布 API
    return this.createResult(true, {
      postId: publishedId,
      postUrl: publishedUrl,
      draftOnly: false,
    })
  } catch (error) {
    logger.warn('Publish failed, fallback to draft:', error)
    return this.createResult(true, {
      postId: draftId,
      postUrl: draftUrl,
      draftOnly: true,
      message: '发布失败，已保存为草稿',
    })
  }
}

// draft-only 模式（现有逻辑不变）
return this.createResult(true, {
  postId: draftId,
  postUrl: draftUrl,
  draftOnly: true,
})
```

### 5.2 CSDN — `packages/core/src/adapters/platforms/csdn.ts`

**分析**: CSDN 的保存 API `POST /blog-console-api/v3/editor/save` 已支持通过 `pubStatus` 和 `status` 字段控制发布状态。

**改动** (两行):
```diff
- status: 2,           // 草稿
- pubStatus: 'draft',
+ status: options?.draftOnly === false ? 1 : 2,
+ pubStatus: options?.draftOnly === false ? 'public' : 'draft',
```

发布成功后 URL 不同（`articleId` 相同，链接路径不同）:
```typescript
const publishedUrl = options?.draftOnly === false
  ? `https://blog.csdn.net/${username}/article/details/${postId}`
  : `https://editor.csdn.net/md?articleId=${postId}`
```

### 5.3 掘金 — `packages/core/src/adapters/platforms/juejin.ts`

**分析**: 掘金先调 `article_draft/create` 创建草稿获取 draft ID，发布需调额外的 `article_draft/publish` 接口。

**改动** (在现有 draft 创建成功后新增):

```typescript
// 现有逻辑: 创建草稿
const draftId = createData.data.id

if (options?.draftOnly === false) {
  // 新增: 发布草稿
  const publishResponse = await this.runtime.fetch(
    `https://api.juejin.cn/content_api/v1/article_draft/publish`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-secsdk-csrf-token': csrfToken,
      },
      body: JSON.stringify({ draft_id: draftId }),
    }
  )
  const publishData = await publishResponse.json()
  if (publishData.err_no === 0) {
    const publishedUrl = `https://juejin.cn/post/${draftId}`
    return this.createResult(true, { postId: draftId, postUrl: publishedUrl, draftOnly: false })
  }
  logger.warn('Juejin publish failed:', publishData)
  // 降级：返回草稿
}
```

### 5.4 知乎 — `packages/core/src/adapters/platforms/zhihu.ts`

**分析**: 知乎先 POST 创建草稿 → PATCH 更新内容，发布需要调 `PUT /api/articles/{draftId}/publish`。

**改动** (在现有 draft 更新成功后新增):

```typescript
// 现有逻辑: 创建并更新草稿
logger.debug('Draft updated, status:', updateResponse.status)

if (options?.draftOnly === false) {
  const publishResponse = await this.runtime.fetch(
    `https://zhuanlan.zhihu.com/api/articles/${draftId}/publish`,
    {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-requested-with': 'fetch',
      },
      body: JSON.stringify({ title: article.title }),
    }
  )
  if (publishResponse.ok) {
    const publishedUrl = `https://zhuanlan.zhihu.com/p/${draftId}`
    return this.createResult(true, { postId: draftId, postUrl: publishedUrl, draftOnly: false })
  }
  logger.warn('Zhihu publish failed:', publishResponse.status)
  // 降级：返回草稿
}
```

---

## 6. 要调研确认的 API 细节

实现时需要确认的平台 API:

| 平台 | 需确认 | 验证方式 |
|------|--------|----------|
| CSDN | `pubStatus: 'public'` + `status: 1` 是否正确 | 手动发布一篇，抓 Network 请求对比 |
| 掘金 | `article_draft/publish` endpoint 和参数名 | 同上 |
| 知乎 | `PUT /api/articles/{id}/publish` endpoint 和 body | 同上 |

---

## 7. 测试策略

### 单元测试
- CLI `--publish` flag 正确解析为 `draftOnly: false`
- 不加 flag 时 `draftOnly: true`（不变）
- MCP 工具 `publish: true` → `draftOnly: false`

### 集成测试
- CSDN `draftOnly: false` → `pubStatus: 'public'`
- CSDN `draftOnly: true` → `pubStatus: 'draft'`（回归）
- 掘金 `draftOnly: false` → 调用 publish API，返回 published URL
- 知乎 `draftOnly: false` → 调用 publish API，返回 published URL

### 手工验证
1. CLI: `wechatsync sync test.md -p csdn --publish` → CSDN 直接发布
2. CLI: `wechatsync sync test.md -p csdn` → CSDN 草稿（回归）
3. 扩展 UI: toggle ON → 同步到 CSDN → 直接发布
4. MCP: `sync_article(publish: true)` → 文章直接发布

---

## 8. 文件改动清单

```
packages/
├── cli/src/index.ts                          # +--publish flag
├── mcp-server/src/index.ts                    # sync_article +publish 参数
├── extension/src/
│   ├── background/index.ts                    # SYNC_ARTICLE 透传 draftOnly
│   ├── background/sync-service.ts             # performSync 透传 draftOnly
│   ├── adapters/index.ts                      # syncPlatforms 透传 draftOnly (确认)
│   ├── mcp/client.ts                          # syncArticle 透传 draftOnly
│   └── components/sync-dialog/SyncDialog.tsx   # +发布开关 UI
├── core/src/adapters/platforms/
│   ├── csdn.ts                                # pubStatus/status 切换
│   ├── juejin.ts                              # +article_draft/publish 调用
│   └── zhihu.ts                               # +PUT publish 调用
```
