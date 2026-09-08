import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { ServiceWorker } from "@/components/shell/ServiceWorker";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });

export const metadata: Metadata = {
  title: "Party Games",
  description: "Pick a game, share a code, play together in the same room.",
  applicationName: "Party Games",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Party",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0a090c",
  width: "device-width",
  initialScale: 1,
  // The app is a set of fixed, thumb-reachable layouts; pinch-zoom only ever
  // breaks them. Text is already large enough not to need it.
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geist.variable} antialiased`}>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
