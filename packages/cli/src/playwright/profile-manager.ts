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
