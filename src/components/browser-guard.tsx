'use client'

import { useEffect, useState } from 'react'

/**
 * 域名防红的客户端一半。
 *
 * 微信、QQ 这些 App 的内置 webview 一旦把域名标红，整站就打不开，
 * 而且是它们自己的黑名单，代码里改不了。能做的只有两件事：
 *   1. 页面还能打开时，第一时间引导用户跳到系统浏览器——外部浏览器不吃这套黑名单
 *   2. 顺手把备用域名给到用户，主域挂了还有地方回来
 *
 * 另一半在运维侧：多域名轮换 + 短链跳板，见 docs/DEPLOY.md。
 */

// 只匹配「打不开外链就没救」的内置 webview。
// QQ 浏览器（mqqbrowser）是独立浏览器，不在此列，别误伤。
const IN_APP = [
  { key: 'micromessenger', name: '微信' },
  { key: 'wxwork', name: '企业微信' },
  { key: ' qq/', name: 'QQ' },
  { key: 'weibo', name: '微博' },
  { key: 'aweme', name: '抖音' },
  { key: 'alipayclient', name: '支付宝' },
  { key: 'dingtalk', name: '钉钉' },
]

export function BrowserGuard({ backupDomains }: { backupDomains: string[] }) {
  const [app, setApp] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const agent = navigator.userAgent.toLowerCase()
    const matched = IN_APP.find((item) => agent.includes(item.key))
    if (!matched) return
    // 关掉一次后当次会话不再打扰；换 App 重开还会提示
    if (sessionStorage.getItem('browser-guard') === 'dismissed') return
    setApp(matched.name)
  }, [])

  if (!app) return null

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href)
    } catch {
      // 内置 webview 常常不给 clipboard 权限，退回选中文本让用户自己复制
      const input = document.createElement('input')
      input.value = window.location.href
      document.body.append(input)
      input.select()
      document.execCommand('copy')
      input.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-100 flex flex-col bg-ink/95 px-6 py-8 text-white">
      <div className="flex justify-end">
        <svg viewBox="0 0 40 60" className="h-14 w-9" aria-hidden="true">
          <path
            d="M20 55 L20 14 M20 8 L11 20 M20 8 L29 20"
            stroke="currentColor"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </div>

      <div className="flex flex-1 flex-col justify-center">
        <p className="text-lg leading-relaxed">
          请点击右上角 <span className="px-1 text-2xl leading-none">···</span>
          <br />
          选择「在浏览器中打开」
        </p>
        <p className="mt-3 text-sm text-white/60">
          {app}内置浏览器无法完成下单，换用 Safari 或 Chrome 即可正常访问。
        </p>
        <p className="mt-6 text-sm text-white/60">
          Tap ··· in the top-right corner and choose “Open in Browser”.
        </p>

        <div className="mt-10 space-y-3">
          <button
            type="button"
            onClick={copy}
            className="w-full border border-white/30 py-3 text-sm transition-colors hover:bg-white/10"
          >
            {copied ? '已复制，去浏览器粘贴打开' : '复制链接 Copy link'}
          </button>
          <button
            type="button"
            onClick={() => {
              sessionStorage.setItem('browser-guard', 'dismissed')
              setApp(null)
            }}
            className="w-full py-2 text-sm text-white/50"
          >
            继续浏览 Continue anyway
          </button>
        </div>

        {backupDomains.length > 0 && (
          <div className="mt-10 border-t border-white/15 pt-5">
            <p className="text-xs text-white/50">备用地址 · 建议收藏</p>
            <ul className="mt-2 space-y-1">
              {backupDomains.map((domain) => (
                <li key={domain} className="text-sm break-all">
                  {domain}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
