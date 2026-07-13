# 一键自动发布 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `--publish` option to CLI/MCP/UI that skips drafts and publishes directly, with CSDN/Juejin/Zhihu as first batch.

**Architecture:** Thread `draftOnly: boolean` from CLI flag/MCP param/UI toggle through `performSync` → `syncToMultiplePlatforms` → `syncToPlatform` → `adapter.publish()`. Each adapter checks `options.draftOnly === false` to call its platform-specific publish API, falling back to draft on failure.

**Tech Stack:** TypeScript, Chrome Extension MV3, React + Zustand, tsup

## Global Constraints

- All changes respect `draftOnly: true` default — existing behavior unchanged
- Publish failure MUST fall back to draft — never lose content
- CMS adapters (WordPress/Typecho) remain draft-only for now
- `options?.draftOnly ?? true` pattern used consistently across all adapters

---

### Task 1: Thread `draftOnly` through the core sync chain

**Files:**
- Modify: `packages/extension/src/adapters/index.ts` — `syncToMultiplePlatforms`
- Modify: `packages/extension/src/background/sync-service.ts` — `SyncOptions`, `performSync`
- Modify: `packages/extension/src/mcp/client.ts` — `syncArticle` handler
- Modify: `packages/extension/src/background/index.ts` — `SYNC_ARTICLE` handler

**Interfaces:**
- Consumes: (nothing — this is the backbone)
- Produces:
  - `syncToMultiplePlatforms(platformIds, article, callbacks?, source?, draftOnly?: boolean)` — new param
  - `SyncOptions { skipHistory?, source?, draftOnly? }` — new field
  - All downstream tasks depend on `draftOnly` reaching `adapter.publish()`

---

- [ ] **Step 1: Add `draftOnly` param to `syncToMultiplePlatforms`**

File: `packages/extension/src/adapters/index.ts`

At line 482-487, change the function signature:

```typescript
export async function syncToMultiplePlatforms(
  platformIds: string[],
  article: Article,
  callbacks?: SyncCallbacks,
  source = 'popup', // 来源：popup, weixin, weixin-editor, mcp 等
  draftOnly = true  // 默认草稿模式，保持向后兼容
): Promise<SyncResult[]> {
```

At line 564-570, change the `syncToPlatform` call inside `syncOne`:

```typescript
    const result = await syncToPlatform(
      platformId,
      article,
      { draftOnly },  // was: undefined
      wrappedImageProgress
    )
```

---

- [ ] **Step 2: Add `draftOnly` to `SyncOptions` and `performSync`**

File: `packages/extension/src/background/sync-service.ts`

At line 62-65, modify `SyncOptions`:

```typescript
interface SyncOptions {
  skipHistory?: boolean
  source?: string
  draftOnly?: boolean  // NEW: 是否只保存草稿，默认 true
}
```

At line 224-236, modify `performSync` signature to destructure `draftOnly`:

```typescript
export async function performSync(
  article: {
    title: string
    content?: string
    html?: string
    markdown?: string
    cover?: string
  },
  platforms: string[],
  options: SyncOptions = {},
  callbacks: SyncProgressCallbacks = {}
): Promise<{ results: SyncResult[]; syncId: string }> {
  const { skipHistory = false, source = 'mcp', draftOnly = true } = options
```

At line 312-331, pass `draftOnly` to `syncToMultiplePlatforms`:

```typescript
  if (dslPlatformIds.length > 0) {
    await syncToMultiplePlatforms(dslPlatformIds, processedArticle, {
      onResult: (result) => {
        // ... unchanged ...
      },
      onImageProgress: (platform, current, total) => {
        onImageProgress?.(platform, current, total)
      },
      onDetailProgress: (progress: SyncDetailProgress) => {
        onDetailProgress?.(progress)
      },
    }, source, draftOnly)  // was: , source
  }
```

At lines 378-386, pass `draftOnly` to CMS adapters instead of hardcoded `true`:

