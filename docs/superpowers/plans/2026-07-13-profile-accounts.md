# 持久化Profile + 账号管理 + 一键发布 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent Playwright profile-based account management and one-click auto-publish to WechatSync CLI, ported from MultiPost publish-agent.

**Architecture:** Five new modules in `packages/cli/src/playwright/` — account-manager (JSON CRUD), profile-manager (Chromium dirs), platform-config (publish configs), anti-detect (stealth scripts), publish-engine (orchestration). Three new CLI commands — `login`, `accounts`, `logout`. Existing `sync --publish` updated to use multi-account publishing.

**Tech Stack:** TypeScript, Playwright, Node.js fs/path, Commander (existing CLI framework)

## Global Constraints

- `accounts.json` stored at `~/.wechatsync/accounts.json`
- Profiles stored at `~/.wechatsync/playwright-profiles/{accountId}/`
- Account ID format: `{platformKey}_{8位随机码}`
- Each platform has separate profile directory per account
- Cookie management done by Chromium — no manual cookie code
- Playwright launches in `headless: false` for login (user needs to interact), `headless: true` for publishing (automated)
- All existing CLI commands (`sync`, `platforms`, `auth`, `extract`) unchanged
- `sync` without `--publish` remains draft-only

---

### Task 1: account-manager.ts — accounts.json CRUD

**Files:**
- Create: `packages/cli/src/playwright/account-manager.ts`

**Interfaces:**
- Produces:
  - `StoredAccount { id: string; name: string; username?: string; addedAt: string }`
  - `loadAccounts(): Record<string, StoredAccount[]>`
  - `saveAccounts(data: Record<string, StoredAccount[]>): void`
  - `getAccount(id: string): StoredAccount | null`
  - `getAccountsForPlatform(platformKey: string): StoredAccount[]`
  - `addAccount(platformKey: string, name: string, username?: string): StoredAccount`
  - `removeAccount(id: string): void`

---

- [ ] **Step 1: Create account-manager.ts with all CRUD functions**

File: `packages/cli/src/playwright/account-manager.ts`

```typescript
/**
 * Account storage manager
 * Reads/writes ~/.wechatsync/accounts.json
 */
import fs from 'fs'
import path from 'path'
import os from 'os'

export interface StoredAccount {
  id: string          // e.g., "juejin_abc123de"
  name: string        // user-given nickname
  username?: string   // extracted from platform
  addedAt: string     // ISO timestamp
}

const DATA_DIR = path.join(os.homedir(), '.wechatsync')
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json')

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

export function loadAccounts(): Record<string, StoredAccount[]> {
  ensureDataDir()
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'))
    }
  } catch { /* file missing or corrupted, return empty */ }
  return {}
}

export function saveAccounts(data: Record<string, StoredAccount[]>): void {
  ensureDataDir()
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

export function getAccount(id: string): StoredAccount | null {
  const accounts = loadAccounts()
  for (const platformAccounts of Object.values(accounts)) {
    const found = platformAccounts.find(a => a.id === id)
    if (found) return found
  }
  return null
}

export function getAccountsForPlatform(platformKey: string): StoredAccount[] {
  const accounts = loadAccounts()
  return accounts[platformKey] || []
}

export function addAccount(platformKey: string, name: string, username?: string): StoredAccount {
  const accounts = loadAccounts()
  const id = `${platformKey}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const account: StoredAccount = {
    id,
    name,
    username,
    addedAt: new Date().toISOString(),
  }
  if (!accounts[platformKey]) {
    accounts[platformKey] = []
  }
  accounts[platformKey].push(account)
  saveAccounts(accounts)
  return account
}

export function removeAccount(id: string): boolean {
  const accounts = loadAccounts()
  for (const [platformKey, platformAccounts] of Object.entries(accounts)) {
    const idx = platformAccounts.findIndex(a => a.id === id)
    if (idx >= 0) {
      platformAccounts.splice(idx, 1)
      if (platformAccounts.length === 0) {
        delete accounts[platformKey]
      }
      saveAccounts(accounts)
      return true
    }
  }
  return false
}
```

---

- [ ] **Step 2: Verify by running a quick smoke test**

Run:
```bash
cd F:\Code\billionaire\Wechatsync && node -e "
  const { addAccount, getAccount, loadAccounts, removeAccount } = require('./packages/cli/src/playwright/account-manager.ts');
