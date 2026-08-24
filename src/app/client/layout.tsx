import { Bricolage_Grotesque, IBM_Plex_Mono, Karla } from "next/font/google";

const clientSans = Karla({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-client-sans"
});

const clientDisplay = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-client-display"
});

const clientMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-client-mono"
});

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return <div className={`client-route ${clientSans.variable} ${clientDisplay.variable} ${clientMono.variable}`}>{children}</div>;
}
