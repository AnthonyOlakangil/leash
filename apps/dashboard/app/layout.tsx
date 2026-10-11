import "./globals.css";
import type { ReactNode } from "react";
export const metadata = { title: "Leash", description: "Spending allowance for AI agents, enforced onchain" };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