" 2>&1 || echo "ESM not directly require-able — this is expected"
```

Since this is TypeScript with ESM imports, direct Node execution won't work. Instead, verify no syntax errors by checking with tsc:

Run:
```bash
cd F:\Code\billionaire\Wechatsync && npx tsc --noEmit packages/cli/src/playwright/account-manager.ts 2>&1
```

Expected: No errors related to our file (pre-existing tsconfig issues OK).

---

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/playwright/account-manager.ts
git commit -m "feat(cli): add account-manager for accounts.json CRUD

- StoredAccount interface with id, name, username, addedAt
- loadAccounts / saveAccounts for persistence
- addAccount / removeAccount / getAccount for queries
- getAccountsForPlatform for per-platform listing
- Data stored at ~/.wechatsync/accounts.json"
```

---

### Task 2: profile-manager.ts — profile directory management

**Files:**
- Create: `packages/cli/src/playwright/profile-manager.ts`

**Interfaces:**
- Consumes: `StoredAccount` from `account-manager.ts`
- Produces:
  - `getProfileDir(accountId: string): string`
  - `profileExists(accountId: string): boolean`
  - `removeProfile(accountId: string): void`
  - `launchProfile(accountId: string, headless?: boolean): Promise<import('playwright').BrowserContext>`

---

- [ ] **Step 1: Create profile-manager.ts**

File: `packages/cli/src/playwright/profile-manager.ts`

```typescript
/**
 * Playwright profile manager
 * Manages persistent Chromium user data directories for each account
 */
import { chromium, type BrowserContext } from 'playwright'
import fs from 'fs'
import path from 'path'
import os from 'os'

const PROFILES_DIR = path.join(os.homedir(), '.wechatsync', 'playwright-profiles')

export function getProfileDir(accountId: string): string {
  return path.join(PROFILES_DIR, accountId)
}

export function profileExists(accountId: string): boolean {
  return fs.existsSync(getProfileDir(accountId))
}

export function removeProfile(accountId: string): void {
  const dir = getProfileDir(accountId)
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

export function ensureProfileDir(accountId: string): string {
  const dir = getProfileDir(accountId)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

export async function launchProfile(
  accountId: string,
  headless = false
): Promise<BrowserContext> {
  const userDataDir = ensureProfileDir(accountId)
  return chromium.launchPersistentContext(userDataDir, {
    headless,
    viewport: { width: 1280, height: 800 },
    args: [
      '--disable-blink-features=AutomationControlled',
      ...(headless ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    ],
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    bypassCSP: true,
  })
}
```

---

- [ ] **Step 2: Verify syntax**

Run:
```bash
cd F:\Code\billionaire\Wechatsync && npx tsc --noEmit packages/cli/src/playwright/profile-manager.ts 2>&1
```

Expected: Only pre-existing tsconfig issues, no errors in our file.

---

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/playwright/profile-manager.ts
git commit -m "feat(cli): add profile-manager for Playwright persistent contexts

- getProfileDir / profileExists / removeProfile / ensureProfileDir
- launchProfile creates persistent Chromium context
- Profiles stored at ~/.wechatsync/playwright-profiles/{accountId}"
```

---

### Task 3: platform-config.ts — platform publish configurations

**Files:**
- Create: `packages/cli/src/playwright/platform-config.ts`

**Interfaces:**
- Produces:
  - `PlatformPublishConfig { name, loginUrl, editorUrl, postLoginUrl?, doPublish, checkUsername? }`
  - `getPlatformConfig(platformKey: string): PlatformPublishConfig | null`
  - `getSupportedPublishPlatforms(): string[]`

---

- [ ] **Step 1: Create platform-config.ts with CSDN and Juejin**

File: `packages/cli/src/playwright/platform-config.ts`

```typescript
/**
 * Platform publish configurations
 * Based on MultiPost publish-agent's platforms.json + lib/*-dynamic.js
 */
import type { Page } from 'playwright'

export interface PlatformPublishConfig {
  /** Display name */
  name: string
  /** Login page URL */
  loginUrl: string
  /** Editor URL template — {id} is the article/draft ID */
  editorUrl: (articleId: string) => string
  /** Post-login landing page (for login verification) */
  postLoginUrl?: string
  /** Execute the publish flow on the loaded editor page */
  doPublish: (page: Page) => Promise<void>
  /** Extract username from the page after login */
  checkUsername?: (page: Page) => Promise<string | null>
}

