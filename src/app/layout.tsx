import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { NavBar } from "@/app/components/NavBar";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Agent Arena RPS",
  description: "AI vs AI — Stone Cold Strategy",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${geistMono.variable}`}>
        <div className="appShell">
          <NavBar />
          <main className="appMain">{children}</main>
        </div>
      </body>
    </html>
  );
}
