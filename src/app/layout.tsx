import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { getSiteText } from '@/lib/queries'
import { siteUrl } from '@/lib/site'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

// 站名和简介归后台管，所以这里得现查，不能再写成静态的 metadata 常量
export async function generateMetadata(): Promise<Metadata> {
  const { name, description } = await getSiteText()

  return {
    metadataBase: new URL(siteUrl()),
    title: { default: name, template: `%s — ${name}` },
    description,
    // 私域站点，不进搜索引擎。middleware 和响应头还有两层，这里是最外面那层。
    robots: { index: false, follow: false, nocache: true },
    // noindex 和分享卡片不冲突：搜索引擎不收录，微信/WhatsApp 的抓取照样出图
    openGraph: {
      type: 'website',
      siteName: name,
      title: name,
      description,
      url: siteUrl(),
    },
    twitter: { card: 'summary_large_image', title: name, description },
    // 内置浏览器点「在浏览器中打开」后，地址栏要显示真实域名而不是跳板短链
    alternates: { canonical: siteUrl() },
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  )
}
