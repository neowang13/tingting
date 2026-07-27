import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

const adminSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-admin-sans"
});

const adminMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-admin-mono"
});

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`admin-route ${adminSans.variable} ${adminMono.variable}`}>
      {children}
    </div>
  );
}