```typescript
      switch (account.type) {
        case 'wordpress':
          result = await wordpressAdapter.publish(credentials, normalizedArticle, { draftOnly })  // was: { draftOnly: true }
          break
        case 'typecho':
          result = await metaweblogAdapter.publishToTypecho(credentials, normalizedArticle, { draftOnly })  // was: { draftOnly: true }
          break
        case 'metaweblog':
          result = await metaweblogAdapter.publish(credentials, normalizedArticle, { draftOnly })  // was: { draftOnly: true }
          break
```

---

- [ ] **Step 3: Pass `draftOnly` from MCP client to `performSync`**

File: `packages/extension/src/mcp/client.ts`

At line 325-367, modify the `syncArticle` handler to extract and pass `draftOnly`:

```typescript
      case 'syncArticle': {
        const platforms = params?.platforms as string[]
        const articleData = params?.article as {
          title: string
          content?: string
          markdown?: string
          cover?: string
        }
        const draftOnly = (params?.draftOnly as boolean) ?? true  // NEW

        if (!platforms?.length) throw new Error('Missing platforms parameter')
        if (!articleData?.title) throw new Error('Missing article title')
        if (!articleData?.markdown && !articleData?.content) {
          throw new Error('Missing article content (markdown or content required)')
        }

        // ... markdown conversion unchanged ...

        const { results, syncId } = await performSync(
          article,
          platforms,
          { source: 'mcp', draftOnly }  // was: { source: 'mcp' }
        )

        return { results, syncId }
      }
```

---

- [ ] **Step 4: Pass `draftOnly` from `SYNC_ARTICLE` handler to `syncToMultiplePlatforms`**

File: `packages/extension/src/background/index.ts`

At line 208, extract `draftOnly` from payload:

```typescript
    case 'SYNC_ARTICLE': {
      const { article, platforms, allSelectedPlatforms, skipHistory, source = 'popup', syncId: passedSyncId, draftOnly = true } = message.payload
```

At line 299-306, pass `draftOnly` to `syncToMultiplePlatforms`:

```typescript
      if (dslPlatformIds.length > 0) {
        await syncToMultiplePlatforms(dslPlatformIds, processedArticle, {
          onResult: (result) => {
            // ... unchanged ...
          },
          onImageProgress: /* ... unchanged ... */,
          onDetailProgress: /* ... unchanged ... */,
        }, source, draftOnly)  // was: , source
      }
```

---

- [ ] **Step 5: Build and verify no regressions**

Run: `cd F:\Code\billionaire\Wechatsync && pnpm build:extension 2>&1 | tail -10`

Expected: Build succeeds with no errors.

Run: `cd F:\Code\billionaire\Wechatsync && pnpm typecheck 2>&1 | tail -20`

Expected: Type errors only from pre-existing issues (CLI DTS build, etc.), no new errors from changed files.

---

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/adapters/index.ts packages/extension/src/background/sync-service.ts packages/extension/src/mcp/client.ts packages/extension/src/background/index.ts
git commit -m "feat: thread draftOnly through core sync chain

- syncToMultiplePlatforms accepts draftOnly param
- SyncOptions gains draftOnly field
- performSync passes draftOnly to DSL and CMS adapters
- MCP client and SYNC_ARTICLE handler extract and pass draftOnly
- Default draftOnly=true preserves existing behavior"
```

---

### Task 2: CLI `--publish` flag

**Files:**
- Modify: `packages/cli/src/index.ts`

**Interfaces:**
- Consumes: `bridge.request('syncArticle', params)` where params now includes `draftOnly`
- Produces: `--publish` flag on `sync` command

---

- [ ] **Step 1: Add `--publish` flag to `sync` command**

File: `packages/cli/src/index.ts`

At the `sync` command option definitions (near `--dry-run`), add:

```typescript
  .option('-p, --platforms <platforms>', '目标平台ID，多个用逗号分隔', 'zhihu,juejin')
  .option('-t, --title <title>', '文章标题（覆盖自动提取的标题）')
  .option('--cover <url>', '封面图片URL或本地路径')
  .option('--dry-run', '仅显示将要执行的操作，不实际同步')
  .option('--publish', '直接发布文章（跳过草稿，立即发布到目标平台）')  // NEW
