"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowRight, Award } from "lucide-react";

const teamMembers = [
  {
    index: "01",
    name: "Ting Ting Xu",
    role: "Founder & Real Estate Advisor",
    description: "Leads every client relationship with clear advice, responsive communication, and practical Greater Vancouver market knowledge.",
    image: "/images/ting-ting-xu-team-2026.jpg",
    imageAlt: "Ting Ting Xu, founder and real estate advisor at Silverkey"
  },
  {
    index: "02",
    name: "Neo Wang",
    role: "Marketing & Digital Strategy",
    description: "Shapes how Silverkey presents properties, communicates value, and builds a consistent client experience across digital channels.",
    image: "/images/neo-wang-portrait-2026.jpg",
    imageAlt: "Neo Wang, marketing and digital strategy at Silverkey"
  },
  {
    index: "03",
    name: "Team Member 03",
    role: "Profile to be supplied",
    description: "This position is reserved for the third member of Silverkey's current four-person team.",
    image: "/images/team-member-03-portrait-2026.jpg",
    imageAlt: "Silverkey team member; name and profile details to be confirmed"
  },
  {
    index: "04",
    name: "Team Member 04",
    role: "Profile to be supplied",
    description: "This position is reserved for the fourth member of Silverkey's current four-person team.",
    image: null,
    imageAlt: ""
  }
] as const;

const recognition = [
  {
    year: "2023",
    title: "Presidents Club Qualification",
    detail: "Team qualification earned during TingTing's earlier work with Team Alliance."
  },
  {
    year: "2023",
    title: "Top 10% Team Ranking",
    detail: "Recorded in the Greater Vancouver REALTORS® Medallion portal."
  },
  {
    year: "2021–23",
    title: "Medallion Club Team Qualification",
    detail: "A three-year record of team-level qualification in the supplied GVR materials."
  },
  {
    year: "2020–21",
    title: "Diamond Club",
    detail: "Team Alliance recognition from Pacific Evergreen Realty Ltd."
  }
] as const;

const salesArchive = [
  { src: "/images/sales-archive/sales-04.jpg", labels: ["Vancouver"], crop: 11, wide: false },
  { src: "/images/sales-archive/sales-05.jpg", labels: ["Vancouver", "Richmond"], crop: 11, wide: false },
  { src: "/images/sales-archive/sales-06.jpg", labels: ["Richmond", "Burnaby"], crop: 11, wide: false },
  { src: "/images/sales-archive/sales-07.jpg", labels: ["Burnaby", "Coquitlam", "West Vancouver"], crop: 11, wide: false },
  { src: "/images/sales-archive/sales-08.jpg", labels: ["Coquitlam", "Surrey", "Maple Ridge"], crop: 11, wide: false },
  { src: "/images/sales-archive/sales-09.jpg", labels: ["Presale", "Assignment"], crop: 11, wide: false },
  { src: "/images/sales-archive/sales-10.jpg", labels: ["Presale", "Commercial"], crop: 23, wide: true },
  { src: "/images/sales-archive/sales-11.jpg", labels: ["Vancouver", "Richmond"], crop: 11, wide: false },
  { src: "/images/sales-archive/sales-12.jpg", labels: ["Richmond", "Burnaby", "Presale"], crop: 11, wide: false },
  { src: "/images/sales-archive/sales-13.jpg", labels: ["Presale", "Commercial"], crop: 11, wide: false }
] as const;