const PLATFORMS: Record<string, PlatformPublishConfig> = {
  juejin: {
    name: '掘金',
    loginUrl: 'https://juejin.cn/login',
    postLoginUrl: 'https://juejin.cn',
    editorUrl: (id: string) => `https://juejin.cn/editor/drafts/${id}`,
    async doPublish(page: Page) {
      // Wait for publish button to appear and be enabled
      await page.waitForFunction(() => {
        const btns = Array.from(document.querySelectorAll('button'))
        const btn = btns.find(b => {
          const t = (b as HTMLButtonElement).textContent || ''
          return (t.includes('发布') || t.includes('發表')) &&
                 !t.includes('草稿') &&
                 !(b as HTMLButtonElement).disabled
        })
        return !!btn
      }, { timeout: 20000 })

      const btn = page.locator('button').filter({ hasText: /发布|發佈/ }).first()
      await btn.waitFor({ state: 'visible', timeout: 5000 })
      await page.waitForTimeout(500)
      await btn.click()
      await page.waitForTimeout(5000)
    },
    async checkUsername(page: Page) {
      try {
        const resp = await page.evaluate(async () => {
          const res = await fetch('https://api.juejin.cn/user_api/v1/user/get', { credentials: 'include' })
          const data = await res.json()
          return data?.data?.user_name || null
        })
        return resp || null
      } catch { return null }
    },
  },

  csdn: {
    name: 'CSDN',
    loginUrl: 'https://passport.csdn.net/login',
    postLoginUrl: 'https://www.csdn.net',
    editorUrl: (id: string) => `https://mp.csdn.net/mp_blog/creation/editor/${id}`,
    async doPublish(page: Page) {
      // Click "定时发布" button
      const btn1 = page.locator('button').filter({ hasText: '定时发布' })
      await btn1.waitFor({ state: 'visible', timeout: 20000 })
      await btn1.click()
      await page.waitForTimeout(1500)

      // Click "发布博客" in the confirmation dialog
      const btn2 = page.locator('button').filter({ hasText: '发布博客' })
      await btn2.waitFor({ state: 'visible', timeout: 10000 })
      await page.waitForTimeout(500)
      // Use force:true to bypass date picker overlay interception
      await btn2.click({ force: true })
      await page.waitForTimeout(5000)
    },
    async checkUsername(page: Page) {
      try {
        return await page.evaluate(() => {
          const el = document.querySelector('.user-name, .userinfo-name, .nickname')
          return el?.textContent?.trim() || null
        })
      } catch { return null }
    },
  },
}

export function getPlatformConfig(platformKey: string): PlatformPublishConfig | null {
  return PLATFORMS[platformKey] || null
}

export function getSupportedPublishPlatforms(): string[] {
  return Object.keys(PLATFORMS)
}
```

---

- [ ] **Step 2: Verify syntax**

Run:
```bash
cd F:\Code\billionaire\Wechatsync && npx tsc --noEmit packages/cli/src/playwright/platform-config.ts 2>&1
```

Expected: Only pre-existing tsconfig issues.

---

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/playwright/platform-config.ts
git commit -m "feat(cli): add platform-config with Juejin and CSDN publish configs

- PlatformPublishConfig interface: loginUrl, editorUrl, doPublish, checkUsername
- Juejin: wait for enabled publish button, click
- CSDN: click '定时发布' then '发布博客' in dialog
- getPlatformConfig / getSupportedPublishPlatforms helpers"
```

---

### Task 4: anti-detect.ts — browser anti-detection scripts

**Files:**
- Create: `packages/cli/src/playwright/anti-detect.ts`

**Interfaces:**
- Produces:
  - `ANTI_DETECT_SCRIPT: string` — script to inject into Playwright pages
  - `injectAntiDetect(page: Page): Promise<void>` — convenience injector

---

- [ ] **Step 1: Create anti-detect.ts**

File: `packages/cli/src/playwright/anti-detect.ts`

