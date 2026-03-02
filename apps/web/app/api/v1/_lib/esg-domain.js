import { createHash } from "node:crypto";

export const METRIC_DEFINITIONS = [
  {
    key: "electricity_kwh",
    category: "Energy",
    label: "Electricity consumption",
    unit: "kWh",
    description: "Total purchased electricity.",
    isRequired: true,
    validation: { min: 0 },
  },
  {
    key: "renewable_electricity_kwh",
    category: "Energy",
    label: "Renewable electricity",
    unit: "kWh",
    description: "Renewable portion of purchased electricity.",
    isRequired: false,
    validation: { min: 0, lteMetric: "electricity_kwh" },
  },
  {
    key: "natural_gas_mwh",
    category: "Fuels",
    label: "Natural gas",
    unit: "MWh",
    description: "Natural gas used in operations.",
    isRequired: false,
    validation: { min: 0 },
  },
  {
    key: "diesel_liters",
    category: "Fuels",
    label: "Diesel",
    unit: "liters",
    description: "Diesel consumed by company-controlled assets.",
    isRequired: false,
    validation: { min: 0 },
  },
  {
    key: "gasoline_liters",
    category: "Fuels",
    label: "Gasoline",
    unit: "liters",
    description: "Gasoline consumed by company-controlled assets.",
    isRequired: false,
    validation: { min: 0 },
  },
  {
    key: "refrigerant_leakage_kg",
    category: "Refrigerants",
    label: "Refrigerant leakage",
    unit: "kg",
    description: "Leakage of refrigerants during operations.",
    isRequired: false,
    validation: { min: 0 },
  },
  {
    key: "waste_generated_tons",
    category: "Waste",
    label: "Waste generated",
    unit: "tons",
    description: "Total waste generated.",
    isRequired: false,
    validation: { min: 0 },
  },
  {
    key: "waste_recycled_tons",
    category: "Waste",
    label: "Waste recycled",
    unit: "tons",
    description: "Waste sent to recycling streams.",
    isRequired: false,
    validation: { min: 0, lteMetric: "waste_generated_tons" },
  },
  {
    key: "water_withdrawal_m3",
    category: "Water",
    label: "Water withdrawal",
    unit: "m3",
    description: "Total water withdrawal.",
    isRequired: false,
    validation: { min: 0 },
  },
  {
    key: "water_discharge_m3",
    category: "Water",
    label: "Water discharge",
    unit: "m3",
    description: "Total water discharge.",
    isRequired: false,
    validation: { min: 0, lteMetric: "water_withdrawal_m3", warningOnly: true },
  },
  {
    key: "sites_in_water_stressed_areas",
    category: "Water",
    label: "Sites in water-stressed areas",
    unit: "count",
    description: "Derived from sites flagged as water-stressed.",
    isRequired: false,
    validation: { derived: true },
  },
];

export const METRIC_DEFINITION_BY_KEY = new Map(METRIC_DEFINITIONS.map((item) => [item.key, item]));

export const METRIC_KEYS_BY_CATEGORY = METRIC_DEFINITIONS.reduce((acc, item) => {
  if (!acc[item.category]) {
    acc[item.category] = [];
  }
  acc[item.category].push(item.key);
  return acc;
}, {});

export const EMISSION_FACTOR_DEFINITIONS = [
  {
    key: "ef_scope2_location_kgco2e_per_kwh",
    label: "Scope 2 location factor",
    unit: "kgCO2e/kWh",
    required: true,
  },
  {
    key: "ef_scope2_market_kgco2e_per_kwh",
    label: "Scope 2 market factor",
    unit: "kgCO2e/kWh",
    required: false,
  },
  {
    key: "ef_natural_gas_kgco2e_per_mwh",
    label: "Natural gas factor",
    unit: "kgCO2e/MWh",
    required: true,
  },
  {
    key: "ef_diesel_kgco2e_per_liter",
    label: "Diesel factor",
    unit: "kgCO2e/liter",
    required: true,
  },
  {
    key: "ef_gasoline_kgco2e_per_liter",
    label: "Gasoline factor",
    unit: "kgCO2e/liter",
    required: true,
  },
  {
    key: "ef_refrigerant_kgco2e_per_kg",
    label: "Refrigerant factor",
    unit: "kgCO2e/kg",
    required: true,
  },
];

