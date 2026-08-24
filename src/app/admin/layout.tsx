import { Bricolage_Grotesque, IBM_Plex_Mono, Karla } from "next/font/google";

const adminSans = Karla({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-admin-sans"
});

const adminDisplay = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-admin-display"
});

const adminMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-admin-mono"
});

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`admin-route ${adminSans.variable} ${adminDisplay.variable} ${adminMono.variable}`}>
      {children}
    </div>
  );
}