```

- [ ] **Step 2: Extract `publish` flag and pass as `draftOnly`**

Find the `syncArticle` request call (at the `bridge.request` line ≈747). Modify the request params to include `draftOnly`:

```typescript
      const response = await bridge.request<{ results: SyncResult[]; syncId: string }>('syncArticle', {
        platforms,
        article: {
          title,
          markdown: processedMarkdown,
          content: processedHtml,
          cover,
        },
        draftOnly: !options.publish,  // NEW: --publish → draftOnly: false
      })
```

Note: Need to ensure `options.publish` is accessible. The `sync` command handler should destructure it from the parsed options along with `dryRun` etc.

---

- [ ] **Step 3: Update result display for publish mode**

At the result display code (near line 769), update to show publish status:

```typescript
          console.log(
            result.success
              ? `  ${chalk.green('✓')} ${result.platform} ${result.draftOnly ? chalk.gray('(草稿)') : chalk.green('(已发布)')}`  // MODIFIED
              : `  ${chalk.red('✗')} ${result.platform} ${chalk.red(result.error || result.message || '')}`
          )
```

---

- [ ] **Step 4: Rebuild CLI and test**

Run: `cd F:\Code\billionaire\Wechatsync && pnpm build:mcp && pnpm build:cli 2>&1 | tail -15`

Expected: CJS build succeeds.

Run: `node packages/cli/dist/index.js sync --help 2>&1`

Expected: `--publish` appears in the help output.

Run (dry-run with --publish):
```
WECHATSYNC_TOKEN="95bfb998-68b3-420c-a07f-61857812c40e" node packages/cli/dist/index.js sync test-article.md -p csdn --dry-run --publish 2>&1
```

Expected: Shows sync info, no errors about `--publish`.

---

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): add --publish flag for direct publishing

- sync command gains --publish option
- Converts to draftOnly: false in bridge request
- Result display distinguishes 已发布 vs 草稿"
```

---

### Task 3: MCP Server `publish` parameter

**Files:**
- Modify: `packages/mcp-server/src/index.ts`

**Interfaces:**
- Consumes: MCP `sync_article` tool schema with new `publish` boolean
- Produces: Translates `publish` → `draftOnly: !publish` in bridge request

---

- [ ] **Step 1: Add `publish` to `sync_article` input schema**

File: `packages/mcp-server/src/index.ts`

In the `ListToolsRequestSchema` handler, find the `sync_article` tool definition. Add the `publish` property:

```typescript
          publish: {
            type: 'boolean',
            description: '直接发布文章（跳过草稿）。默认为 false，即保存为草稿',
          },
```

---

- [ ] **Step 2: Pass `draftOnly` in the tool handler**

Find the `sync_article` case in `CallToolRequestSchema` handler. Add `draftOnly` to the bridge request:

```typescript
        const { platforms, title, markdown, content, cover, publish } = args
        // ...
        const response = await bridge.request<{ results: SyncResult[]; syncId: string }>(
          'syncArticle',
          {
            platforms,
            article: { title, markdown, content, cover },
            draftOnly: !(publish === true),  // NEW: publish → draftOnly: false
          }
        )
```

---

- [ ] **Step 3: Rebuild and verify**

Run: `cd F:\Code\billionaire\Wechatsync && pnpm build:mcp 2>&1 | tail -5`

Expected: Build succeeds.

---

- [ ] **Step 4: Commit**

```bash
git add packages/mcp-server/src/index.ts
git commit -m "feat(mcp): add publish parameter to sync_article tool

- sync_article gains optional publish boolean
- publish: true → draftOnly: false
- Default behavior unchanged (drafts)"
```

---

### Task 4: Extension UI publish toggle

