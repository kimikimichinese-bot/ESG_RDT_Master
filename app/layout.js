import "./globals.css";

export const metadata = {
  title: "ESG RDT Master",
  description: "Minimal production-ready starter for kimikimichinese-bot.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
