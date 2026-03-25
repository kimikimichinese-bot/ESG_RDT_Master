import Link from "next/link";

export const metadata = {
  title: "ESG Reference Library | ESG RDT Master",
  description: "Product tutorials e risorse ESG di riferimento in un'unica libreria ordinata.",
};

const sectionStyle = {
  marginTop: 20,
  padding: 20,
  border: "1px solid var(--pal-border)",
  borderRadius: 16,
  background: "var(--pal-bg-card)",
  backdropFilter: "blur(6px)",
};

const cardGridStyle = {
  display: "grid",
  gap: 16,
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
};

const resourceCards = [
  {
    title: "Manuale Operativo Bilancio di Sostenibilità",
    category: "ESG Methodology",
    description:
      "Guida metodologica di riferimento sul percorso di costruzione del bilancio di sostenibilità, con focus su processo, materialità, ruoli, assurance e checklist finale.",
    href: "/resources/manuale-operativo-bilancio-sostenibilita.pdf",
  },
  {
    title: "Report Best Practices Anonimizzato",
    category: "Best Practices / Inspiration",
    description:
      "Raccolta anonimizzata di pratiche, benchmark e spunti operativi su sostenibilità, governance, miglioramento e roadmap ESG.",
    href: "/resources/report-best-practices-anonimizzato.pdf",
  },
  {
    title: "Presentazione Manuale Operativo Bilancio di Sostenibilità",
    category: "Slides / Quick Overview",
    description:
      "Sintesi visuale del percorso operativo, utile come overview rapida per orientamento interno e onboarding.",
    href: "/resources/presentazione-manuale-operativo-bilancio-sostenibilita.pdf",
  },
];

const tutorialItems = [
  "Quick start operativo per nuovi tenant e nuovi utenti.",
  "Year kickoff per avvio anno, topic materiali e raccolta dati.",
  "Tutorial modulo per modulo su Environment, Social, Governance, Evidence, Factors ed Exports.",
  "Video batch e pillole brevi per onboarding interno e ripassi rapidi.",
];

export default function ESGResourcesPage() {
  return (
    <main className="esg-shell">
      <div className="esg-container">
        <header className="esg-topbar">
          <div>
            <h1 className="esg-brand" style={{ marginBottom: 4 }}>
              ESG Reference Library
            </h1>
            <p className="esg-subtitle" style={{ marginTop: 0 }}>
              Libreria ordinata tra tutorial di prodotto e materiali ESG di approfondimento.
            </p>
          </div>
          <nav className="esg-link-row" aria-label="Resources quick links">
            <Link className="esg-link-chip" href="/help">
              Help
            </Link>
            <Link className="esg-link-chip" href="/app/help/year-kickoff">
              Year Kickoff
            </Link>
          </nav>
        </header>

        <section style={sectionStyle}>
          <p style={{ marginTop: 0, marginBottom: 12, color: "var(--pal-text)" }}>
            Qui trovi due aree distinte: i tutorial di prodotto per usare la piattaforma e una raccolta
            di risorse ESG di riferimento per metodo, benchmark e orientamento interno.
          </p>
          <p
            style={{
              margin: 0,
              padding: 14,
              borderRadius: 12,
              border: "1px solid var(--pal-border)",
              background: "var(--pal-bg-hover)",
              color: "var(--pal-text)",
            }}
          >
            Queste risorse sono materiali di supporto, formazione e ispirazione. Non sostituiscono la
            documentazione operativa della piattaforma, ma aiutano a comprendere framework, processo di
            reporting e best practice di mercato.
          </p>
        </section>

        <section style={sectionStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ marginTop: 0, marginBottom: 6, color: "var(--pal-text)" }}>Product tutorials</h2>
              <p style={{ marginTop: 0, color: "var(--pal-text-muted)" }}>
                Area dedicata ai contenuti operativi di piattaforma. I player video possono essere integrati
                in un secondo momento senza cambiare questa struttura.
              </p>
            </div>
            <Link className="esg-link-chip" href="/app/help/year-kickoff">
              Apri Year Kickoff
            </Link>
          </div>

          <div
            style={{
              padding: 16,
              borderRadius: 14,
              border: "1px solid var(--pal-border)",
              background: "var(--pal-bg-header-footer)",
              color: "var(--pal-text)",
            }}
          >
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8, color: "var(--pal-text)" }}>
              {tutorialItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={{ marginTop: 0, marginBottom: 6, color: "var(--pal-text)" }}>ESG reference resources</h2>
          <p style={{ marginTop: 0, color: "var(--pal-text-muted)" }}>
            Materiali selezionati per metodo, ispirazione e overview rapida. Tutti i documenti qui sotto
            puntano esclusivamente ai PDF finali presenti nella cartella pubblica del progetto.
          </p>

          <div style={cardGridStyle}>
            {resourceCards.map((card) => (
              <article
                key={card.href}
                style={{
                  display: "grid",
                  gap: 12,
                  padding: 18,
                  borderRadius: 14,
                  border: "1px solid var(--pal-border)",
                  background: "var(--pal-bg-main)",
                }}
              >
                <div>
                  <p
                    style={{
                      margin: "0 0 8px",
                      fontSize: 12,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--pal-text-muted)",
                    }}
                  >
                    {card.category}
                  </p>
                  <h3 style={{ margin: "0 0 8px", fontSize: 20, color: "var(--pal-text)" }}>{card.title}</h3>
                  <p style={{ margin: 0, color: "var(--pal-text-muted)", lineHeight: 1.5 }}>{card.description}</p>
                </div>

                <div>
                  <Link className="esg-link-chip" href={card.href} target="_blank">
                    Apri PDF
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