**Files:**
- Modify: `packages/extension/src/components/sync-dialog/SyncDialog.tsx`
- Modify: `packages/extension/src/components/sync-dialog/types.ts` (if exists)
- Check: `packages/extension/src/popup/pages/HomeNew.tsx` (may use SyncDialog)
- Check: `packages/extension/src/editor/EditorApp.tsx` (may use SyncDialog)

**Interfaces:**
- Consumes: `SyncDialog` component props
- Produces: Toggle switch for publish mode, passed to `SYNC_ARTICLE` message

---

- [ ] **Step 1: Read SyncDialog component to understand props and state**

Read: `packages/extension/src/components/sync-dialog/SyncDialog.tsx`
Read: `packages/extension/src/components/sync-dialog/types.ts`

Identify:
- Where the sync action is triggered
- How `SYNC_ARTICLE` message is sent
- Whether props or local state controls the flow

---

- [ ] **Step 2: Add publish toggle state and UI**

In SyncDialog, add a local state for publish mode:

```tsx
const [publishMode, setPublishMode] = useState(false)
```

Add the toggle UI before the sync button. Use the existing UI pattern (check if `Switch` or checkbox components exist, otherwise use a simple checkbox):

```tsx
{/* 发布模式切换 */}
<label className="flex items-center gap-2 cursor-pointer py-2 text-sm text-muted-foreground">
  <input
    type="checkbox"
    checked={publishMode}
    onChange={(e) => setPublishMode(e.target.checked)}
    className="rounded"
  />
  直接发布（跳过草稿，立即发布到各平台）
</label>
```

---

- [ ] **Step 3: Pass `draftOnly` when triggering sync**

Find where `SYNC_ARTICLE` message is sent (or `syncPlatforms` is called). Add `draftOnly: !publishMode`:

For `chrome.runtime.sendMessage` pattern:
```typescript
chrome.runtime.sendMessage({
  type: 'SYNC_ARTICLE',
  payload: {
    article,
    platforms: selectedPlatforms,
    draftOnly: !publishMode,  // NEW
    // ... other existing fields
  },
})
```

For direct function call pattern (if used from popup):
```typescript
// pass draftOnly in the options
```

---

- [ ] **Step 4: Verify the UI component compiles**

Run: `cd F:\Code\billionaire\Wechatsync && pnpm typecheck 2>&1 | grep -i "sync-dialog\|SyncDialog" || echo "No SyncDialog errors"`

Expected: No type errors related to SyncDialog.

---

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/components/sync-dialog/
git commit -m "feat(ui): add publish toggle to SyncDialog

- Checkbox to toggle between draft and publish mode
- Defaults to unchecked (draft mode, existing behavior)
- Passes draftOnly: !publishMode in SYNC_ARTICLE message"
```

---

### Task 5: CSDN adapter — publish support

**Files:**
- Modify: `packages/core/src/adapters/platforms/csdn.ts`

**Interfaces:**
- Consumes: `PublishOptions.draftOnly` from `publish()` call
- Produces: `pubStatus` and `status` vary based on `draftOnly`; published URL format changes

---

- [ ] **Step 1: Modify CSDN save API body for publish mode**

File: `packages/core/src/adapters/platforms/csdn.ts`

At lines 228 and 240, change hardcoded draft values to conditional:

```typescript
            status: options?.draftOnly === false ? 1 : 2,
            // ... other fields unchanged ...
            pubStatus: options?.draftOnly === false ? 'public' : 'draft',
```

---

- [ ] **Step 2: Generate correct URL based on publish mode**

At lines 260-263, make URL conditional:

```typescript
      const postId = res.data.id
      const username = '' // CSDN doesn't expose username in this API response
      const draftUrl = `https://editor.csdn.net/md?articleId=${postId}`
      const publishedUrl = `https://blog.csdn.net/article/details/${postId}`

      return this.createResult(true, {
        postId: postId,
        postUrl: options?.draftOnly === false ? publishedUrl : draftUrl,
        draftOnly: options?.draftOnly ?? true,
        message: options?.draftOnly === false ? '文章已发布' : undefined,
      })