```typescript
/**
 * Anti-detection scripts for Playwright browser automation
 * Ported from MultiPost publish-agent (agent.js)
 */
import type { Page } from 'playwright'

export const ANTI_DETECT_SCRIPT = `
  // Hide automation
  Object.defineProperty(navigator, 'webdriver', { get: () => false });

  // Mimic Chrome runtime
  window.chrome = { runtime: {} };

  // Prevent permissions popup
  const origQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters: any) =>
    parameters.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
      : origQuery(parameters);

  // Crack closed Shadow DOM: force all attachShadow to open mode
  const origAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init: ShadowRootInit) {
    return origAttachShadow.call(this, { ...init, mode: 'open' });
  };
`

export async function injectAntiDetect(page: Page): Promise<void> {
  await page.addInitScript(ANTI_DETECT_SCRIPT)
}
```

---

- [ ] **Step 2: Verify syntax**

Run:
```bash
cd F:\Code\billionaire\Wechatsync && npx tsc --noEmit packages/cli/src/playwright/anti-detect.ts 2>&1
```

---

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/playwright/anti-detect.ts
git commit -m "feat(cli): add anti-detect script for Playwright stealth

- Hides navigator.webdriver
- Mocks window.chrome.runtime
- Prevents permissions notifications popup
- Cracks closed Shadow DOM (forces open mode)
- Ported from MultiPost publish-agent"
```

---

### Task 5: publish-engine.ts — rewrite publish-dom.ts

**Files:**
- Create: `packages/cli/src/playwright/publish-engine.ts`
- Delete: `packages/cli/src/playwright/publish-dom.ts`

**Interfaces:**
- Consumes:
  - `getPlatformConfig` from `platform-config.ts`
  - `getAccountsForPlatform` from `account-manager.ts`
  - `launchProfile`, `profileExists` from `profile-manager.ts`
  - `injectAntiDetect` from `anti-detect.ts`
- Produces:
  - `PublishResult { platform: string; accountName?: string; success: boolean; url?: string; error?: string }`
  - `publishArticle(platform: string, articleId: string, accountId?: string): Promise<PublishResult>`
  - `publishToAllAccounts(platform: string, articleId: string): Promise<PublishResult[]>`

---

- [ ] **Step 1: Create publish-engine.ts**

File: `packages/cli/src/playwright/publish-engine.ts`

```typescript
/**
 * Playwright publish engine
 * Handles browser-based auto-publishing for platforms that need DOM interaction
 */
import type { Page } from 'playwright'
import { getPlatformConfig } from './platform-config'
import { getAccountsForPlatform } from './account-manager'
import { launchProfile, profileExists } from './profile-manager'
import { injectAntiDetect } from './anti-detect'

export interface PublishResult {
  platform: string
  accountName?: string
  success: boolean
  url?: string
  error?: string
}

async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url()
  const loginPatterns = ['login', 'signin', 'passport', 'auth']
  return !loginPatterns.some(kw => url.toLowerCase().includes(kw))
}

async function ensureLoggedIn(page: Page, platform: string, config: any): Promise<boolean> {
  if (await isLoggedIn(page)) return true

  console.log(`  ⚠️  ${platform} 未登录，正在跳转到登录页...`)
  await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
  console.log(`  请在浏览器窗口中登录（2分钟超时）`)

  try {
    await page.waitForURL(
      (url: any) => {
        const u = url.toString().toLowerCase()
        return !['login', 'signin', 'passport', 'auth'].some(kw => u.includes(kw))
      },
      { timeout: 120000 }
    )
    await page.waitForTimeout(3000)
    console.log(`  ✓ 已登录`)
    return true
  } catch {
    console.error(`  ❌ 登录超时`)
    return false
  }
}

export async function publishArticle(
  platform: string,
  articleId: string,
  accountId?: string
): Promise<PublishResult> {
  const config = getPlatformConfig(platform)
  if (!config) {
    return { platform, success: false, error: `不支持 Playwright 发布的平台: ${platform}` }
  }

  const context = accountId && profileExists(accountId)
    ? await launchProfile(accountId)
    : await launchProfile(platform + '_default')

  const page = context.pages()[0] || await context.newPage()

  try {
    const editorUrl = config.editorUrl(articleId)
    console.log(`  [Playwright] ${config.name}: ${editorUrl}`)

    await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(5000)

    if (!(await ensureLoggedIn(page, platform, config))) {
      await context.close()
      return { platform, success: false, error: '登录失败' }
    }

    // If redirected during login, re-navigate to editor
    if (!page.url().includes('editor') && !page.url().includes('creation')) {
      await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(5000)
    }

    console.log(`  [Playwright] 点击发布...`)
    await config.doPublish(page)

    await page.waitForTimeout(2000)
    await context.close()
    return { platform, success: true }
  } catch (error) {
    console.error(`  ❌ ${config.name} 发布出错:`, error)
    await context.close()
    return { platform, success: false, error: (error as Error).message }
  }
}

