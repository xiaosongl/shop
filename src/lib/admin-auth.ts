import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export const ADMIN_COOKIE = 'ns_admin'
const MAX_AGE_SECONDS = 60 * 60 * 12

export type AdminRole = 'admin' | 'staff'

function secret() {
  const value = process.env.ADMIN_SESSION_SECRET
  if (!value) throw new Error('缺少 ADMIN_SESSION_SECRET，无法签发后台会话')
  return value
}

function sign(payload: string) {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

function digest(value: string) {
  return createHmac('sha256', secret()).update(value).digest()
}

function same(left: string, right: string) {
  const a = digest(left)
  const b = digest(right)
  return timingSafeEqual(a, b)
}

/** 会话是「过期时间.角色 + 签名」。角色写进 cookie，改不了也伪造不了 */
export function createSession(role: AdminRole = 'admin') {
  const payload = `${Date.now() + MAX_AGE_SECONDS * 1000}.${role}`
  return { value: `${payload}.${sign(payload)}`, maxAge: MAX_AGE_SECONDS }
}

export function readSession(token: string | undefined): { role: AdminRole } | null {
  if (!token) return null

  const separator = token.lastIndexOf('.')
  if (separator <= 0) return null

  const payload = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  const expected = sign(payload)
  if (signature.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null

  const dot = payload.indexOf('.')
  const expires = Number(dot === -1 ? payload : payload.slice(0, dot))
  const role = (dot === -1 ? 'admin' : payload.slice(dot + 1)) as string
  if (!Number.isFinite(expires) || expires <= Date.now()) return null
  if (role !== 'admin' && role !== 'staff') return null
  return { role }
}

export function verifySession(token: string | undefined): boolean {
  return readSession(token) !== null
}

export async function getAdminRole(): Promise<AdminRole | null> {
  const store = await cookies()
  return readSession(store.get(ADMIN_COOKIE)?.value)?.role ?? null
}

export async function isAuthenticated() {
  return (await getAdminRole()) !== null
}

/** 品牌/文案/收款这类页员工进不去，直接送回概览 */
export async function assertAdminPage() {
  const role = await getAdminRole()
  if (!role) redirect('/admin/login')
  if (role !== 'admin') redirect('/admin')
}

function accountMatches(username: string, password: string, expectedUser: string, expectedPass: string) {
  // 没配的账号也走一遍哈希，免得响应时间泄露「员工户开没开」
  if (!expectedUser || !expectedPass) {
    same(username, username)
    same(password, password)
    return false
  }
  return same(username, expectedUser) && same(password, expectedPass)
}

/** 对上哪个账号回哪个角色。两个都对得上时走管理员。 */
export function resolveAccount(username: string, password: string): AdminRole | null {
  const adminOk = accountMatches(
    username,
    password,
    process.env.ADMIN_USERNAME ?? '',
    process.env.ADMIN_PASSWORD ?? '',
  )
  const staffOk = accountMatches(
    username,
    password,
    process.env.STAFF_USERNAME ?? '',
    process.env.STAFF_PASSWORD ?? '',
  )
  if (adminOk) return 'admin'
  if (staffOk) return 'staff'
  return null
}

/** 定长比较，别让响应时间泄露密码前缀是否正确 */
export function credentialsMatch(username: string, password: string) {
  return resolveAccount(username, password) !== null
}