```

---

- [ ] **Step 3: Build and verify**

Run: `cd F:\Code\billionaire\Wechatsync && pnpm build:core 2>&1 | tail -5`

Expected: Build succeeds.

---

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/adapters/platforms/csdn.ts
git commit -m "feat(csdn): support direct publish via pubStatus switch

- draftOnly=false → pubStatus: 'public', status: 1
- draftOnly=true → pubStatus: 'draft', status: 2 (unchanged)
- Published URL uses blog.csdn.net/article/details/{id}"
```

---

### Task 6: Juejin adapter — publish support

**Files:**
- Modify: `packages/core/src/adapters/platforms/juejin.ts`

**Interfaces:**
- Consumes: `PublishOptions.draftOnly` from `publish()` call
- Produces: Additional `article_draft/publish` API call when `draftOnly: false`

---

- [ ] **Step 1: Add publish API call after draft creation**

File: `packages/core/src/adapters/platforms/juejin.ts`

After the draft creation succeeds (around line 273 where `draftId` is obtained), add the publish logic before the return statement. Replace the return block (around lines 278-285):

```typescript
      const draftId = createData.data.id
      logger.debug('Draft created:', draftId)

      const shouldPublish = options?.draftOnly === false

      if (shouldPublish) {
        try {
          const publishResponse = await this.runtime.fetch(
            'https://api.juejin.cn/content_api/v1/article_draft/publish',
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

          const publishText = await publishResponse.text()
          logger.debug('Publish response:', publishResponse.status, publishText.substring(0, 300))

          if (!publishResponse.ok) {
            throw new Error(`发布失败: ${publishResponse.status}`)
          }

          let publishData: { err_no?: number; err_msg?: string }
          try {
            publishData = JSON.parse(publishText)
          } catch {
            throw new Error(`发布失败: 响应不是有效 JSON`)
          }

          if (publishData.err_no && publishData.err_no !== 0) {
            throw new Error(publishData.err_msg || `发布失败: 错误码 ${publishData.err_no}`)
          }

          const publishedUrl = `https://juejin.cn/post/${draftId}`

          return this.createResult(true, {
            postId: draftId,
            postUrl: publishedUrl,
            draftOnly: false,
            message: '文章已发布',
          })
        } catch (publishError) {
          logger.warn('Juejin publish failed, fallback to draft:', publishError)
          // 降级：返回草稿链接
        }
      }

      const draftUrl = `https://juejin.cn/editor/drafts/${draftId}`

      return this.createResult(true, {
        postId: draftId,
        postUrl: draftUrl,
        draftOnly: true,
      })
```

---

- [ ] **Step 2: Build and verify**

Run: `cd F:\Code\billionaire\Wechatsync && pnpm build:core 2>&1 | tail -5`

Expected: Build succeeds.

---

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/adapters/platforms/juejin.ts
git commit -m "feat(juejin): support direct publish via article_draft/publish API

- draftOnly=false → calls article_draft/publish after draft creation
- Publish failure falls back to draft (content never lost)
- Published URL uses juejin.cn/post/{id}"
```

---

### Task 7: Zhihu adapter — publish support

**Files:**
- Modify: `packages/core/src/adapters/platforms/zhihu.ts`

**Interfaces:**
- Consumes: `PublishOptions.draftOnly` from `publish()` call
- Produces: Additional `PUT /api/articles/{draftId}/publish` API call when `draftOnly: false`

---

- [ ] **Step 1: Add publish API call after draft update**

File: `packages/core/src/adapters/platforms/zhihu.ts`

After the draft update succeeds (around line 177, where `logger.debug('Draft updated')`), add the publish logic before the return statement. Replace lines 177-185:

