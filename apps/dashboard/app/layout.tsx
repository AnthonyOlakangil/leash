import "./globals.css";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jb = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jb" });
export const metadata = { title: "Leash", description: "Spending allowance for AI agents, enforced onchain" };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="en" className={`${inter.variable} ${jb.variable}`}><body>{children}</body></html>);
}
