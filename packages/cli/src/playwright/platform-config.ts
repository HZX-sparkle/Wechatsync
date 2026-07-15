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

      // Step 1: Category — click an item in the category-list (not a dropdown)
      await page.evaluate(() => {
        const items = document.querySelectorAll('.category-list .item')
        // Check if one is already active
        const active = document.querySelector('.category-list .item.active')
        if (!active && items.length > 0) {
          // Click the first non-active item
          (items[0] as HTMLElement).click()
        }
      })
      await page.waitForTimeout(500)

      // Step 2: Tags — click the tag select to open dropdown, then pick an option
      await page.evaluate(() => {
        // Find and click the tag select trigger
        const popup = document.querySelector('.publish-popup.active') || document
        const selects = popup.querySelectorAll('.byte-select__input, .byte-select__trigger')
        // Click the first select (usually tags)
        for (const sel of Array.from(selects)) {
          const wrap = sel.closest('.byte-select__wrap, .byte-form__item')
          if (wrap?.textContent?.includes('标签') || !wrap?.textContent?.includes('分类')) {
            (sel as HTMLElement).click()
            break
          }
        }
      })
      await page.waitForTimeout(1500)
      // Click the first tag option in the dropdown
      await page.evaluate(() => {
        const options = document.querySelectorAll('.byte-select-dropdown .byte-option, .byte-overlay .byte-option, [class*="dropdown"] [class*="option"]')
        if (options.length > 0) {
          (options[0] as HTMLElement).click()
        }
      })
      await page.waitForTimeout(500)

      // Step 3: Fill summary textarea
      await page.evaluate(() => {
        const popup = document.querySelector('.publish-popup.active')
        if (!popup) return
        const ta = popup.querySelector('.byte-input__textarea, textarea') as HTMLTextAreaElement | null
        if (ta) {
          ta.value = '这是一篇由 WechatSync 自动发布功能生成的测试文章，用于验证 Playwright 一键发布流程是否正常工作的完整测试。'
          ta.dispatchEvent(new Event('input', { bubbles: true }))
        }
      })
      await page.waitForTimeout(500)

      // Step 4: Click "确定并发布"
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'))
        const btn = btns.find(b => b.textContent?.includes('确定并发布') || b.textContent?.includes('确认并发布'))
        if (btn) btn.click()
      })
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
