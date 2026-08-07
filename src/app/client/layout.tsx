import Link from "next/link";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return <div className="client-route"><header className="client-header"><Link href="/" className="client-brand"><strong>Ting Ting Xu</strong><span>Secure Client Login</span></Link></header>{children}</div>;
}
