import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import localFont from "next/font/local";
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

const pixelMplus = localFont({
  src: "../../public/fonts/PixelMplus10-Regular.ttf",
  variable: "--font-pixel",
  display: "swap",
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
      <body className={`${inter.variable} ${playfair.variable} ${pixelMplus.variable}`}>
        <div className="appShell">
          <main className="appMain">{children}</main>
        </div>
      </body>
    </html>
  );
}
