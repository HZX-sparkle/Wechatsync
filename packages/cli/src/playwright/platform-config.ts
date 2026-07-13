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
      // Step 1: Add article tags (required before publishing)
      try {
        const tagBtn = page.getByRole('button', { name: '添加文章标签' })
        await tagBtn.waitFor({ state: 'visible', timeout: 10000 })
        await tagBtn.click()
        await page.waitForTimeout(500)

        // Type a tag in the search input
        const tagInput = page.locator('input[placeholder*="请输入文字搜索"]')
        await tagInput.waitFor({ state: 'visible', timeout: 5000 })
        await tagInput.fill('技术分享')
        await page.waitForTimeout(2000)
        await page.keyboard.press('Enter')
        await page.waitForTimeout(1000)
      } catch {
        // Tag might already be set, continue
      }

      // Step 2: Click "发布博客" button
      const btn = page.locator('button').filter({ hasText: '发布博客' })
      await btn.waitFor({ state: 'visible', timeout: 20000 })
      await page.waitForTimeout(500)
      await btn.click()
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
