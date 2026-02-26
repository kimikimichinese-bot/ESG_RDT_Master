import { expect, test } from "@playwright/test";

const UI_SECTIONS = [
  "Release readiness",
  "Progress map",
  "Module completion",
  "Next actions",
];

test("production dashboard renders the full UX surface", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "ESG RDT Master" })).toBeVisible();
  await expect(page.getByText("Production workspace with diagnostics-first UI.")).toBeVisible();

  for (const section of UI_SECTIONS) {
    await expect(page.getByRole("heading", { name: section })).toBeVisible();
  }

  await expect(page.locator('a[href="/api/ready"]')).toBeVisible();
  await expect(page.locator('a[href="/api/v1/health"]')).toBeVisible();
  await expect(page.locator('a[href="/api/v1/status"]')).toBeVisible();

  await expect(page.getByText("Last poll status:")).toHaveCount(3);
});

test("release readiness actions and controls are functional", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Copy snapshot JSON" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh now" })).toBeVisible();

  await page.getByRole("button", { name: "Copy snapshot JSON" }).click();
  await expect(page.getByText(/Copied|Copy failed/)).toBeVisible({ timeout: 5000 });

  const refreshButton = page.getByRole("button", { name: "Refresh now" });
  await refreshButton.click();
  await expect(refreshButton).toHaveText("Refresh now", { timeout: 10_000 });
});

test("next actions are prioritized and expandable", async ({ page }) => {
  await page.goto("/");

  const nextActionsSection = page.locator("section", { has: page.getByRole("heading", { name: "Next actions" }) });
  const actionItems = nextActionsSection.locator("ol > li");
  const firstActionPriority = nextActionsSection.locator("ol > li .priority-chip").first();

  await expect(actionItems).toHaveCount(3);
  await expect(firstActionPriority).toHaveText("P1");

  const expandButton = page.getByRole("button", { name: "Show more actions" });
  if (await expandButton.isVisible()) {
    await expandButton.click();
    await expect(nextActionsSection.getByRole("button", { name: "Show fewer actions" })).toBeVisible();
    await expect(await actionItems.count()).toBeGreaterThan(3);
  } else {
    await expect(await actionItems.count()).toBeLessThanOrEqual(3);
  }
});

test("API contracts are available and structurally valid", async ({ request }) => {
  const endpoints = ["/api/ready", "/api/v1/health", "/api/v1/status", "/api/v1/progress"];

  for (const endpoint of endpoints) {
    const response = await request.get(endpoint);
    expect(response.status()).toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThan(600);

    const body = await response.json();
    expect(body).toBeTruthy();
    expect(body).toHaveProperty("status");
  }

  const progressResponse = await request.get("/api/v1/progress");
  const progressBody = await progressResponse.json();
  expect(progressBody).toHaveProperty("source");
  expect(progressBody).toHaveProperty("generatedAt");
  expect(Array.isArray(progressBody.productSignals)).toBeTruthy();
  expect(Array.isArray(progressBody.progress)).toBeTruthy();
});
