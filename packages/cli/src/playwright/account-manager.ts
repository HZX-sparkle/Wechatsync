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
