import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ECOVADIS_DOC_LIMIT = 55;

const QUESTION_CODE_REGEX = /\b([A-Z]{3}\d{3}[a-z]?)\b/;
const BULLET_REGEX = /^(?:[-*•●▪◦]\s+|\d+[.)]\s+|[A-Za-z][.)]\s+)/;

const THEME_BY_PREFIX = {
  GEN: "General",
  ENV: "Environment",
  LAB: "Labour & Human Rights",
  ETH: "Ethics",
  SUP: "Sustainable Procurement",
};

const DOC_TYPES = new Set(["policy", "action", "reporting", "audit", "certification", "other"]);
const SCOPE_COVERAGE = new Set(["tenant", "company", "site"]);
const ISLA_REGEX = /\bISLA(?:\s*S\.?R\.?L\.?)?\b/gi;
const AMBITO_REGEX = /\bAmbito\s*:\s*[^\n\r]+/gi;

const cleanString = (value) => (typeof value === "string" ? value.trim() : "");

const toIso = (value) => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export const normalizeScopeType = (value) => {
  const normalized = cleanString(value).toLowerCase();
  if (normalized === "group") {
    return "Group";
  }
  if (normalized === "entity") {
    return "Entity";
  }
  if (normalized === "site") {
    return "Site";
  }
  return "Group";
};

export const normalizeAssessmentStatus = (value) => {
  const normalized = cleanString(value).toLowerCase();
  if (normalized === "submitted") {
    return "submitted";
  }
  if (normalized === "ready") {
    return "ready";
  }
  return "draft";
};

export const normalizeDocType = (value) => {
  const normalized = cleanString(value).toLowerCase();
  return DOC_TYPES.has(normalized) ? normalized : null;
};

export const normalizeCoverage = (value) => {
  const normalized = cleanString(value).toLowerCase();
  return SCOPE_COVERAGE.has(normalized) ? normalized : null;
};

const toIntYear = (value) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const compactWhitespace = (value) => cleanString(value).replace(/\s+/g, " ");

const anonymizeDocText = (value) => {
  const source = String(value || "");
  return source
    .replace(AMBITO_REGEX, "Scope: Rated Company (GROUP)")
    .replace(ISLA_REGEX, "Rated Company");
};

const detectTheme = (code) => {
  const prefix = cleanString(code).slice(0, 3).toUpperCase();
  return THEME_BY_PREFIX[prefix] || "General";
};

const detectIndicator = (code) => cleanString(code).slice(0, 3).toUpperCase() || "GEN";

const hasFreeTextHint = (value) => /specificare|altro|comment|explain|describe|details?/i.test(value);

const parseOptionLine = (line) => {
  const normalized = compactWhitespace(line);
  if (!normalized) {
    return null;
  }
  if (!BULLET_REGEX.test(normalized)) {
    return null;
  }
  return normalized.replace(BULLET_REGEX, "").trim();
};

const maybeCodeFromLine = (line) => {
  const match = line.match(QUESTION_CODE_REGEX);
  return match?.[1] || null;
};

const parseRequiredFromLine = (line, fallback = false) => {
  if (/obbligatoria|mandatory|required\b/i.test(line)) {
    return true;
  }
  if (/facoltativa|optional\b/i.test(line)) {
    return false;
  }
  return fallback;
};

const sortByCode = (a, b) => {
  const aCode = cleanString(a.code);
  const bCode = cleanString(b.code);
  return aCode.localeCompare(bCode, undefined, { numeric: true, sensitivity: "base" });
};

const fallbackOptionsForQuestion = (questionText) => {
  const defaults = [
    {
      label: "Yes",
      requiresEvidence: true,
      hasFreeText: false,
    },
    {
      label: "No",
      requiresEvidence: false,
      hasFreeText: false,
    },
    {
      label: "Partially",
      requiresEvidence: true,
      hasFreeText: true,
    },
  ];

  if (/upload|attach|evidence only/i.test(questionText)) {
    return [defaults[0], defaults[2]];
  }

  return defaults;
};

