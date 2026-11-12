import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { ChatProvider } from "@/components/ChatProvider";
import Shell from "@/components/Shell";
import { ToastProvider } from "@/components/Toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mandate — an AI buyer with rules",
  description: "An AI purchasing agent that pays through PayPal, only inside the spending rules you set.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen font-sans">
        <ToastProvider>
          <ChatProvider>
            <Shell>{children}</Shell>
          </ChatProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
