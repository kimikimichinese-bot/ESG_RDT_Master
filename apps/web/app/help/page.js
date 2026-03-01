import Link from "next/link";

const tryWikipediaHref = "/?url=https%3A%2F%2Fwww.wikipedia.org%2F&autorun=1";

export const metadata = {
  title: "Help | ESG RDT Master",
  description: "How to use the URL analyzer and what safety rules apply."
};

const sectionStyle = {
  marginTop: 20,
  padding: 16,
  border: "1px solid #dce3ee",
  borderRadius: 12,
  background: "#ffffffcc",
  backdropFilter: "blur(6px)"
};

export default function HelpPage() {
  return (
    <main style={{ maxWidth: 860, margin: "40px auto", padding: "0 16px", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <h1 style={{ marginBottom: 8 }}>Help</h1>
      <p style={{ marginTop: 0, color: "#516074" }}>
        Learn what the analyzer does, what inputs work best, and what safety checks are enforced.
      </p>

      <section style={sectionStyle}>
        <h2 style={{ marginTop: 0 }}>What This App Does</h2>
        <p>
          The app accepts a public URL, creates an <code>analyze_url</code> job, then shows job status and final output.
          Results include HTTP status, final URL after redirects, and extracted metadata such as title and description.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={{ marginTop: 0 }}>Examples</h2>
        <p style={{ marginBottom: 6 }}><strong>Good URLs:</strong></p>
        <ul style={{ marginTop: 0 }}>
          <li><code>https://www.wikipedia.org/</code></li>
          <li><code>https://example.com/</code></li>
          <li><code>https://developer.mozilla.org/</code></li>
        </ul>
        <p style={{ marginBottom: 6 }}><strong>Typical output:</strong></p>
        <ul style={{ marginTop: 0 }}>
          <li>Job status transitions (<code>queued</code>, <code>running</code>, <code>succeeded</code> or <code>failed</code>)</li>
          <li>Fetched URL details: HTTP status and final URL</li>
          <li>Extracted metadata: page title, description, and fetch timestamp</li>
        </ul>
      </section>

      <section style={sectionStyle}>
        <h2 style={{ marginTop: 0 }}>Limits And Safety (SSRF Guard)</h2>
        <ul style={{ marginTop: 0, marginBottom: 0 }}>
          <li>Only <code>http</code> and <code>https</code> URLs are allowed.</li>
          <li>URLs with credentials are rejected (for example <code>https://user:pass@example.com</code>).</li>
          <li>Hosts are blocked when they resolve to local/private targets.</li>
          <li>Blocked targets include: <code>localhost</code>, <code>.local</code>, private IP ranges, link-local IPs, and loopback IPs.</li>
        </ul>
      </section>

      <section style={{ ...sectionStyle, textAlign: "center" }}>
        <Link
          href={tryWikipediaHref}
          style={{
            display: "inline-block",
            padding: "14px 22px",
            borderRadius: 10,
            border: "1px solid #163a8a",
            background: "linear-gradient(180deg, #2f6fed, #1f56c9)",
            color: "#fff",
            fontWeight: 700,
            fontSize: 16,
            textDecoration: "none"
          }}
        >
          Try Wikipedia
        </Link>
      </section>

      <p style={{ marginTop: 18 }}>
        <Link href="/">Back to home</Link>
      </p>
    </main>
  );
}