export const parseEcoVadisQuestionnaireText = (inputText) => {
  const lines = String(inputText || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\u00a0/g, " ").trim())
    .filter(Boolean);

  const questions = [];
  let currentQuestion = null;
  let optionSort = 0;

  const flushCurrent = () => {
    if (!currentQuestion) {
      return;
    }

    if (currentQuestion.options.length === 0) {
      const defaults = fallbackOptionsForQuestion(currentQuestion.text);
      currentQuestion.options = defaults.map((option, index) => ({
        label: option.label,
        requiresEvidence: option.requiresEvidence,
        hasFreeText: option.hasFreeText,
        sortOrder: index,
      }));
    }

    questions.push(currentQuestion);
    currentQuestion = null;
    optionSort = 0;
  };

  for (const rawLine of lines) {
    const line = compactWhitespace(rawLine);
    const code = maybeCodeFromLine(line);

    if (code) {
      flushCurrent();

      const required = parseRequiredFromLine(line, false);
      const questionText = compactWhitespace(line.replace(code, "").replace(/^[\-:\s]+/, ""));

      currentQuestion = {
        code,
        theme: detectTheme(code),
        indicator: detectIndicator(code),
        text: questionText || code,
        required,
        sortOrder: questions.length,
        options: [],
      };
      continue;
    }

    if (!currentQuestion) {
      continue;
    }

    currentQuestion.required = parseRequiredFromLine(line, currentQuestion.required);

    const option = parseOptionLine(line);
    if (option) {
      currentQuestion.options.push({
        label: option,
        requiresEvidence: true,
        hasFreeText: hasFreeTextHint(option),
        sortOrder: optionSort,
      });
      optionSort += 1;
      continue;
    }

    if (!/obbligatoria|facoltativa|mandatory|optional/i.test(line)) {
      currentQuestion.text = compactWhitespace(`${currentQuestion.text} ${line}`);
    }
  }

  flushCurrent();

  const deduped = [];
  const seenCodes = new Set();
  for (const question of questions.sort(sortByCode)) {
    const normalizedCode = cleanString(question.code);
    if (!normalizedCode || seenCodes.has(normalizedCode)) {
      continue;
    }
    seenCodes.add(normalizedCode);
    deduped.push({
      ...question,
      sortOrder: deduped.length,
      options: question.options.map((option, index) => ({
        ...option,
        sortOrder: index,
      })),
    });
  }

  return deduped;
};

export const parseEcoVadisQuestionnaireBuffer = async (buffer) => {
  const { extractRawText } = await import("mammoth");
  const parsed = await extractRawText({ buffer });
  return parseEcoVadisQuestionnaireText(parsed.value || "");
};

