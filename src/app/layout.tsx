import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL ?? "http://localhost:3000"),
  title: "Ting Ting Xu | Greater Vancouver Rentals & Property Services",
  description: "Find Greater Vancouver rentals and practical property services with Ting Ting Xu.",
  openGraph: {
    type: "website",
    title: "Ting Ting Xu Real Estate",
    description: "Greater Vancouver rentals, real estate, and property services.",
    url: "/"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
