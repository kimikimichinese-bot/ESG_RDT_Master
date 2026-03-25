import Link from "next/link";

const checklist = [
  {
    code: "A",
    title: "Organization sanity check",
    objective: "Obiettivo: organizzare correttamente holding → companies → sites (con country).",
    where: "Dove andare: Companies, Sites",
    input: "Input richiesti: Company type, Site country, water-stressed flag (se applicabile)",
    output: "Output atteso: 2 companies + sites validi e selezionabili",
    done: "Done when: ogni site ha country; company selezionabile nel topbar",
    pitfalls: [
      "country mancante → factors/emissions non risolvono",
      "site duplicati → dati incoerenti",
      "company non “enabled fields” → metriche non compaiono",
    ],
  },
  {
    code: "B",
    title: "Standards & Fields (GRI/SASB)",
    objective: "Obiettivo: abilitare i campi richiesti per la company e mantenere consistenza.",
    where: "Dove: Companies → Standards & Fields, Standards",
    input: "Input: framework, industry, enable/required fields, custom fields se servono",
    output: "Output: elenco campi attivi per company, mappature standards",
    done: "Done when: i campi necessari compaiono nelle pagine di input",
    pitfalls: ["attivi troppo pochi campi → buchi nel report"],
  },
  {
    code: "C",
    title: "Materiality & Double Materiality",
    objective: "Obiettivo: definire i topic materiali e le soglie.",
    where: "Dove: Materiality",
    input: "Input: topic selection, scoring (1–5), soglie",
    output: "Output: lista material topics + matrice",
    done: "Done when: almeno 1 topic selezionato + Save scores completato",
    pitfalls: ["nessun topic selezionato → non sai cosa misurare"],
  },
  {
    code: "D",
    title: "KPI Data Entry (Environment / GHG / Social / Governance)",
    objective: "Obiettivo: raccogliere dati per i topic materiali.",
    where: "Dove: Environment Data, GHG Inventory, Social Data, Governance",
    input:
      "Input: valori per company/site/year; record Scope 3 per categorie rilevanti; social monthly + leavers",
    output: "Output: dataset completo + KPI computed",
    done: "Done when: i moduli chiave hanno valori e non mostrano errori",
    pitfalls: ["inserire dati senza evidence → audit debole"],
  },
  {
    code: "E",
    title: "Evidence",
    objective: "Obiettivo: rendere i dati verificabili.",
    where: "Dove: Evidence Vault + link evidence dentro moduli",
    input: "Input: PDF + metadata + link a record/topic",
    output: "Output: evidence-links tracciabile",
    done: "Done when: ogni KPI/material topic critico ha almeno 1 evidence linkata",
    pitfalls: ["upload senza link → evidenza inutilizzata"],
  },
  {
    code: "F",
    title: "Factors",
    objective: "Obiettivo: avere fattori di emissione corretti e tracciabili.",
    where: "Dove: Factors",
    input: "Input: apply suggested per country/site + source/reference; override dove serve",
    output: "Output: resolved sources per calcolo",
    done: "Done when: “Missing required factors” = 0 (o motivato)",
    pitfalls: ["fattori non applicati → Emissions incomplete"],
  },
  {
    code: "G",
    title: "Emissions review",
    objective: "Obiettivo: verificare totali Scope 1/2/3 e breakdown.",
    where: "Dove: Emissions",
    input: "Input: nessuno (deriva da records+factors)",
    output: "Output: totali, breakdown, warnings, resolved sources",
    done: "Done when: totals coerenti + warnings gestiti",
    pitfalls: ["Scope 3 vuoto per assenza records → screening incompleto"],
  },
  {
    code: "H",
    title: "Exports (Audit pack + GRI content index)",
    objective: "Obiettivo: produrre output consegnabile.",
    where: "Dove: Export / Audit pack (o script export)",
    input: "Output: snapshot.json + standards-mappings.csv + evidence-links.csv + content index",
    output: "Output: pack pronto per assurance",
    done: "Done when: pack generato + condivisibile",
    pitfalls: ["content index con omission non spiegate"],
  },
  {
    code: "I",
    title: "Handover (assurance/review)",
    objective: "Obiettivo: consegna ordinata e verificabile.",
    where: "Cosa consegnare: audit pack + note su omission + elenco fonti factors",
    input: "Input: checklist finale + evidenze",
    output: "Output: pacchetto completo per revisore",
    done: "Done when: revisore trova location di ogni disclosure richiesta",
    pitfalls: [],
  },
];

