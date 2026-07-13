import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GEKON IPS Control",
  description: "Industrial-grade indoor positioning and real-time asset tracking console.",
  icons: { icon: "/favicon.svg?v=2", shortcut: "/favicon.svg?v=2" },
  openGraph: {
    title: "GEKON IPS Control",
    description: "Industrial-grade indoor positioning and real-time asset tracking console.",
    images: [{ url: "/og.png", width: 1680, height: 945, alt: "GEKON IPS Control live positioning workspace" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "GEKON IPS Control",
    description: "Industrial-grade indoor positioning and real-time asset tracking console.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
