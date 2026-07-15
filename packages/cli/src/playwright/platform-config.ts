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

      // Step 4: Wait for button to enable, then click (no force — let Vue handle it)
      await page.waitForFunction(() => {
        const btns = Array.from(document.querySelectorAll('button'))
        const btn = btns.find(b => b.textContent?.includes('确定并发布'))
        return btn && !(btn as HTMLButtonElement).disabled
      }, { timeout: 15000 }).catch(() => {})
      const confirm = page.locator('button').filter({ hasText: /确定并发布/ })
      await confirm.click()
      await page.waitForTimeout(3000)
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

  weibo: {
    name: '微博',
    loginUrl: 'https://passport.weibo.com/sso/signin',
    postLoginUrl: 'https://card.weibo.com',
    editorUrl: (id: string) => `https://card.weibo.com/article/v5/editor#/draft/${id}`,
    async doPublish(page: Page) {
      await page.waitForTimeout(5000)

      await page.waitForTimeout(3000)
      const nextBtn = page.locator('button.n-button--primary-type').filter({ hasText: '下一步' })
      await nextBtn.waitFor({ state: 'visible', timeout: 10000 })

      // Click "下一步" twice: first triggers cover auto-select, second opens publish dialog
      await nextBtn.click({ force: true })
      await page.waitForTimeout(2000)
      await nextBtn.click({ force: true })
      await page.waitForTimeout(2000)

      // Click "发布" in the publish dialog
      await page.locator('button').filter({ hasText: /发布/ }).last().click({ force: true })
      await page.waitForTimeout(5000)
    },
  },
  bilibili: {
    name: '哔哩哔哩',
    loginUrl: 'https://passport.bilibili.com/login',
    postLoginUrl: 'https://member.bilibili.com',
    editorUrl: (id: string) => `https://member.bilibili.com/york/read-editor?aid=${id}`,
    async doPublish(page: Page) {
      await page.waitForTimeout(10000)
      // Click the "发布" button in the footer (publish-footer)
      const pubBtn = page.locator('.publish-footer button.vui_button--blue, .vui_button--blue').filter({ hasText: '发布' })
      await pubBtn.waitFor({ state: 'visible', timeout: 30000 })
      await pubBtn.click()
      await page.waitForTimeout(5000)
    },
  },

  baijiahao: {
    name: '百家号',
    loginUrl: 'https://baijiahao.baidu.com/builder/rc/login',
    postLoginUrl: 'https://baijiahao.baidu.com',
    editorUrl: (id: string) => `https://baijiahao.baidu.com/builder/rc/edit?type=news&article_id=${id}`,
    async doPublish(page: Page) {
      await page.waitForTimeout(8000)

      // Step 1: Upload cover image
      try {
        // Click "单图" (single cover) first
        await page.locator('span, div').filter({ hasText: '单图' }).first().click({ force: true })
        await page.waitForTimeout(500)
      } catch {}

      // Click "选择封面" to trigger file upload dialog
      await page.locator('span, div, button').filter({ hasText: '选择封面' }).first().click({ force: true })
      await page.waitForTimeout(1000)

      // Find the hidden file input and upload a generated cover image
      const fileInput = page.locator('input[type="file"]')
      const fiCount = await fileInput.count()
      if (fiCount > 0) {
        // Generate a valid 100x100 blue PNG cover using a Buffer
        // PNG spec: signature + IHDR + IDAT + IEND
        const pngBytes: number[] = []
        // PNG signature
        pngBytes.push(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
        // IHDR chunk (13 bytes): width=100, height=100, 8bit RGB
        const ihdr = new Uint8Array(25)
        const view = new DataView(ihdr.buffer)
        view.setUint32(0, 13) // length
        ihdr.set([0x49, 0x48, 0x44, 0x52], 4) // "IHDR"
        view.setUint32(8, 100)  // width
        view.setUint32(12, 100) // height
        ihdr[16] = 8  // bit depth
        ihdr[17] = 2  // color type (RGB)
        ihdr[18] = 0  // compression
        ihdr[19] = 0  // filter
        ihdr[20] = 0  // interlace
        // CRC for IHDR (simple, using known good CRC for 100x100 IHDR)
        const crc1 = [0xFF, 0x80, 0x02, 0x03]
        ihdr.set(crc1, 21)
        pngBytes.push(...Array.from(ihdr))
        // IDAT chunk: zlib-compressed 100 rows of blue pixels
        const idatRaw: number[] = []
        for (let y = 0; y < 100; y++) {
          idatRaw.push(0) // filter byte (none)
          for (let x = 0; x < 100; x++) {
            idatRaw.push(0, 0, 255) // blue pixel (R=0, G=0, B=255)
          }
        }
        // Use a pre-computed valid IDAT for blue 100x100 (simplified)
        // For simplicity, write temp file via page.evaluate
      }
      // Simpler approach: upload via page.evaluate using a canvas-generated blob
      await page.evaluate(() => {
        const canvas = document.createElement('canvas')
        canvas.width = 100; canvas.height = 100
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.fillStyle = '#3366CC'
          ctx.fillRect(0, 0, 100, 100)
          ctx.fillStyle = '#FFFFFF'
          ctx.font = '20px sans-serif'
          ctx.fillText('Cover', 10, 60)
        }
        canvas.toBlob((blob) => {
          if (!blob) return
          const file = new File([blob], 'cover.png', { type: 'image/png' })
          const dt = new DataTransfer()
          dt.items.add(file)
          const input = document.querySelector('input[type="file"]') as HTMLInputElement
          if (input) {
            input.files = dt.files
            input.dispatchEvent(new Event('change', { bubbles: true }))
          }
        }, 'image/png')
      })
      await page.waitForTimeout(3000)

      // Step 2: Click "发布"
      await page.locator('button').filter({ hasText: /^发布$/ }).first().click({ force: true })
      await page.waitForTimeout(3000)

      // Step 3: Click "确认" via JS
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'))
        const confirm = btns.find(b => b.textContent?.includes('确认'))
        if (confirm) (confirm as HTMLButtonElement).click()
      })
      await page.waitForTimeout(5000)
    },
  },

  '51cto': {
    name: '51CTO',
    loginUrl: 'https://blog.51cto.com/login',
    postLoginUrl: 'https://blog.51cto.com',
    editorUrl: (id: string) => `https://blog.51cto.com/blogger/draft/${id}`,
    async doPublish(page: Page) {
      await page.waitForTimeout(5000)
      const btns = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button')).filter(b => !!(b as HTMLElement).offsetParent).map(b => ({
          t: (b as HTMLButtonElement).textContent?.trim().substring(0, 30),
        })).filter(b => b.t)
      )
      console.log(`  [Debug] 51CTO buttons: ${JSON.stringify(btns)}`)
      await page.locator('button').filter({ hasText: /发布|提交/ }).first().click({ force: true })
      await page.waitForTimeout(5000)
    },
  },

  segmentfault: {
    name: 'SegmentFault',
    loginUrl: 'https://segmentfault.com/user/login',
    postLoginUrl: 'https://segmentfault.com',
    editorUrl: (id: string) => `https://segmentfault.com/write?draftId=${id}`,
    async doPublish(page: Page) {
      await page.waitForTimeout(10000)
      // Step 1: Add a tag if needed
      try {
        const addTagBtn = page.locator('button, a, span').filter({ hasText: /添加标签/ })
        if (await addTagBtn.count() > 0) {
          await addTagBtn.first().click()
          await page.waitForTimeout(1000)
          // Click the first tag suggestion
          const firstTag = page.locator('.tag-suggestion-item, .tag-item, [class*="tag"]').filter({ hasText: /前端|后端|技术/ }).first()
          if (await firstTag.count() > 0) {
            await firstTag.click()
            await page.waitForTimeout(500)
          }
        }
      } catch { /* tag may already exist */ }

      // Step 2: Click "提交" to publish
      const submitBtn = page.locator('button').filter({ hasText: /发布|提交/ }).first()
      await submitBtn.click()
      await page.waitForTimeout(5000)
      await page.waitForTimeout(5000)
    },
  },
}

export function getPlatformConfig(platformKey: string): PlatformPublishConfig | null {
  return PLATFORMS[platformKey] || null
}

export function getSupportedPublishPlatforms(): string[] {
  return Object.keys(PLATFORMS)
}