const findFileRecursively = async (dir, filename, maxDepth = 5) => {
  if (maxDepth < 0) {
    return null;
  }

  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (_error) {
    return null;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
      return fullPath;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (entry.name === "node_modules" || entry.name === ".next") {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    const match = await findFileRecursively(fullPath, filename, maxDepth - 1);
    if (match) {
      return match;
    }
  }

  return null;
};

export const resolveQuestionnaireSource = async () => {
  const filename = "print-filled-questionnaire.docx";
  const currentDir = process.cwd();
  const guessedRoot = path.resolve(currentDir, "..", "..");

  const guessedPaths = [
    path.join(currentDir, filename),
    path.join(guessedRoot, filename),
    path.join(guessedRoot, "docs", filename),
    path.join(guessedRoot, "artifacts", filename),
  ];

  for (const candidate of guessedPaths) {
    try {
      const file = await readFile(candidate);
      return {
        buffer: file,
        source: candidate,
      };
    } catch (_error) {
      // Ignore unreadable guesses and continue.
    }
  }

  const recursiveMatch = await findFileRecursively(guessedRoot, filename, 6);
  if (!recursiveMatch) {
    return null;
  }

  try {
    const file = await readFile(recursiveMatch);
    return {
      buffer: file,
      source: recursiveMatch,
    };
  } catch (_error) {
    return null;
  }
};

export const normalizeAssessmentRow = (row) => ({
  id: row.id,
  tenantId: row.tenant_id,
  companyId: row.company_id,
  scopeType: row.scope_type,
  reportingYear: Number(row.reporting_year),
  status: row.status,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

export const normalizeEcoVadisEvidenceRow = (row) => ({
  id: row.id,
  tenantId: row.tenant_id,
  siteId: row.site_id,
  siteCompanyId: row.site_company_id,
  filename: row.filename,
  contentType: row.content_type,
  sizeBytes: Number(row.size_bytes ?? 0),
  issueDate: row.issue_date || null,
  docType: normalizeDocType(row.doc_type),
  scopeCoverage: normalizeCoverage(row.scope_coverage),
  isEncrypted: Boolean(row.is_encrypted),
  language: cleanString(row.language) || null,
});

const normalizeAnswerEvidenceRow = (row) => ({
  evidenceId: row.evidence_id,
  pages: cleanString(row.pages),
  comment: cleanString(row.comment) || null,
  visibility: cleanString(row.visibility).toLowerCase() === "public" ? "public" : "private",
  createdAt: toIso(row.created_at),
});

const normalizeOptionRow = (row) => ({
  id: row.id,
  tenantId: row.tenant_id,
  questionId: row.question_id,
  label: row.label,
  requiresEvidence: Boolean(row.requires_evidence),
  hasFreeText: Boolean(row.has_free_text),
  sortOrder: Number(row.sort_order ?? 0),
});

const normalizeQuestionRow = (row) => ({
  id: row.id,
  tenantId: row.tenant_id,
  assessmentId: row.assessment_id,
  code: row.code,
  theme: row.theme,
  indicator: row.indicator,
  text: row.text,
  required: Boolean(row.required),
  sortOrder: Number(row.sort_order ?? 0),
});

const normalizeAnswerRow = (row) => ({
  id: row.id,
  tenantId: row.tenant_id,
  optionId: row.option_id,
  selected: Boolean(row.selected),
  freeText: row.free_text || "",
  updatedAt: toIso(row.updated_at),
});

export const ensureQuestionnaireRows = async ({ sql, tenantId, assessmentId }) => {
  const existing = await sql`
    SELECT COUNT(*)::int AS count
    FROM ecovadis_questions
    WHERE tenant_id = ${tenantId}
      AND assessment_id = ${assessmentId}
  `;

  const count = Number(existing?.[0]?.count || 0);
  if (count > 0) {
    return count;
  }

  const defaults = [
    {
      code: "GEN300",
      theme: "General",
      indicator: "GEN",
      text: "The company has formal ESG policies and governance oversight.",
      required: true,
      options: [
        { label: "Yes, fully implemented", requiresEvidence: true, hasFreeText: false },
        { label: "Partially implemented", requiresEvidence: true, hasFreeText: true },
        { label: "Not implemented", requiresEvidence: false, hasFreeText: true },
      ],
    },
    {
      code: "ENV313",
      theme: "Environment",
      indicator: "ENV",
      text: "Environmental KPIs are measured and tracked annually.",
      required: true,
      options: [
        { label: "Comprehensive coverage", requiresEvidence: true, hasFreeText: false },
        { label: "Partial coverage", requiresEvidence: true, hasFreeText: true },
        { label: "No formal KPI tracking", requiresEvidence: false, hasFreeText: true },
      ],
    },
    {
      code: "LAB312s",
      theme: "Labour & Human Rights",
      indicator: "LAB",
      text: "The company monitors workforce indicators and corrective action plans.",
      required: true,
      options: [
        { label: "Yes", requiresEvidence: true, hasFreeText: false },
        { label: "In progress", requiresEvidence: true, hasFreeText: true },
        { label: "No", requiresEvidence: false, hasFreeText: true },
      ],
    },
  ];

  await upsertQuestionnaireFromParsed({
    sql,
    tenantId,
    assessmentId,
    questions: defaults,
  });

  return defaults.length;
};

export const upsertQuestionnaireFromParsed = async ({ sql, tenantId, assessmentId, questions }) => {
  await sql`
    DELETE FROM ecovadis_questions
    WHERE tenant_id = ${tenantId}
      AND assessment_id = ${assessmentId}
  `;

  for (const [questionIndex, question] of questions.entries()) {
    const insertedQuestions = await sql`
      INSERT INTO ecovadis_questions (
        id,
        tenant_id,
        assessment_id,
        code,
        theme,
        indicator,
        text,
        required,
        sort_order
      )
      VALUES (
        ${randomUUID()},
        ${tenantId},
        ${assessmentId},
        ${cleanString(question.code) || `Q${questionIndex + 1}`},
        ${cleanString(question.theme) || detectTheme(question.code)},
        ${cleanString(question.indicator) || detectIndicator(question.code)},
        ${compactWhitespace(question.text) || cleanString(question.code) || `Question ${questionIndex + 1}`},
        ${Boolean(question.required)},
        ${Number.isFinite(Number(question.sortOrder)) ? Number(question.sortOrder) : questionIndex}
      )
      RETURNING id
    `;

    const questionId = insertedQuestions?.[0]?.id;
    if (!questionId) {
      continue;
    }

    const options = Array.isArray(question.options) && question.options.length > 0 ? question.options : fallbackOptionsForQuestion(question.text);
    for (const [optionIndex, option] of options.entries()) {
      await sql`
        INSERT INTO ecovadis_options (
          id,
          tenant_id,
          question_id,
          label,
          requires_evidence,
          has_free_text,
          sort_order
        )
        VALUES (
          ${randomUUID()},
          ${tenantId},
          ${questionId},
          ${compactWhitespace(option.label) || `Option ${optionIndex + 1}`},
          ${option.requiresEvidence !== false},
          ${Boolean(option.hasFreeText)},
          ${Number.isFinite(Number(option.sortOrder)) ? Number(option.sortOrder) : optionIndex}
        )
      `;
    }
  }
};

export const loadAssessmentQuestionnaire = async ({ sql, tenantId, assessmentId }) => {
  const assessmentRows = await sql`
    SELECT id, tenant_id, company_id, scope_type, reporting_year, status, created_at, updated_at
    FROM ecovadis_assessments
    WHERE tenant_id = ${tenantId}
      AND id = ${assessmentId}
    LIMIT 1
  `;

  const assessment = assessmentRows?.[0] ? normalizeAssessmentRow(assessmentRows[0]) : null;
  if (!assessment) {
    return null;
  }

  await ensureQuestionnaireRows({ sql, tenantId, assessmentId });

  const questionRows = await sql`
    SELECT id, tenant_id, assessment_id, code, theme, indicator, text, required, sort_order
    FROM ecovadis_questions
    WHERE tenant_id = ${tenantId}
      AND assessment_id = ${assessmentId}
    ORDER BY sort_order ASC, code ASC
  `;

  const optionRows = await sql`
    SELECT id, tenant_id, question_id, label, requires_evidence, has_free_text, sort_order
    FROM ecovadis_options
    WHERE tenant_id = ${tenantId}
      AND question_id = ANY(${questionRows.map((row) => row.id)})
    ORDER BY sort_order ASC, label ASC
  `;

  const answerRows = await sql`
    SELECT id, tenant_id, option_id, selected, free_text, updated_at
    FROM ecovadis_answers
    WHERE tenant_id = ${tenantId}
      AND option_id = ANY(${optionRows.map((row) => row.id)})
  `;

  const answerEvidenceRows =
    answerRows.length > 0
      ? await sql`
          SELECT tenant_id, answer_id, evidence_id, pages, comment, visibility, created_at
          FROM ecovadis_answer_evidence
          WHERE tenant_id = ${tenantId}
            AND answer_id = ANY(${answerRows.map((row) => row.id)})
          ORDER BY created_at ASC
        `
      : [];

  const answerByOptionId = new Map(answerRows.map((row) => [row.option_id, normalizeAnswerRow(row)]));
  const evidenceByAnswerId = new Map();
  for (const row of answerEvidenceRows) {
    if (!evidenceByAnswerId.has(row.answer_id)) {
      evidenceByAnswerId.set(row.answer_id, []);
    }
    evidenceByAnswerId.get(row.answer_id).push(normalizeAnswerEvidenceRow(row));
  }

  const optionsByQuestionId = new Map();
  for (const row of optionRows) {
    const normalized = normalizeOptionRow(row);
    const answer = answerByOptionId.get(row.id) || null;
    const enriched = {
      ...normalized,
      answer,
      evidence: answer ? evidenceByAnswerId.get(answer.id) || [] : [],
    };

    if (!optionsByQuestionId.has(row.question_id)) {
      optionsByQuestionId.set(row.question_id, []);
    }
    optionsByQuestionId.get(row.question_id).push(enriched);
  }

  const questions = questionRows.map((row) => ({
    ...normalizeQuestionRow(row),
    options: optionsByQuestionId.get(row.id) || [],
  }));

  return {
    assessment,
    questions,
  };
};

const parseWindowYears = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

export const isEcoVadisEvidenceInScope = ({ assessment, evidence }) => {
  if (assessment.scopeType === "Group") {
    return true;
  }

  if (assessment.scopeType === "Entity") {
    if (evidence.scopeCoverage === "tenant" || evidence.scopeCoverage === "company") {
      return true;
    }
    if (evidence.siteCompanyId && evidence.siteCompanyId === assessment.companyId) {
      return true;
    }
    if (!evidence.siteId && !evidence.scopeCoverage) {
      return true;
    }
    return false;
  }

  if (assessment.scopeType === "Site") {
    if (evidence.scopeCoverage === "tenant") {
      return false;
    }
    if (evidence.siteId && evidence.siteCompanyId === assessment.companyId) {
      return true;
    }
    return false;
  }

  return true;
};

export const evaluateEcoVadisAssessment = async ({ sql, tenantId, assessmentId }) => {
  const data = await loadAssessmentQuestionnaire({ sql, tenantId, assessmentId });
  if (!data) {
    return null;
  }

  const { assessment, questions } = data;
  const missingMandatoryAnswers = [];
  const selectedMissingEvidence = [];
  const selectedMissingPages = [];

  const selectedAnswerIds = [];
  const selectedEvidenceIds = new Set();
  const requiredEvidenceByAnswerId = new Map();

  for (const question of questions) {
    const selectedOptions = question.options.filter((option) => option.answer?.selected);

    if (question.required && selectedOptions.length === 0) {
      missingMandatoryAnswers.push({
        questionId: question.id,
        code: question.code,
        text: question.text,
      });
    }

    for (const option of selectedOptions) {
      const answerId = option.answer?.id;
      if (!answerId) {
        continue;
      }

      selectedAnswerIds.push(answerId);
      const evidence = Array.isArray(option.evidence) ? option.evidence : [];
      if (option.requiresEvidence) {
        requiredEvidenceByAnswerId.set(answerId, {
          questionCode: question.code,
          questionText: question.text,
          optionLabel: option.label,
          evidence,
        });

        if (evidence.length === 0) {
          selectedMissingEvidence.push({
            answerId,
            questionCode: question.code,
            questionText: question.text,
            optionLabel: option.label,
          });
        }

        for (const item of evidence) {
          if (!cleanString(item.pages)) {
            selectedMissingPages.push({
              answerId,
              evidenceId: item.evidenceId,
              questionCode: question.code,
              optionLabel: option.label,
            });
          }
        }
      }

      for (const item of evidence) {
        selectedEvidenceIds.add(item.evidenceId);
      }
    }
  }

  const evidenceIds = [...selectedEvidenceIds];
  const evidenceRows =
    evidenceIds.length > 0
      ? await sql`
          SELECT
            e.id,
            e.tenant_id,
            e.site_id,
            s.company_id AS site_company_id,
            e.filename,
            e.content_type,
            e.size_bytes,
            e.issue_date,
            e.doc_type,
            e.scope_coverage,
            e.is_encrypted,
            e.language
          FROM evidence e
          LEFT JOIN sites s ON s.id = e.site_id
          WHERE e.tenant_id = ${tenantId}
            AND e.id = ANY(${evidenceIds})
        `
      : [];

  const normalizedEvidence = evidenceRows.map((row) => normalizeEcoVadisEvidenceRow(row));
  const evidenceById = new Map(normalizedEvidence.map((row) => [row.id, row]));

  const reportingWindowYears = parseWindowYears(process.env.ECOVADIS_REPORTING_DOC_WINDOW_YEARS, 2);
  const policyWindowYears = parseWindowYears(process.env.ECOVADIS_POLICY_DOC_WINDOW_YEARS, 5);
  const referenceDate = new Date(`${assessment.reportingYear}-12-31T23:59:59.999Z`);

  const invalidMetadata = [];
  const metadataWarnings = [];
  const outOfScopeEvidence = [];

  for (const evidenceId of evidenceIds) {
    const item = evidenceById.get(evidenceId);
    if (!item) {
      invalidMetadata.push({
        evidenceId,
        reason: "Evidence record not found in tenant scope",
      });
      continue;
    }

    if (!isEcoVadisEvidenceInScope({ assessment, evidence: item })) {
      outOfScopeEvidence.push({
        evidenceId: item.id,
        filename: item.filename,
        scopeType: assessment.scopeType,
      });
    }

    if (item.isEncrypted) {
      invalidMetadata.push({
        evidenceId: item.id,
        filename: item.filename,
        reason: "Encrypted documents are not accepted",
      });
    }

    if (!item.issueDate) {
      metadataWarnings.push({
        evidenceId: item.id,
        filename: item.filename,
        reason: "Missing issue_date; validity window check downgraded to warning",
      });
      continue;
    }

    const issueDate = new Date(`${item.issueDate}T00:00:00.000Z`);
    if (Number.isNaN(issueDate.getTime())) {
      invalidMetadata.push({
        evidenceId: item.id,
        filename: item.filename,
        reason: "Invalid issue_date format",
      });
      continue;
    }

    const ageMs = referenceDate.getTime() - issueDate.getTime();
    const ageYears = ageMs / (365.25 * 24 * 60 * 60 * 1000);

    if (item.docType === "reporting" && ageYears > reportingWindowYears) {
      invalidMetadata.push({
        evidenceId: item.id,
        filename: item.filename,
        reason: `Reporting document older than ${reportingWindowYears} years`,
      });
      continue;
    }

    if ((item.docType === "policy" || item.docType === "action") && ageYears > policyWindowYears) {
      invalidMetadata.push({
        evidenceId: item.id,
        filename: item.filename,
        reason: `Policy/action document older than ${policyWindowYears} years`,
      });
    }
  }

  const distinctEvidenceCount = evidenceIds.length;
  const overflow = Math.max(0, distinctEvidenceCount - ECOVADIS_DOC_LIMIT);

  const blockers =
    missingMandatoryAnswers.length +
    selectedMissingEvidence.length +
    selectedMissingPages.length +
    invalidMetadata.length +
    outOfScopeEvidence.length +
    overflow;

  return {
    assessment,
    questions,
    check: {
      missingMandatoryAnswers,
      selectedMissingEvidence,
      selectedMissingPages,
      invalidMetadata,
      metadataWarnings,
      outOfScopeEvidence,
      documentCap: {
        limit: ECOVADIS_DOC_LIMIT,
        distinctEvidenceCount,
        overflow,
      },
      canSubmit: blockers === 0,
      blockerCount: blockers,
    },
  };
};

export const buildEcoVadisExportJson = (evaluated) => {
  const groupedThemes = new Map();
  for (const question of evaluated.questions) {
    const theme = question.theme || "General";
    if (!groupedThemes.has(theme)) {
      groupedThemes.set(theme, []);
    }

    groupedThemes.get(theme).push({
      id: question.id,
      code: question.code,
      indicator: question.indicator,
      text: question.text,
      required: question.required,
      options: question.options.map((option) => ({
        id: option.id,
        label: option.label,
        requiresEvidence: option.requiresEvidence,
        hasFreeText: option.hasFreeText,
        selected: Boolean(option.answer?.selected),
        freeText: option.answer?.freeText || "",
        evidence: (option.evidence || []).map((item) => ({
          evidenceId: item.evidenceId,
          pages: item.pages,
          comment: item.comment,
          visibility: item.visibility,
        })),
      })),
    });
  }

  return {
    assessment: evaluated.assessment,
    check: evaluated.check,
    themes: [...groupedThemes.entries()].map(([theme, questions]) => ({
      theme,
      questions,
    })),
    exportedAt: new Date().toISOString(),
  };
};

export const buildEcoVadisDocxBuffer = async (exportJson) => {
  const { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } = await import("docx");

  const makeParagraph = (text, options = {}) =>
    new Paragraph({
      spacing: {
        after: 120,
      },
      children: [new TextRun({ text, bold: Boolean(options.bold) })],
    });

  const rows = [
    new TableRow({
      children: [
        new TableCell({ children: [makeParagraph("Code", { bold: true })] }),
        new TableCell({ children: [makeParagraph("Question", { bold: true })] }),
        new TableCell({ children: [makeParagraph("Selected answer(s)", { bold: true })] }),
        new TableCell({ children: [makeParagraph("Evidence", { bold: true })] }),
      ],
    }),
  ];

  for (const theme of exportJson.themes) {
    rows.push(
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 4,
            children: [makeParagraph(`${theme.theme}`, { bold: true })],
          }),
        ],
      }),
    );

    for (const question of theme.questions) {
      const selected = question.options.filter((option) => option.selected);
      const selectedText =
        selected.length > 0
          ? selected
              .map((option) => {
                const free = cleanString(option.freeText);
                const label = anonymizeDocText(option.label);
                const freeText = anonymizeDocText(free);
                return freeText ? `${label} (${freeText})` : label;
              })
              .join("; ")
          : "Not answered";

      const evidenceText =
        selected.length > 0
          ? selected
              .flatMap((option) => option.evidence.map((item) => `Evidence ${item.evidenceId} [pages: ${item.pages}]`))
              .join("; ") || "-"
          : "-";

      rows.push(
        new TableRow({
          children: [
            new TableCell({ children: [makeParagraph(question.code)] }),
            new TableCell({ children: [makeParagraph(anonymizeDocText(question.text))] }),
            new TableCell({ children: [makeParagraph(selectedText)] }),
            new TableCell({ children: [makeParagraph(evidenceText)] }),
          ],
        }),
      );
    }
  }

  const header = [
    makeParagraph("EcoVadis Questionnaire Summary", { bold: true }),
    makeParagraph(`Scope: Rated Company (${String(exportJson.assessment.scopeType || "GROUP").toUpperCase()})`),
    makeParagraph(`Reporting Year: ${exportJson.assessment.reportingYear}`),
    makeParagraph(`Status: ${exportJson.assessment.status}`),
    makeParagraph("Company: Rated Company"),
    makeParagraph(
      `Check & Submit blockers: ${exportJson.check.blockerCount} (canSubmit=${exportJson.check.canSubmit ? "yes" : "no"})`,
    ),
  ];

  const doc = new Document({
    sections: [
      {
        children: [
          ...header,
          new Table({
            width: {
              size: 100,
              type: WidthType.PERCENTAGE,
            },
            rows,
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const sanitizedCheckText = anonymizeDocText(JSON.stringify(exportJson));
  if (/isla/i.test(sanitizedCheckText)) {
    throw new Error("Anonymization check failed: ISLA reference found in DOCX payload");
  }

  return buffer;
};

export const normalizeVisibility = (value) => {
  return cleanString(value).toLowerCase() === "public" ? "public" : "private";
};

export const normalizePages = (value) => compactWhitespace(value);

export const isValidVisibility = (value) => value === "private" || value === "public";

export const sanitizeFilenameForDownload = (value, fallback) => {
  const normalized = cleanString(value).replace(/[^a-zA-Z0-9_.-]/g, "-");
  return normalized || fallback;
};

export const currentModuleDir = () => path.dirname(fileURLToPath(import.meta.url));
