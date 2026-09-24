'use client'

export function FilterInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.preventDefault()
      }}
      placeholder={placeholder}
      className="mb-5 w-full max-w-sm border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink"
    />
  )
}
