import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CIFRA Messenger",
  applicationName: "CIFRA",
  description:
    "Корпоративный веб-мессенджер CIFRA для компьютеров и мобильных устройств.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CIFRA",
  },
  formatDetection: {
    address: false,
    email: false,
    telephone: false,
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#071426",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