const mapping = [
  "E1 Climate change → GHG: Scope 1/2/3 totals, Cat6 travel, Cat7 commuting, Cat1 purchased goods (spend); Environment: electricity_kwh, renewable_kwh, fuels; Factors: source + overrides",
  "E2 Pollution → Environment: NOx/SOx/PM (se industrial), waste hazardous/non-hazardous; GHG: process emissions (se manufacturing)",
  "E3 Water → Environment: withdrawal/discharge/reuse + water-stressed sites",
  "E4 Biodiversity → Sites in sensitive areas (flag), land use (custom), permits/evidence",
  "E5 Circular economy → Waste generated/recycled + packaging/materials (Scope3 Cat1/12)",
  "S1 Own workforce → Social: headcount, hours, turnover, H&S (TRIR/LTIFR), training",
  "S2 Value chain workers → Social/standards: supplier screening, audits, incidents (scope3 cat1/cat4)",
  "S3 Communities → Governance/social: grievance mechanism, incidents, permits",
  "S4 Consumers → Governance: product safety incidents, recalls, data/privacy (per servizi)",
  "G1 Business conduct → Governance: anti-corruption, whistleblowing, training, incidents/fines; Standards mapping + evidence",
  "GEN1–GEN3 → Data quality/controls, regulatory readiness, value chain resilience → governance/standards/evidence completeness",
];

export const metadata = {
  title: "Year Kickoff | ESG RDT Master",
};

export default function YearKickoffHelpPage() {
  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Manuale Operatore — Year Kickoff</h2>
          <p className="enterprise-muted">
            Checklist operativa stampabile per Company + Year: definisci i topic materiali, monitora KPI, collega evidenze e genera export audit-ready.
          </p>
        </div>
        <div className="enterprise-inline-actions">
          <Link className="enterprise-button-secondary" href="/app/materiality">
            Torna a Materiality
          </Link>
          <Link className="enterprise-button-secondary" href="/app/environment">
            Vai a Data Entry
          </Link>
        </div>
      </div>

      <div className="enterprise-card year-kickoff-card">
        <h3>Sequenza obbligatoria</h3>
        <ol className="year-kickoff-list year-kickoff-list-ordered">
          <li>Definisci che cosa è materiale (topic + punteggi + soglie).</li>
          <li>Poi censisci/monitora i KPI che dimostrano quei topic (Environment/GHG/Social/Governance).</li>
          <li>Colleghi Evidence e fai report/export audit-ready.</li>
        </ol>
      </div>

      <div className="enterprise-card year-kickoff-card">
        <h3>Checklist operativa A-Z</h3>
        <div className="year-kickoff-checklist-grid">
          {checklist.map((item) => (
            <article key={item.code} className="enterprise-subcard year-kickoff-checklist-item">
              <h4>
                {item.code}) {item.title}
              </h4>
              <p>{item.objective}</p>
              <p>{item.where}</p>
              <p>{item.input}</p>
              <p>{item.output}</p>
              <p>{item.done}</p>
              {item.pitfalls.length > 0 ? (
                <>
                  <strong>Common pitfalls:</strong>
                  <ul className="year-kickoff-list">
                    {item.pitfalls.map((pitfall) => (
                      <li key={pitfall}>{pitfall}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </article>
          ))}
        </div>
      </div>

      <div className="enterprise-card year-kickoff-card">
        <h3>Quando devo tornare indietro</h3>
        <ul className="year-kickoff-list">
          <li>Torna a Materiality SOLO se: aggiungi/modifichi topic, cambi soglie, cambi company/year.</li>
          <li>Altrimenti: resta su Data Entry, Evidence, Factors, Emissions, Exports.</li>
        </ul>
      </div>

      <div className="enterprise-card year-kickoff-card">
        <h3>Input pronto (preset + formula)</h3>
        <p className="enterprise-muted">Preset punteggi iniziali (copiabile):</p>
        <pre className="enterprise-pre year-kickoff-pre">
{`- E1 Climate change: severity 4, scope 4, irremediability 4, likelihood 4; magnitude 4, financial likelihood 4
- S1 Own workforce: severity 3, scope 4, irremediability 3, likelihood 3; magnitude 3, financial likelihood 3
- G1 Business conduct: severity 3, scope 3, irremediability 3, likelihood 3; magnitude 4, financial likelihood 3

Formula:
- Impact score = avg(severity, scope, irremediability) × likelihood
- Financial score = magnitude × financial likelihood
- Material se Impact ≥ soglia OR Financial ≥ soglia`}
        </pre>
      </div>

      <div className="enterprise-card year-kickoff-card">
        <h3>Mapping consigliato (cross-industry)</h3>
        <ul className="year-kickoff-list">
          {mapping.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div className="enterprise-card year-kickoff-card">
        <h3>Regola “Custom KPI”</h3>
        <ul className="year-kickoff-list">
          <li>Se ti manca un KPI: crealo come custom field nel Definition Manager e abilitalo per Company.</li>
          <li>Da quel momento il KPI diventa compilabile, monitorabile e linkabile a evidenze.</li>
          <li>Poi entra nei calcoli, nei report e negli export come gli altri campi.</li>
        </ul>
      </div>

      <div className="enterprise-card year-kickoff-card">
        <h3>Criteri di completamento</h3>
        <ul className="year-kickoff-list">
          <li>Done definition: topic selezionati e almeno 1 salvataggio punteggi.</li>
          <li>Done data: KPI principali compilati per Company/Site/Year.</li>
          <li>Done evidence: KPI e topic critici con almeno 1 evidence collegata.</li>
          <li>Done export: audit pack generato e condivisibile.</li>
        </ul>
      </div>
    </section>
  );
}