export const EMISSION_FACTOR_BY_KEY = new Map(EMISSION_FACTOR_DEFINITIONS.map((item) => [item.key, item]));

export const FACTOR_REFERENCE_OPTIONS_BY_KEY = {
  ef_scope2_location_kgco2e_per_kwh: [
    {
      id: "uk_desnz_conversion_factors",
      label: "UK DESNZ Conversion Factors (national, annual)",
      jurisdiction: "UK",
      year: "latest",
      url: "https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting",
      suggestedValue: null,
    },
    {
      id: "us_epa_egrid",
      label: "US EPA eGRID subregion factors (national dataset)",
      jurisdiction: "US",
      year: "latest",
      url: "https://www.epa.gov/egrid",
      suggestedValue: null,
    },
    {
      id: "unfccc_national_inventories",
      label: "UNFCCC national inventory submissions (country-specific)",
      jurisdiction: "International",
      year: "latest",
      url: "https://unfccc.int/ghg-inventories-annex-i-parties/latest-submissions",
      suggestedValue: null,
    },
  ],
  ef_scope2_market_kgco2e_per_kwh: [
    {
      id: "ghg_protocol_scope2_guidance",
      label: "GHG Protocol Scope 2 Guidance (market-based method)",
      jurisdiction: "International",
      year: "2015+",
      url: "https://ghgprotocol.org/scope-2-guidance",
      suggestedValue: null,
    },
    {
      id: "uk_desnz_conversion_factors_market",
      label: "UK DESNZ Conversion Factors (supplier/market values)",
      jurisdiction: "UK",
      year: "latest",
      url: "https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting",
      suggestedValue: null,
    },
    {
      id: "us_epa_egrid_market_context",
      label: "US EPA eGRID (market-context electricity data support)",
      jurisdiction: "US",
      year: "latest",
      url: "https://www.epa.gov/egrid",
      suggestedValue: null,
    },
  ],
  ef_natural_gas_kgco2e_per_mwh: [
    {
      id: "us_epa_emission_factors_hub_ng",
      label: "US EPA Emission Factors Hub - natural gas combustion",
      jurisdiction: "US",
      year: "latest",
      url: "https://www.epa.gov/climateleadership/ghg-emission-factors-hub",
      suggestedValue: null,
    },
    {
      id: "uk_desnz_conversion_factors_ng",
      label: "UK DESNZ Conversion Factors - natural gas",
      jurisdiction: "UK",
      year: "latest",
      url: "https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting",
      suggestedValue: null,
    },
    {
      id: "ipcc_2006_guidelines_stationary_combustion",
      label: "IPCC 2006 Guidelines - default stationary combustion factors",
      jurisdiction: "International",
      year: "2006",
      url: "https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol2.html",
      suggestedValue: null,
    },
  ],
  ef_diesel_kgco2e_per_liter: [
    {
      id: "us_epa_emission_factors_hub_diesel",
      label: "US EPA Emission Factors Hub - diesel",
      jurisdiction: "US",
      year: "latest",
      url: "https://www.epa.gov/climateleadership/ghg-emission-factors-hub",
      suggestedValue: null,
    },
    {
      id: "uk_desnz_conversion_factors_diesel",
      label: "UK DESNZ Conversion Factors - diesel (stationary/mobile)",
      jurisdiction: "UK",
      year: "latest",
      url: "https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting",
      suggestedValue: null,
    },
    {
      id: "ipcc_2006_guidelines_diesel",
      label: "IPCC 2006 Guidelines - liquid fuel default factors",
      jurisdiction: "International",
      year: "2006",
      url: "https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol2.html",
      suggestedValue: null,
    },
  ],
  ef_gasoline_kgco2e_per_liter: [
    {
      id: "us_epa_emission_factors_hub_gasoline",
      label: "US EPA Emission Factors Hub - gasoline",
      jurisdiction: "US",
      year: "latest",
      url: "https://www.epa.gov/climateleadership/ghg-emission-factors-hub",
      suggestedValue: null,
    },
    {
      id: "uk_desnz_conversion_factors_gasoline",
      label: "UK DESNZ Conversion Factors - petrol/gasoline",
      jurisdiction: "UK",
      year: "latest",
      url: "https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting",
      suggestedValue: null,
    },
    {
      id: "ipcc_2006_guidelines_gasoline",
      label: "IPCC 2006 Guidelines - liquid fuel default factors",
      jurisdiction: "International",
      year: "2006",
      url: "https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol2.html",
      suggestedValue: null,
    },
  ],
  ef_refrigerant_kgco2e_per_kg: [
    {
      id: "ipcc_ar6_gwp100",
      label: "IPCC AR6 GWP100 values (refrigerants depend on gas type)",
      jurisdiction: "International",
      year: "2021",
      url: "https://www.ipcc.ch/report/ar6/wg1/chapter/chapter-7/",
      suggestedValue: null,
    },
    {
      id: "us_epa_emission_factors_hub_refrigerants",
      label: "US EPA Emission Factors Hub - refrigerants",
      jurisdiction: "US",
      year: "latest",
      url: "https://www.epa.gov/climateleadership/ghg-emission-factors-hub",
      suggestedValue: null,
    },
    {
      id: "uk_desnz_conversion_factors_refrigerants",
      label: "UK DESNZ Conversion Factors - refrigerants",
      jurisdiction: "UK",
      year: "latest",
      url: "https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting",
      suggestedValue: null,
    },
  ],
};

