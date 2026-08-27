import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

export const ADMIN_COOKIE = 'ns_admin'
const MAX_AGE_SECONDS = 60 * 60 * 12

function secret() {
  const value = process.env.ADMIN_SESSION_SECRET
  if (!value) throw new Error('缺少 ADMIN_SESSION_SECRET，无法签发后台会话')
  return value
}

function sign(payload: string) {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

/** 会话就是「过期时间 + 签名」。不存任何身份信息，改不了也伪造不了 */
export function createSession() {
  const payload = String(Date.now() + MAX_AGE_SECONDS * 1000)
  return { value: `${payload}.${sign(payload)}`, maxAge: MAX_AGE_SECONDS }
}

export function verifySession(token: string | undefined): boolean {
  if (!token) return false

  const separator = token.lastIndexOf('.')
  if (separator <= 0) return false

  const payload = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  const expected = sign(payload)

  // 先比长度：timingSafeEqual 长度不等会直接抛
  if (signature.length !== expected.length) return false
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false

  const expires = Number(payload)
  return Number.isFinite(expires) && expires > Date.now()
}

export async function isAuthenticated() {
  const store = await cookies()
  return verifySession(store.get(ADMIN_COOKIE)?.value)
}

/** 定长比较，别让响应时间泄露密码前缀是否正确 */
export function credentialsMatch(username: string, password: string) {
  const expectedUser = process.env.ADMIN_USERNAME ?? ''
  const expectedPass = process.env.ADMIN_PASSWORD ?? ''
  if (!expectedUser || !expectedPass) return false

  // 先过一遍哈希，把长度差异抹平，避免用长度试探
  const digest = (value: string) => createHmac('sha256', secret()).update(value).digest()
  const userOk = timingSafeEqual(digest(username), digest(expectedUser))
  const passOk = timingSafeEqual(digest(password), digest(expectedPass))
  return userOk && passOk
}
