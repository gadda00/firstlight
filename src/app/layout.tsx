import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FirstLight — Disaster Intelligence Platform",
  description:
    "Geo-AI decision layer for the first six hours of disaster response: damage & flood detection, H3 priority zoning, isolation analysis, grounded sitreps. Simulated demo.",
  keywords: [
    "FirstLight",
    "disaster response",
    "GeoAI",
    "satellite imagery",
    "SAR",
    "H3",
    "situation report",
    "damage assessment",
  ],
  authors: [{ name: "FirstLight" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "FirstLight — Disaster Intelligence Platform",
    description:
      "From raw imagery to a prioritized, routable response map — with human review and grounded sitreps.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster position="bottom-center" richColors />
      </body>
    </html>
  );
}
