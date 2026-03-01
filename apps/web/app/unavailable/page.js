import Link from "next/link";

export const dynamic = "force-dynamic";

const sectionStyle = {
  marginTop: 20,
  padding: 16,
  border: "1px solid #dce3ee",
  borderRadius: 12,
  background: "#ffffffcc",
  backdropFilter: "blur(6px)",
};

const toText = (value) => {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.slice(0, 120);
};

export default function UnavailablePage({ searchParams }) {
  const requestId = toText(searchParams?.requestId);
  const digest = toText(searchParams?.digest);
  const source = toText(searchParams?.source);

  return (
    <main className="esg-shell">
      <div className="esg-container">
        <header className="esg-topbar">
          <div>
            <h1 className="esg-brand">Service temporarily unavailable</h1>
            <p className="esg-subtitle">We could not complete this request safely. Please retry in a moment.</p>
          </div>
        </header>

        <section style={sectionStyle}>
          <p style={{ marginTop: 0, marginBottom: 10 }}>
            Request ID: <code>{requestId || "not-available"}</code>
          </p>
          {digest ? (
            <p style={{ marginTop: 0, marginBottom: 10 }}>
              Digest: <code>{digest}</code>
            </p>
          ) : null}
          {source ? (
            <p style={{ marginTop: 0, marginBottom: 10 }}>
              Source: <code>{source}</code>
            </p>
          ) : null}
          <div className="esg-link-row">
            <Link className="esg-link-chip" href="/help">
              Help
            </Link>
            <Link className="esg-link-chip" href="/login">
              Login
            </Link>
            <Link className="esg-link-chip" href="/">
              Home
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
