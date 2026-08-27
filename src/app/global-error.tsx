'use client'

// 根布局自己炸了才会走到这里，此时连 globals.css 都没加载，只能写内联样式
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          display: 'flex',
          minHeight: '100vh',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          fontFamily: 'system-ui, sans-serif',
          color: '#141414',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', fontWeight: 400 }}>Something went wrong</h1>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: '0.75rem 1.5rem',
            background: '#141414',
            color: '#fff',
            border: 'none',
            fontSize: '0.875rem',
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  )
}
