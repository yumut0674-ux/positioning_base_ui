import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atlas IPS Control",
  description: "Industrial-grade indoor positioning and real-time asset tracking console.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Atlas IPS Control",
    description: "Industrial-grade indoor positioning and real-time asset tracking console.",
    images: [{ url: "/og.png", width: 1680, height: 945, alt: "Atlas IPS Control live positioning workspace" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Atlas IPS Control",
    description: "Industrial-grade indoor positioning and real-time asset tracking console.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
