import "./globals.css";
import "./esg.css";

export const metadata = {
  title: "ESG RDT Master",
  description: "Monorepo web application workspace."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
