import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import ServiceWorker from "./ServiceWorker";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Document to Speech",
  description: "Upload a document and download it as spoken MP3 audio.",
  // The icon lives in public/ rather than as an app/icon.png convention file,
  // so point at it explicitly.
  icons: { icon: "/icon.png", apple: "/icon-192.png" },
};

// Colours the browser chrome around an installed copy (see app/manifest.ts).
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {/* Caches the app for offline reading; registers in production only. */}
        <ServiceWorker />
        {/* Page views and visitors. Injects nothing outside a Vercel
            deployment, so local development stays untouched. */}
        <Analytics />
      </body>
    </html>
  );
}
