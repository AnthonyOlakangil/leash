import "./globals.css";
import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
export const metadata = { title: "Leash", description: "Spending allowance for AI agents, enforced onchain" };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}><body className={GeistSans.className}>{children}</body></html>);
}
