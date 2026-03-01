import Link from "next/link";

export const metadata = {
  title: "Help | ESG RDT Master",
  description: "How to use ESG assessments and utility tools.",
};

const sectionStyle = {
  marginTop: 20,
  padding: 16,
  border: "1px solid #dce3ee",
  borderRadius: 12,
  background: "#ffffffcc",
  backdropFilter: "blur(6px)",
};

export default function HelpPage() {
  return (
    <main className="esg-shell">
      <div className="esg-container">
        <header className="esg-topbar">
          <div>
            <h1 className="esg-brand" style={{ marginBottom: 4 }}>
              Help
            </h1>
            <p className="esg-subtitle" style={{ marginTop: 0 }}>
              Navigazione rapida tra esperienza ESG completa e strumenti operativi.
            </p>
          </div>
          <nav className="esg-link-row" aria-label="Help quick links">
            <Link className="esg-link-chip" href="/">
              Home ESG
            </Link>
            <Link className="esg-link-chip" href="/tools/url-analyzer">
              URL Analyzer
            </Link>
          </nav>
        </header>

        <section style={sectionStyle}>
          <h2 style={{ marginTop: 0 }}>ESG Assessment (Home)</h2>
          <p>
            La home <code>/</code> ospita la piattaforma ESG RDT completa: creazione progetto, wizard E/S/G,
            autosalvataggio su Neon e report di completezza con campi obbligatori mancanti.
          </p>
          <p style={{ marginBottom: 0 }}>
            Flusso consigliato: crea progetto da <code>/projects/new</code>, compila sezioni in
            <code> /projects/[id]</code>, verifica riepilogo in <code>/projects/[id]/report</code>.
          </p>
        </section>

        <section style={sectionStyle}>
          <h2 style={{ marginTop: 0 }}>Utility tools</h2>
          <p>
            L&apos;analizzatore URL è disponibile in <code>/tools/url-analyzer</code> e resta separato
            dall&apos;esperienza ESG principale.
          </p>
          <ul style={{ marginTop: 0, marginBottom: 0 }}>
            <li>Accetta URL pubblici HTTP/HTTPS.</li>
            <li>Usa il job <code>analyze_url</code> via API same-origin.</li>
            <li>Mostra stato job e payload finale.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
