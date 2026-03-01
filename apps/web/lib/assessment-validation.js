const REPORTING_YEAR_KEY = "e.profile.reporting_year";
const BASE_YEAR_KEY = "e.profile.base_year";

const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

const isMeaningfulValue = (value) => {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return false;
};

const toInteger = (value) => {
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string") {
    const raw = value.trim();
    if (!/^[-+]?\d+$/.test(raw)) {
      return null;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
};

const toNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toComparableValue = (value, typeHint) => {
  if (typeHint === "integer") {
    return toInteger(value);
  }
  if (typeHint === "number") {
    return toNumber(value);
  }
  return value;
};

const getValidationMeta = (parameter) => {
  const options = parameter?.options;
  if (!isPlainObject(options)) {
    return null;
  }
  if (!isPlainObject(options.validation)) {
    return null;
  }
  return options.validation;
};

const addError = (errors, parameter, code, message, details = {}) => {
  errors.push({
    key: parameter.key,
    label: parameter.label,
    code,
    message,
    ...details,
  });
};

const toErrorMap = (errors) => {
  const result = {};
  for (const error of errors) {
    if (!result[error.key]) {
      result[error.key] = [];
    }
    result[error.key].push(error.message);
  }
  return result;
};

export const normalizeYearValue = (value) => toInteger(value);

export const validateAssessmentAnswers = ({ parameters, answerMap }) => {
  const safeParameters = Array.isArray(parameters) ? parameters : [];
  const safeAnswerMap = isPlainObject(answerMap) ? answerMap : {};

  const parameterByKey = new Map(safeParameters.map((parameter) => [parameter.key, parameter]));
  const comparableValues = {};
  const errors = [];

  for (const parameter of safeParameters) {
    const validation = getValidationMeta(parameter);
    if (!validation) {
      continue;
    }

    const rawValue = safeAnswerMap[parameter.key];
    const hasValue = isMeaningfulValue(rawValue);
    const typeHint = validation.type || parameter.type || "text";
    const comparableValue = toComparableValue(rawValue, typeHint);
    comparableValues[parameter.key] = comparableValue;

    if (validation.required && !hasValue) {
      addError(errors, parameter, "required", `${parameter.label} is required.`);
      continue;
    }

    if (!hasValue) {
      continue;
    }

    if (typeHint === "integer" && comparableValue === null) {
      addError(errors, parameter, "type.integer", `${parameter.label} must be an integer.`);
      continue;
    }

    if (typeHint === "number" && comparableValue === null) {
      addError(errors, parameter, "type.number", `${parameter.label} must be a number.`);
      continue;
    }

    const numericValue =
      typeHint === "integer" || typeHint === "number" ? comparableValue : toNumber(comparableValue);

    if (validation.min != null && numericValue != null && numericValue < Number(validation.min)) {
      addError(errors, parameter, "range.min", `${parameter.label} must be >= ${validation.min}.`, {
        min: Number(validation.min),
      });
    }

    if (validation.max != null && numericValue != null && numericValue > Number(validation.max)) {
      addError(errors, parameter, "range.max", `${parameter.label} must be <= ${validation.max}.`, {
        max: Number(validation.max),
      });
    }

    const allowedValues = Array.isArray(validation.allowedValues)
      ? validation.allowedValues
      : Array.isArray(validation.allowedYears)
        ? validation.allowedYears
        : null;
    if (allowedValues?.length) {
      if (typeHint === "integer" || typeHint === "number") {
        const normalizedAllowed = new Set(allowedValues.map((item) => Number(item)));
        if (numericValue == null || !normalizedAllowed.has(Number(numericValue))) {
          addError(errors, parameter, "allowedValues", `${parameter.label} is outside the allowed values.`);
        }
      } else if (!allowedValues.includes(rawValue)) {
        addError(errors, parameter, "allowedValues", `${parameter.label} is outside the allowed values.`);
      }
    }
  }

  for (const parameter of safeParameters) {
    const validation = getValidationMeta(parameter);
    if (!validation || !validation.lteField) {
      continue;
    }

    const left = comparableValues[parameter.key];
    const right = comparableValues[validation.lteField];
    if (left == null || right == null) {
      continue;
    }

    if (typeof left === "number" && typeof right === "number" && left > right) {
      const referenceLabel = parameterByKey.get(validation.lteField)?.label || validation.lteField;
      addError(
        errors,
        parameter,
        "relation.lteField",
        `${parameter.label} must be less than or equal to ${referenceLabel}.`,
        {
          lteField: validation.lteField,
        },
      );
    }
  }

  const reportingYear = normalizeYearValue(safeAnswerMap[REPORTING_YEAR_KEY]);
  const baseYear = normalizeYearValue(safeAnswerMap[BASE_YEAR_KEY]);
  const yearsDelta = reportingYear != null && baseYear != null ? reportingYear - baseYear : null;

  return {
    isValid: errors.length === 0,
    errors,
    errorsByKey: toErrorMap(errors),
    years: {
      reportingYear,
      baseYear,
    },
    yearsDelta,
    flags: {
      hasBothYears: reportingYear != null && baseYear != null,
      yearsDeltaNonNegative: yearsDelta == null || yearsDelta >= 0,
    },
  };
};

export const YEAR_VALIDATION_KEYS = {
  reportingYear: REPORTING_YEAR_KEY,
  baseYear: BASE_YEAR_KEY,
};
