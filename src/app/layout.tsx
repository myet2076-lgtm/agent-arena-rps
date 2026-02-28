import type { Metadata } from "next";
import { Inter, Playfair_Display, Press_Start_2P } from "next/font/google";
import { NavBar } from "@/app/components/NavBar";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  weight: ["400", "600", "700", "800"],
});

const pressStart = Press_Start_2P({
  subsets: ["latin"],
  variable: "--font-pixel",
  weight: "400",
});

export const metadata: Metadata = {
  title: "Agent Arena RPS",
  description: "AI vs AI — Where Strategy Meets Spectacle",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${playfair.variable} ${pressStart.variable}`}>
        <div className="appShell">
          <main className="appMain">{children}</main>
        </div>
      </body>
    </html>
  );
}