export async function publishToAllAccounts(
  platform: string,
  articleId: string
): Promise<PublishResult[]> {
  const accounts = getAccountsForPlatform(platform)
  if (accounts.length === 0) {
    // No saved accounts — try single publish without specific account
    const result = await publishArticle(platform, articleId)
    return [result]
  }

  const results: PublishResult[] = []
  for (const account of accounts) {
    console.log(`  [自动发布] ${platform} → ${account.name}`)
    const result = await publishArticle(platform, articleId, account.id)
    result.accountName = account.name
    results.push(result)
  }
  return results
}
```

---

- [ ] **Step 2: Remove old publish-dom.ts**

```bash
rm packages/cli/src/playwright/publish-dom.ts
```

---

- [ ] **Step 3: Verify build**

Run:
```bash
cd F:\Code\billionaire\Wechatsync && pnpm build:cli 2>&1 | tail -5
```

Expected: CJS build succeeds.

---

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/playwright/publish-engine.ts
git rm packages/cli/src/playwright/publish-dom.ts
git commit -m "feat(cli): rewrite publish-dom as publish-engine with multi-account support

- publishArticle: single-account publish with optional accountId
- publishToAllAccounts: iterate all accounts for a platform
- Replaces old publish-dom.ts
- Uses platform-config, account-manager, profile-manager, anti-detect"
```

---

### Task 6: index.ts — add login/accounts/logout commands + update sync flow

**Files:**
- Modify: `packages/cli/src/index.ts`

**Interfaces:**
- Consumes: All modules from Tasks 1-5
- Produces: Three new CLI commands, updated sync --publish flow

---

- [ ] **Step 1: Add imports**

In `packages/cli/src/index.ts`, after existing imports (around line 20), add:

```typescript
import {
  addAccount, removeAccount,
  loadAccounts, getAccountsForPlatform,
} from './playwright/account-manager'
import { profileExists, removeProfile } from './playwright/profile-manager'
import { getPlatformConfig, getSupportedPublishPlatforms } from './playwright/platform-config'
import { publishToAllAccounts } from './playwright/publish-engine'
```

---

- [ ] **Step 2: Add `login` command**

Add before the existing `sync` command:

```typescript
// ============ login 命令 ============

program
  .command('login <platform>')
  .description('登录平台账号（打开浏览器，手动登录后保存 Profile）')
  .option('--name <name>', '账号昵称')
  .action(async (platform: string, options: { name?: string }) => {
    const config = getPlatformConfig(platform)
    if (!config) {
      console.error(chalk.red(`不支持的平台: ${platform}`))
      console.log(`支持的平台: ${getSupportedPublishPlatforms().join(', ')}`)
      process.exit(1)
    }

    console.log(chalk.bold(`\n登录 ${config.name} (${platform})`))
    console.log('即将打开浏览器窗口，请在浏览器中完成登录...\n')

    // Generate account ID and create profile
    const account = addAccount(platform, options.name || platform, undefined)
    const { launchProfile } = require('./playwright/profile-manager')
    const { injectAntiDetect } = require('./playwright/anti-detect')

    const context = await launchProfile(account.id, false)
    const page = context.pages()[0] || await context.newPage()

    try {
      await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      console.log(chalk.gray('  等待登录完成（5分钟超时，完成后请关闭浏览器窗口）...'))

      // Wait for login
      try {
        await page.waitForURL(
          (url: any) => {
            const u = url.toString().toLowerCase()
            return !['login', 'signin', 'passport', 'auth'].some(kw => u.includes(kw))
          },
          { timeout: 300000 }
        )
        await page.waitForTimeout(3000)
      } catch {
        console.error(chalk.red('  登录超时'))
        removeAccount(account.id)
        removeProfile(account.id)
        await context.close()
        process.exit(1)
      }

      // Extract username
      let username: string | undefined
      if (config.checkUsername) {
        try {
          username = await config.checkUsername(page) || undefined
        } catch { /* ignore */ }
      }

      // Update account with username
      if (username) {
        const accounts = loadAccounts()
        const acc = accounts[platform]?.find(a => a.id === account.id)
        if (acc) { acc.username = username; saveAccounts(accounts) }
      }

      // Prompt for nickname
      const readline = (await import('readline')).default
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      const nickname = await new Promise<string>(resolve => {
        const defaultName = options.name || username || platform
        rl.question(`账号昵称 (默认: ${defaultName}): `, (answer: string) => {
          rl.close()
          resolve(answer.trim() || defaultName)
        })
      })

      // Update name
      const accounts2 = loadAccounts()
      const acc2 = accounts2[platform]?.find(a => a.id === account.id)
      if (acc2) { acc2.name = nickname; saveAccounts(accounts2) }

      await context.close()

      console.log(chalk.green(`\n✓ 登录成功！`))
      console.log(`  账号: ${chalk.cyan(nickname)} ${username ? chalk.gray(`(${username})`) : ''}`)
      console.log(`  ID: ${chalk.gray(account.id)}`)
    } catch (error) {
      console.error(chalk.red('登录失败:'), (error as Error).message)
      removeAccount(account.id)
      removeProfile(account.id)
      await context.close()
      process.exit(1)
    }
  })
```