```typescript
      logger.debug('Draft updated, status:', updateResponse.status)

      const shouldPublish = options?.draftOnly === false

      if (shouldPublish) {
        try {
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

            return this.createResult(true, {
              postId: draftId,
              postUrl: publishedUrl,
              draftOnly: false,
              message: '文章已发布',
            })
          }
          logger.warn('Zhihu publish failed, status:', publishResponse.status)
          // 降级：返回草稿链接
        } catch (publishError) {
          logger.warn('Zhihu publish failed, fallback to draft:', publishError)
          // 降级：返回草稿链接
        }
      }

      const draftUrl = `https://zhuanlan.zhihu.com/p/${draftId}/edit`

      return this.createResult(true, {
        postId: draftId,
        postUrl: draftUrl,
        draftOnly: (!shouldPublish),
      })
```

---

- [ ] **Step 2: Build and verify**

Run: `cd F:\Code\billionaire\Wechatsync && pnpm build:core 2>&1 | tail -5`

Expected: Build succeeds.

---

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/adapters/platforms/zhihu.ts
git commit -m "feat(zhihu): support direct publish via PUT /articles/{id}/publish

- draftOnly=false → calls PUT publish API after draft content update
- Publish failure falls back to draft (content never lost)
- Published URL uses zhuanlan.zhihu.com/p/{id}"
```

---

### Task 8: End-to-end integration test

**Files:**
- Create: `test-article-publish.md` (temporary test file, deleted after use)

**Purpose:** Verify the full chain works — CLI `--publish` → bridge → extension → adapter → published article.

---

- [ ] **Step 1: Rebuild all packages**

Run:
```bash
cd F:\Code\billionaire\Wechatsync && pnpm build:core && pnpm build:mcp && pnpm build:cli 2>&1 | tail -10
```

Expected: All three packages build successfully.

---

- [ ] **Step 2: Create test article**

```bash
cat > test-article-publish.md << 'EOF'
---
title: WechatSync 自动发布测试
---

## 自动发布测试

本文由 WechatSync CLI `--publish` 模式自动生成。

验证一键发布功能：跳过草稿，直接发布到目标平台。
EOF
```

---

- [ ] **Step 3: Dry-run first to confirm parsing**

```bash
WECHATSYNC_TOKEN="95bfb998-68b3-420c-a07f-61857812c40e" node packages/cli/dist/index.js sync test-article-publish.md -p csdn --dry-run --publish 2>&1
```

Expected: Shows "(dry-run 模式，不实际同步)" and content preview.

---

- [ ] **Step 4: Actual publish to CSDN (single platform test)**

```bash
WECHATSYNC_TOKEN="95bfb998-68b3-420c-a07f-61857812c40e" node packages/cli/dist/index.js sync test-article-publish.md -p csdn --publish 2>&1
```

Expected: Shows `✓ csdn (已发布)` with a `blog.csdn.net/article/details/` URL (not `editor.csdn.net/md`).

---

- [ ] **Step 5: Test fallback — publish to all platforms**

```bash
WECHATSYNC_TOKEN="95bfb998-68b3-420c-a07f-61857812c40e" node packages/cli/dist/index.js sync test-article-publish.md -p "csdn,juejin,zhihu,weibo,bilibili,baijiahao,51cto,segmentfault,weixin" --publish 2>&1
```

Expected:
- CSDN → `(已发布)` or `(草稿)` depending on API success
- Juejin → `(已发布)` or `(草稿)` depending on API success
- Zhihu → `(已发布)` or `(草稿)` depending on API success
- Other platforms → `(草稿)` — normal draft behavior (not yet implemented)
- ALL platforms succeed (no failures — even if publish fails, it falls back to draft)

---

- [ ] **Step 6: Clean up**

```bash
rm test-article-publish.md
```

---

- [ ] **Step 7: Commit (if any fixes were needed)**

```bash
git add -A
git commit -m "chore: integration test fixes for auto-publish feature"
```

---

### Implementation Order

```
Task 1 (core chain) → Task 2 (CLI) → Task 3 (MCP) → Task 4 (UI)
                                                    ↓
                              Task 5 (CSDN) → Task 6 (Juejin) → Task 7 (Zhihu)
                                                                          ↓
                                                                  Task 8 (E2E test)
```

Tasks 2, 3, 4 can be done in parallel after Task 1. Tasks 5, 6, 7 can be done in parallel after Task 1.
