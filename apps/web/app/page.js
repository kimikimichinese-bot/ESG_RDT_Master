const links = [
  {
    href: "/api/ready",
    title: "Readiness",
    description: "Quick check that web routing is live.",
  },
  {
    href: "/api/health",
    title: "Health",
    description: "Checks DB connectivity and reports build version.",
  },
];

const runbookSteps = [
  "Keep this instance aligned to kimikimichinese-bot context.",
  "Use master + required checks for production merges.",
  "Run vercel --prod after green readiness checks.",
];

export default function Home() {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "4rem 1.5rem" }}>
      <section style={{ display: "grid", gap: 18 }}>
        <header>
          <h1>ESG RDT Master</h1>
          <p>Production diagnostics workspace.</p>
        </header>

        <section>
          <h2>Monitoring endpoints</h2>
          <ul>
            {links.map((link) => (
              <li key={link.href} style={{ marginBottom: 12 }}>
                <a href={link.href}>{link.title}</a>
                <div style={{ color: "#555", fontSize: 14 }}>{link.description}</div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Release runbook quick-check</h2>
          <ol>
            {runbookSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      </section>
    </main>
  );
}