---

- [ ] **Step 3: Add `accounts` command**

```typescript
// ============ accounts 命令 ============

program
  .command('accounts')
  .description('列出所有已登录账号')
  .action(() => {
    const accounts = loadAccounts()
    const platforms = Object.keys(accounts)

    if (platforms.length === 0) {
      console.log(chalk.gray('暂无已登录账号'))
      console.log(`使用 ${chalk.cyan('wechatsync login <platform>')} 登录新账号`)
      return
    }

    for (const platformKey of platforms) {
      const config = getPlatformConfig(platformKey)
      const platformName = config?.name || platformKey
      console.log(chalk.bold(`\n${platformName}:`))

      for (const account of accounts[platformKey]) {
        const exists = profileExists(account.id)
        const status = exists ? chalk.green('✅') : chalk.yellow('⚠️')
        const info = account.username ? chalk.gray(`(${account.username})`) : ''
        console.log(`  ${status} ${chalk.cyan(account.name)} ${info}  ${chalk.gray(account.id)}`)
        if (!exists) {
          console.log(chalk.yellow(`      Profile 不存在，请重新登录: wechatsync login ${platformKey}`))
        }
      }
    }
    console.log()
  })
```

---

- [ ] **Step 4: Add `logout` command**

```typescript
// ============ logout 命令 ============

program
  .command('logout <id>')
  .description('删除账号及其 Profile')
  .action(async (id: string) => {
    const account = getAccount(id)
    if (!account) {
      console.error(chalk.red(`账号不存在: ${id}`))
      process.exit(1)
    }

    const readline = (await import('readline')).default
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const confirm = await new Promise<string>(resolve => {
      rl.question(
        chalk.yellow(`确认删除账号 "${account.name}" (${account.id})？(y/N) `),
        (answer: string) => { rl.close(); resolve(answer.trim().toLowerCase()) }
      )
    })

    if (confirm !== 'y' && confirm !== 'yes') {
      console.log('已取消')
      process.exit(0)
    }

    removeAccount(id)
    removeProfile(id)
    console.log(chalk.green(`✓ 已删除账号 "${account.name}"`))
  })
```

---

- [ ] **Step 5: Update sync --publish to use publishToAllAccounts**

In the sync command's post-processing (around line 762), replace the existing Playwright code block:

```typescript
// Replace the old Playwright publish block with:
if (options.publish) {
  for (const result of results) {
    if (result.success && result.postId) {
      const config = getPlatformConfig(result.platform)
      if (config) {
        const accounts = getAccountsForPlatform(result.platform)
        if (accounts.length > 0) {
          console.log(chalk.bold(`\n  [自动发布] ${config.name} (${accounts.length} 个账号):`))
          const pubResults = await publishToAllAccounts(result.platform, result.postId)
          for (const pr of pubResults) {
            if (pr.success) {
              result.draftOnly = false
              if (pr.accountName) {
                console.log(`    ${chalk.green('✓')} ${pr.accountName} ${chalk.green('已发布')}`)
              }
            } else {
              console.log(`    ${chalk.red('✗')} ${pr.accountName || result.platform} ${chalk.red(pr.error || '发布失败')}`)
            }
          }
          // Update result for display
          if (pubResults.some(p => p.success)) {
            result.draftOnly = false
            result.message = `${pubResults.filter(p => p.success).length}/${accounts.length} 个账号已发布`
          }
        } else {
          // No accounts saved — single publish without account
          const pr = await publishArticle(result.platform, result.postId)
          if (pr.success) {
            result.draftOnly = false
            result.message = '已发布'
          }
        }
      }
    }
  }
}
```

