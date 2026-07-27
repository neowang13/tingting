import { ArrowRight } from "lucide-react";
import Link from "next/link";

interface Service {
  key: string;
  ctaLabel: string;
}

interface Props {
  service: Service;
}

const serviceRoutes: Record<string, string> = {
  renovation: "/services/renovation",
  handyman: "/services/handyman-service",
  maintenance: "/services/property-maintenance",
  strata: "/services/strata-service",
  rental_management: "/services/rental-management"
};

export function ServiceDetails({ service }: Props) {
  return (
    <Link className="service-link" href={serviceRoutes[service.key] ?? "/#contact"}>
      {service.ctaLabel}
      <ArrowRight size={15} aria-hidden />
    </Link>
  );
}
