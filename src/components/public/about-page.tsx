import Image from "next/image";
import Link from "next/link";
import { Award, BarChart3, Gem, Medal } from "lucide-react";

const recognition = [
  { year: "2023", title: "Presidents Club Qualification", Icon: Award },
  { year: "2023", title: "Top 10% Team Ranking", Icon: BarChart3 },
  { year: "2021–23", title: "Medallion Club Team Qualification", Icon: Medal },
  { year: "2020–21", title: "Diamond Club", Icon: Gem }
] as const;

const teamMembers = [
  {
    name: "Neo Wang",
    role: "Marketing & Digital Strategy",
    description: "Listing presentation, photography and how homes reach the right renters.",
    image: "/images/neo-wang-portrait-2026.jpg"
  },
  {
    name: "Hudson Dong",
    role: "Property Manager",
    description: "Day-to-day tenancy: inspections, renewals, repairs and notices.",
    image: "/images/hudson-dong-portrait-2026.jpg"
  },
  {
    name: "Tina Hu",
    role: "Accountant",
    description: "Rent, owner statements and reconciliation through the brokerage.",
    image: "/images/team-member-03-portrait-2026.jpg"
  }
] as const;

export function AboutPageExperience() {
  return (
    <main className="about-design">
      <section className="about-design-hero" aria-labelledby="about-page-heading">
        <Image
          className="about-design-hero-image"
          src="/images/silverkey-home-hero-2026.webp"
          alt="The four-person Silverkey team"
          fill
          priority
          unoptimized
          sizes="100vw"
        />
        <div className="about-design-hero-scrim" aria-hidden />
        <div className="about-design-shell about-design-hero-copy">
          <p className="about-design-eyebrow">TINGTING XU · GREATER VANCOUVER</p>
          <h1 id="about-page-heading">Real estate, handled with care.</h1>
          <p>
            Personal guidance for rentals, sales, and property support—backed by local
            experience and a four-person team built for attentive service.
          </p>
        </div>
      </section>

      <section className="about-design-recognition" aria-labelledby="recognition-heading">
        <div className="about-design-shell">
          <div className="about-design-section-heading about-design-recognition-heading">
            <div>
              <p className="about-design-eyebrow">CAREER RECOGNITION</p>
              <h2 id="recognition-heading">A record built through consistent contribution.</h2>
            </div>
            <span>2020 — 2023</span>
          </div>

          <div className="about-design-recognition-grid">
            {recognition.map(({ year, title, Icon }) => (
              <article key={`${year}-${title}`}>
                <span className="about-design-recognition-icon"><Icon aria-hidden /></span>
                <p>{year}</p>
                <h3>{title}</h3>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="about-design-team" aria-labelledby="team-heading">
        <div className="about-design-shell">
          <p className="about-design-eyebrow">THE TEAM</p>
          <h2 id="team-heading">Who you will actually talk to.</h2>

          <article className="about-design-founder-card">
            <div className="about-design-founder-image">
              <Image
                src="/images/ting-ting-xu-team-2026.jpg"
                alt="TingTing Xu, founder and associate broker"
                fill
                sizes="(max-width: 760px) 100vw, 400px"
              />
            </div>
            <div className="about-design-founder-copy">
              <span className="about-design-role-pill">Founder &amp; Associate Broker</span>
              <h3>TingTing Xu</h3>
              <p className="about-design-founder-title">
                Personal Real Estate Corporation · RE/MAX City Realty
              </p>
              <p>
                I’m a Metro Vancouver real estate professional serving clients who value the
                lifestyle and opportunities this region offers. My clients include business
                leaders, real estate developers, financial institutions, and local and
                international investors.
              </p>
              <p>
                Real estate has been part of my family’s work in Metro Vancouver for more than
                10 years. I also bring over 20 years of business experience across Europe,
                China, and North America. Today, I apply that experience to help clients make
                confident rental, property management, and real estate decisions.
              </p>
              <div className="about-design-founder-contact">
                <a href="tel:+16048726896">604-872-6896</a>
                <a href="mailto:info@silverkey.ca">info@silverkey.ca</a>
              </div>
            </div>
          </article>

          <div className="about-design-team-grid">
            {teamMembers.map((member) => (
              <article key={member.name} className="about-design-team-card">
                <div className="about-design-team-image">
                  <Image
                    src={member.image}
                    alt={`${member.name}, ${member.role} at Silverkey`}
                    fill
                    sizes="(max-width: 760px) 100vw, (max-width: 980px) 50vw, 380px"
                  />
                </div>
                <div className="about-design-team-copy">
                  <h3>{member.name}</h3>
                  <p>{member.role}</p>
                  <span>{member.description}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="about-design-cta" aria-labelledby="about-cta-heading">
        <div className="about-design-shell about-design-cta-card">
          <div>
            <h2 id="about-cta-heading">Want to talk it through first?</h2>
            <p>
              Send the task or the address. We will tell you what we would do and what it costs
              before anything is signed.
            </p>
          </div>
          <div className="about-design-cta-actions">
            <Link href="/#contact">Contact us</Link>
            <Link href="/#services">See services</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