Note: Also need to import `publishArticle` from publish-engine for the no-account fallback.

---

- [ ] **Step 6: Build and verify**

Run:
```bash
cd F:\Code\billionaire\Wechatsync && pnpm build:mcp 2>&1 | tail -3
cd F:\Code\billionaire\Wechatsync && pnpm build:cli 2>&1 | tail -5
```

Expected: CJS build succeeds.

Run:
```bash
node packages/cli/dist/index.js --help
```

Expected: `login`, `accounts`, `logout` appear in the command list.

Run:
```bash
node packages/cli/dist/index.js accounts
```

Expected: Shows "暂无已登录账号" or lists existing accounts.

---

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): add login, accounts, logout commands + multi-account publish

- login <platform>: Playwright browser login, saves profile + account
- accounts: list all platforms and their accounts with profile status
- logout <id>: remove account and profile with confirmation
- sync --publish: uses publishToAllAccounts for multi-account publishing"
```

---

### Task 7: End-to-end integration test

**Files:**
- (None — tests via CLI)

---

- [ ] **Step 1: Rebuild all packages**

Run:
```bash
cd F:\Code\billionaire\Wechatsync && pnpm build:core 2>&1 | tail -3
pnpm build:mcp 2>&1 | tail -3
pnpm build:cli 2>&1 | tail -3
```

Expected: All build successfully.

---

- [ ] **Step 2: Test accounts command (no accounts yet)**

```bash
node packages/cli/dist/index.js accounts
```

Expected: "暂无已登录账号" or shows accounts if any exist from previous tests.

---

- [ ] **Step 3: Test list of supported platforms**

```bash
node -e "
  const { getSupportedPublishPlatforms, getPlatformConfig } = require('./packages/cli/src/playwright/platform-config.ts') || {}
" 2>&1 || node -e "
  import('./packages/cli/dist/index.js').catch(() => {})
" 2>&1

# Simpler: check the config in the dist
node -e "
  const { getSupportedPublishPlatforms } = require('/f/Code/billionaire/Wechatsync/packages/cli/dist/index.js') || {}
  '' && console.log('juejin,csdn in publish config')
"
```

Alternative: just check the built CLI for juejin/csdn support:
```bash
node packages/cli/dist/index.js sync --help 2>&1 | head -5
```

---

- [ ] **Step 4: Test publish with --publish flag (ensure extension connected)**

First ensure the extension is loaded and dev server is running.

Run dry-run to verify parsing:
```bash
echo "n" | WECHATSYNC_TOKEN="95bfb998-68b3-420c-a07f-61857812c40e" \
  node packages/cli/dist/index.js sync debug-publish.md -p juejin --dry-run --publish 2>&1
```

Expected: Shows "(dry-run 模式，不实际同步)".

---

- [ ] **Step 5: Full publish test to juejin with accounts**

First, create test accounts if needed:
```bash
# List existing accounts
node packages/cli/dist/index.js accounts
```

Then test publish:
```bash
echo "n" | WECHATSYNC_TOKEN="95bfb998-68b3-420c-a07f-61857812c40e" \
  node packages/cli/dist/index.js sync debug-publish.md -p juejin --publish 2>&1
```

Expected:
- Shows `[自动发布] 掘金 (N 个账号)`
- Playwright opens for each account
- Shows success/failure per account

---

- [ ] **Step 6: Cleanup test file and commit any fixes**

```bash
rm -f debug-publish.md
git add -A
git commit -m "chore: e2e test fixes for profile-accounts feature"
```

---

### Implementation Order

```
Task 1 (account-manager)
  → Task 2 (profile-manager)
    → Task 3 (platform-config)
      → Task 4 (anti-detect)
        → Task 5 (publish-engine)
          → Task 6 (CLI commands)
            → Task 7 (E2E test)
```

Tasks 1-4 can run in parallel (all independent). Tasks 5 depends on 1-4. Task 6 depends on 5. Task 7 depends on all.
