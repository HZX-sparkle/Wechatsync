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

      // Wait for the publish-popup dialog to appear
      const popup = page.locator('.publish-popup.active')
      await popup.waitFor({ state: 'visible', timeout: 10000 })
      await page.waitForTimeout(500)

      // Step 1: Category — mouse click "后端" (usually pre-selected; click to trigger Vue model)
      const catBox = await page.locator('.category-list .item').first().boundingBox()
      if (catBox) {
        await page.mouse.click(catBox.x + catBox.width / 2, catBox.y + catBox.height / 2)
        await page.waitForTimeout(300)
      }

      // Step 2: Tags — mouse click to open dropdown, click option with force
      const tagWrapBox = await page.locator('.byte-select__content-wrap').first().boundingBox()
      if (tagWrapBox) {
        await page.mouse.click(tagWrapBox.x + tagWrapBox.width / 2, tagWrapBox.y + tagWrapBox.height / 2)
        await page.waitForTimeout(2500)
        const opt = page.locator('.byte-select-option, .tag-option').first()
        if (await opt.count() > 0) {
          await opt.click({ force: true })
          await page.waitForTimeout(500)
        }
      }

      // Step 3: Summary — click then type
      await page.locator('.byte-input__textarea, textarea').first().click()
      await page.waitForTimeout(200)
      await page.locator('.byte-input__textarea, textarea').first().fill(
        'WechatSync 是一款开源的多平台内容同步工具，支持一键将文章分发到掘金、CSDN、知乎等平台，极大提升自媒体运营效率。'
      )
      await page.waitForTimeout(500)

      // Step 4: Wait for "确定并发布" enabled, then click
      try {
        await page.waitForFunction(() => {
          const btns = Array.from(document.querySelectorAll('button'))
          const btn = btns.find(b => b.textContent?.includes('确定并发布'))
          return btn && !(btn as HTMLButtonElement).disabled
        }, { timeout: 15000 })
      } catch { /* button stayed disabled */ }
      await page.locator('button').filter({ hasText: /确定并发布/ }).click({ force: true })
      // Wait for redirect to published post page
      try {
        await page.waitForURL((url: any) => url.toString().includes('/post/'), { timeout: 15000 })
      } catch { /* no redirect */ }
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
