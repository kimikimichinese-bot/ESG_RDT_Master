export function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid #d1d5db", borderRadius: 10, padding: 12, marginTop: 8 }}>
      <div style={{ color: "#6b7280", fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
