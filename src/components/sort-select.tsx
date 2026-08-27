'use client'

import { useRouter } from 'next/navigation'

// 服务端把每个选项对应的完整链接算好传进来，这里只负责跳转。
// 传函数过组件边界是不允许的，传字符串就没这个问题。
export function SortSelect({
  value,
  options,
}: {
  value: string
  options: { value: string; label: string; href: string }[]
}) {
  const router = useRouter()

  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Sort by</span>
      <select
        value={value}
        onChange={(event) => {
          const target = options.find((option) => option.value === event.target.value)
          if (target) router.push(target.href)
        }}
        // min-h-11：下拉在手机上是主要操作，文字行高只有 13px，点不中
        className="label-xs min-h-11 cursor-pointer appearance-none bg-transparent pr-4 outline-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%236b7177'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right center',
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