function SalesArchiveSlider() {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = salesArchive[activeIndex];

  const move = (direction: number) => {
    setActiveIndex((current) => (current + direction + salesArchive.length) % salesArchive.length);
  };

  return (
    <div
      className="about-redesign-sales-slider"
      role="region"
      aria-roledescription="carousel"
      aria-label="Historical sales archive"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") move(-1);
        if (event.key === "ArrowRight") move(1);
      }}
    >
      <div className="about-redesign-sales-stage">
        <div className="about-redesign-sales-visual">
          <Image
            className="about-redesign-sales-backdrop"
            src={active.src}
            alt=""
            fill
            aria-hidden
            sizes="(max-width: 800px) 100vw, 70vw"
          />
          <a
            className="about-redesign-sales-image-link"
            href={active.src}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${active.labels.join(", ")} sales archive page at full size`}
          >
            <div
              className={`about-redesign-sales-image-crop${active.wide ? " is-wide" : ""}`}
              style={active.wide ? undefined : { top: `-${active.crop}%`, height: `${100 + active.crop}%` }}
            >
              <Image
                key={active.src}
                className="about-redesign-sales-image"
                src={active.src}
                alt={`Sold-property archive for ${active.labels.join(", ")}; no people shown`}
                fill
                priority={activeIndex === 0}
                sizes="(max-width: 800px) 92vw, 62vw"
              />
            </div>
          </a>
          <span className="about-redesign-sales-corner">SOLD ARCHIVE</span>
        </div>

        <aside className="about-redesign-sales-meta" aria-live="polite">
          <p className="about-redesign-sales-index">ARCHIVE {String(activeIndex + 1).padStart(2, "0")}</p>
          <h3 className="about-redesign-sales-locations">
            {active.labels.map((label) => <span key={label}>{label}</span>)}
          </h3>
          <div className="about-redesign-sales-navigation">
            <button type="button" onClick={() => move(-1)} aria-label="Previous sales archive slide">
              <ArrowLeft aria-hidden />
            </button>
            <span>{String(activeIndex + 1).padStart(2, "0")} / {String(salesArchive.length).padStart(2, "0")}</span>
            <button type="button" onClick={() => move(1)} aria-label="Next sales archive slide">
              <ArrowRight aria-hidden />
            </button>
          </div>
          <div className="about-redesign-sales-progress" aria-hidden>
            <i style={{ width: `${((activeIndex + 1) / salesArchive.length) * 100}%` }} />
          </div>
        </aside>
      </div>

      <div className="about-redesign-sales-dots" aria-label="Choose sales archive slide">
        {salesArchive.map((slide, index) => (
          <button
            className={index === activeIndex ? "is-active" : undefined}
            type="button"
            key={slide.src}
            onClick={() => setActiveIndex(index)}
            aria-label={`Show ${slide.labels.join(", ")} archive slide`}
            aria-current={index === activeIndex ? "true" : undefined}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <i />
          </button>
        ))}
      </div>
    </div>
  );
}

export function AboutPageExperience() {
  return (
    <main className="about-page about-redesign">
      <section className="about-redesign-hero" aria-labelledby="about-page-heading">
        <Image
          className="about-redesign-hero-image"
          src="/images/silverkey-about-team-banner-2026.png"
          alt="Three members of the Silverkey team in a professional office portrait"
          fill
          priority
          loading="eager"
          sizes="100vw"
        />
        <div className="about-redesign-hero-scrim" aria-hidden />
        <div className="container about-redesign-hero-inner">
          <div className="about-redesign-hero-copy">
            <div className="eyebrow">TINGTING XU · GREATER VANCOUVER</div>
            <h1 id="about-page-heading">Real estate, handled with care.</h1>
            <p>
              Personal guidance for rentals, sales, and property support—backed by local
              experience and a four-person team built for attentive service.
            </p>
            <a className="about-redesign-scroll" href="#about-team">
              Meet the team
              <ArrowDown size={17} aria-hidden />
            </a>
          </div>
        </div>
      </section>

      <section className="about-redesign-recognition" aria-labelledby="recognition-heading">
        <div className="container about-redesign-recognition-grid">
          <figure className="about-redesign-awards-image">
            <Image
              src="/images/awards-history.jpg"
              alt="Historical Pacific Evergreen Realty awards with no people pictured"
              width={780}
              height={700}
              sizes="(max-width: 800px) 94vw, 45vw"
            />
            <figcaption>Historical recognition from earlier collaborative work</figcaption>
          </figure>
          <div className="about-redesign-recognition-copy">
            <div className="eyebrow">EARLIER CAREER RECOGNITION</div>
            <h2 id="recognition-heading">A record built through consistent contribution.</h2>
            <div className="about-redesign-recognition-list">
              {recognition.map((item) => (
                <article key={`${item.year}-${item.title}`}>
                  <span>{item.year}</span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.detail}</p>
                  </div>
                  <Award aria-hidden />
                </article>
              ))}
            </div>
            <p className="about-redesign-history-note">
              These are historical team-level recognitions from TingTing’s earlier work. They
              are not presented as awards earned by Silverkey’s current four-person team.
            </p>
          </div>
        </div>
      </section>

      <section className="about-redesign-team" id="about-team" aria-labelledby="team-heading">
        <div className="container about-redesign-section-heading">
          <div>
            <div className="eyebrow">THE CURRENT SILVERKEY TEAM</div>
            <h2 id="team-heading">Four people. One standard of care.</h2>
          </div>
        </div>
        <div className="container about-redesign-team-grid">
          {teamMembers.map((member) => (
            <article className={`about-redesign-team-member${member.image ? " has-photo" : " is-pending"}`} key={member.index}>
              <div className="about-redesign-team-visual">
                {member.image ? (
                  <Image src={member.image} alt={member.imageAlt} fill sizes="(max-width: 680px) 94vw, (max-width: 1050px) 46vw, 24vw" />
                ) : (
                  <div className="about-redesign-team-placeholder" aria-label={`${member.name} profile pending`}>
                    <span>{member.index}</span>
                    <small>SILVERKEY</small>
                  </div>
                )}
              </div>
              <div className="about-redesign-team-caption">
                <span>{member.index}</span>
                <p>{member.role}</p>
                <h3>{member.name}</h3>
                <small>{member.description}</small>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="about-redesign-sales" aria-labelledby="sales-heading">
        <div className="container about-redesign-section-heading about-redesign-sales-heading">
          <div>
            <div className="eyebrow">HISTORICAL SALES ARCHIVE</div>
            <h2 id="sales-heading">Every documented sale, kept in view.</h2>
          </div>
          <p>
            Ten property-only archive sheets. Browse the collection.
          </p>
        </div>
        <div className="container">
          <SalesArchiveSlider />
          <p className="about-redesign-history-note about-redesign-sales-note">
            Archive source: materials from TingTing’s earlier collaborative work. These
            transactions are not attributed to Silverkey’s current team.
          </p>
        </div>
      </section>

      <section className="about-redesign-contact" aria-labelledby="about-contact-heading">
        <div className="container about-redesign-contact-inner">
          <div>
            <div className="eyebrow">START A CONVERSATION</div>
            <h2 id="about-contact-heading">Your next move deserves a clear plan.</h2>
          </div>
          <Link className="button" href="/#contact">
            Contact TingTing
            <ArrowRight size={18} aria-hidden />
          </Link>
        </div>
      </section>
    </main>
  );
}
