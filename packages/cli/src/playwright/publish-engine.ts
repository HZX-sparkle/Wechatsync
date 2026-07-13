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
