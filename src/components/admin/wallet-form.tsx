'use client'

import { useState, useTransition } from 'react'
import { saveWallets } from '@/lib/admin-actions'
import { FilterInput } from './filter-input'
import { Card, inputClass } from './ui'

type Wallet = {
  key: string
  coin: string
  networkLabel: string
  pegged: boolean
  address: string
  enabled: boolean
}

export function WalletForm({ wallets }: { wallets: Wallet[] }) {
  const [pending, startTransition] = useTransition()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setSaved(false)

    startTransition(async () => {
      const result = await saveWallets(formData)
      if (!result.ok) {
        setErrors(result.errors)
        return
      }
      setErrors({})
      setSaved(true)
    })
  }

  const enabledCount = wallets.filter((wallet) => wallet.enabled).length
  const visible = new Set(
    wallets
      .filter(
        (wallet) =>
          !needle ||
          wallet.coin.toLowerCase().includes(needle) ||
          wallet.networkLabel.toLowerCase().includes(needle) ||
          wallet.key.toLowerCase().includes(needle),
      )
      .map((wallet) => wallet.key),
  )

  return (
    <form onSubmit={onSubmit} className="max-w-3xl space-y-4">
      <FilterInput value={query} onChange={setQuery} placeholder="搜索币种或网络" />
      {needle && visible.size === 0 && <p className="text-sm text-faint">没有匹配的币种</p>}
      {wallets.map((wallet) => {
        const hit = visible.has(wallet.key)
        return (
        <Card key={wallet.key} className={hit ? 'p-5' : 'hidden'}>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h2 className="text-sm">
                {wallet.coin}
                {wallet.pegged && (
                  <span className="ml-2 text-[10px] tracking-wide text-faint uppercase">
                    锚定 1 美元
                  </span>
                )}
              </h2>
              <p className="mt-0.5 text-xs text-faint">{wallet.networkLabel}</p>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                name={`${wallet.key}.enabled`}
                defaultChecked={wallet.enabled}
                className="size-3.5 accent-ink"
              />
              在前台展示
            </label>
          </div>

          <input
            name={`${wallet.key}.address`}
            defaultValue={wallet.address}
            spellCheck={false}
            placeholder={`${wallet.networkLabel} 收款地址`}
            className={`${inputClass} mt-3 font-mono text-xs`}
          />
          {errors[wallet.key] && (
            <p className="mt-1.5 text-xs text-sale">{errors[wallet.key]}</p>
          )}
        </Card>
        )
      })}

      <div className="sticky bottom-0 flex items-center gap-4 border-t border-line bg-white py-4">
        <button
          type="submit"
          disabled={pending}
          className="bg-ink px-8 py-3 text-sm text-white transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          {pending ? '保存中…' : '保存'}
        </button>
        <span className="text-xs text-faint">前台当前可选 {enabledCount} 个币种</span>
        {saved && <span className="text-xs text-emerald-700">已保存</span>}
        {Object.keys(errors).length > 0 && (
          <span className="text-xs text-sale">有地址没通过校验，未保存</span>
        )}
      </div>
    </form>
  )
}
