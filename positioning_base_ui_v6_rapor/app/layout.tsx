import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GEKON IPS Kontrol",
  description: "Endüstriyel iç mekân konumlandırma ve gerçek zamanlı varlık izleme konsolu.",
  icons: { icon: "/favicon.svg?v=2", shortcut: "/favicon.svg?v=2" },
  openGraph: {
    title: "GEKON IPS Kontrol",
    description: "Endüstriyel iç mekân konumlandırma ve gerçek zamanlı varlık izleme konsolu.",
    images: [{ url: "/og.png", width: 1680, height: 945, alt: "GEKON IPS canlı konumlandırma çalışma alanı" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "GEKON IPS Kontrol",
    description: "Endüstriyel iç mekân konumlandırma ve gerçek zamanlı varlık izleme konsolu.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="tr"><body>{children}</body></html>;
}