export const CONTRACT_TYPES = ["total", "permanent", "temporary"];
export const GENDERS = ["M", "F", "D"];

export const parseYear = (value) => {
  const year = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    return null;
  }
  return year;
};

export const parseMonth = (value) => {
  const month = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  return month;
};

export const parseNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

export const parseInteger = (value) => {
  const parsed = parseNumber(value);
  if (parsed === null) {
    return null;
  }
  if (!Number.isInteger(parsed)) {
    return null;
  }
  return parsed;
};

export const parseBoolean = (value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return false;
};

export const asMetricValueMap = (rows) => {
  const map = new Map();
  for (const row of rows || []) {
    if (row?.metric_key) {
      const value = parseNumber(row.value);
      map.set(row.metric_key, value === null ? 0 : value);
    }
  }
  return map;
};

export const makeStableUuid = (...parts) => {
  const raw = parts
    .map((item) => (item == null ? "" : String(item).trim()))
    .join("|")
    .toLowerCase();
  const hex = createHash("sha1").update(raw).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

export const socialSectionEntityId = ({ tenantId, siteId, reportingYear, section }) =>
  makeStableUuid("social-section", tenantId, siteId, reportingYear, section);

export const metricValidationMessages = {
  renewable_electricity_kwh: "renewable_electricity_kwh cannot exceed electricity_kwh",
  waste_recycled_tons: "waste_recycled_tons cannot exceed waste_generated_tons",
  water_discharge_m3: "water_discharge_m3 should not exceed water_withdrawal_m3",
};

export const validateMetricMap = ({
  metricMap,
  strictWaterDischarge = false,
  enforceRequired = false,
  ignoreDerived = true,
}) => {
  const errors = [];
  const warnings = [];

  for (const definition of METRIC_DEFINITIONS) {
    if (ignoreDerived && definition.validation?.derived) {
      continue;
    }

    const value = metricMap.has(definition.key) ? metricMap.get(definition.key) : null;

    if (enforceRequired && definition.isRequired && (value == null || value < 0)) {
      errors.push(`${definition.key} is required`);
    }

    if (value != null) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push(`${definition.key} must be numeric`);
      } else if (definition.validation?.min != null && value < definition.validation.min) {
        errors.push(`${definition.key} must be >= ${definition.validation.min}`);
      }
    }
  }

  const compare = (leftKey, rightKey, message, warningOnly = false) => {
    const left = metricMap.get(leftKey);
    const right = metricMap.get(rightKey);
    if (left == null || right == null) {
      return;
    }
    if (left > right) {
      if (warningOnly) {
        warnings.push(message);
      } else {
        errors.push(message);
      }
    }
  };

  compare(
    "renewable_electricity_kwh",
    "electricity_kwh",
    metricValidationMessages.renewable_electricity_kwh,
    false,
  );
  compare("waste_recycled_tons", "waste_generated_tons", metricValidationMessages.waste_recycled_tons, false);
  compare(
    "water_discharge_m3",
    "water_withdrawal_m3",
    metricValidationMessages.water_discharge_m3,
    !strictWaterDischarge,
  );

  return { errors, warnings };
};

export const numberOrZero = (value) => {
  const parsed = parseNumber(value);
  return parsed == null ? 0 : parsed;
};

export const roundNumber = (value, digits = 6) => {
  const scale = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
};
