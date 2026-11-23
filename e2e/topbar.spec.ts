/**
 * Top bar layout on a phone (390 px) and a laptop (1280 px): fits without
 * horizontal overflow in English, French and Portuguese on Build, My PMO file
 * and Published, keeps every control reachable, and stays single-row on desktop.
 */
import type { Locator, Page } from "@playwright/test";

import { catalogue } from "../src/features/published/testing";

import { expect, test } from "./fixtures/privacy";
import { expectNoHorizontalOverflow, requireVisibleBox } from "./support/pmoFile";

// Block the offline service worker so mocked catalogue responses always reach the page.
test.use({ serviceWorkers: "block" });

const PHONE = { width: 390, height: 844 } as const;
const TABLET_SM = { width: 640, height: 800 } as const;
const TABLET_MD = { width: 768, height: 800 } as const;
const DESKTOP = { width: 1280, height: 800 } as const;

type RouteKey = "build" | "pmo" | "published";

interface LocaleCase {
  readonly name: string;
  readonly query: string;
  readonly moreOptions: string;
  readonly startOver: string;
  readonly saveStatus: string;
  readonly saveWarning: string;
  readonly saveHeading: string;
  readonly privacy: string;
  readonly openSteps: string;
  readonly emptyPublished: string;
  readonly headings: Readonly<Record<RouteKey, string>>;
}

const LOCALES: readonly LocaleCase[] = [
  {
    name: "English",
    query: "",
    moreOptions: "More options",
    startOver: "Start over",
    saveStatus: "Draft saved",
    saveWarning: "Not kept after you close this tab",
    saveHeading: "Saved on this device",
    privacy: "Your data stays on this device",
    openSteps: "Open the step list",
    emptyPublished: "No PMO has been published yet",
    headings: {
      build: "Microhaplotypes",
      pmo: "My PMO file",
      published: "Published PMOs",
    },
  },
  {
    name: "French",
    query: "?lang=fr",
    moreOptions: "Plus d’options",
    startOver: "Recommencer",
    saveStatus: "Brouillon enregistré",
    saveWarning: "Non conservé après la fermeture de cet onglet",
    saveHeading: "Enregistré sur cet appareil",
    privacy: "Vos données restent sur cet appareil",
    openSteps: "Ouvrir la liste des étapes",
    emptyPublished: "Aucun PMO n’a encore été publié",
    headings: {
      build: "Microhaplotypes",
      pmo: "Mon fichier PMO",
      published: "PMO publiés",
    },
  },
  {
    name: "Portuguese",
    query: "?lang=pt",
    moreOptions: "Mais opções",
    startOver: "Recomeçar",
    saveStatus: "Rascunho guardado",
    saveWarning: "Não é mantido depois de fechar este separador",
    saveHeading: "Guardado neste dispositivo",
    privacy: "Os seus dados ficam neste dispositivo",
    openSteps: "Abrir a lista de etapas",
    emptyPublished: "Ainda não foi publicado nenhum PMO",
    headings: {
      build: "Micro-haplótipos",
      pmo: "O meu ficheiro PMO",
      published: "PMO publicados",
    },
  },
];

const ROUTES: readonly {
  readonly key: RouteKey;
  readonly name: string;
  readonly hash: string;
  readonly building: boolean;
}[] = [
  { key: "build", name: "Build", hash: "#/build/microhaplotypes", building: true },
  { key: "pmo", name: "My PMO file", hash: "#/pmo", building: false },
  { key: "published", name: "Published", hash: "#/published", building: false },
];

/** Serves an empty local catalogue so the Published route renders without contacting Zenodo. */
async function stubCatalogue(page: Page): Promise<void> {
  await page.context().route("**/repository/index.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(catalogue([])),
    }),
  );
}

/** Asserts that `locator` is visible and wholly inside `[0, width]`. */
async function expectHorizontalFit(options: {
  readonly locator: Locator;
  readonly width: number;
  readonly description: string;
}): Promise<void> {
  const { locator, width, description } = options;
  const box = await requireVisibleBox(locator, description);
  expect(box.x, `${description} left edge`).toBeGreaterThanOrEqual(-0.5);
  expect(box.width, `${description} width`).toBeGreaterThan(0);
  expect(box.height, `${description} height`).toBeGreaterThan(0);
  expect(box.x + box.width, `${description} right edge`).toBeLessThanOrEqual(width + 0.5);
}

for (const locale of LOCALES) {
  test(`top bar fits at 390 px in ${locale.name}`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await stubCatalogue(page);

    for (const route of ROUTES) {
      // oxlint-disable-next-line no-await-in-loop -- routes are checked one at a time.
      await page.goto(`/${locale.query}${route.hash}`);
      // oxlint-disable-next-line no-await-in-loop -- wait for the route's heading to finish loading.
      await expect(
        page.getByRole("heading", { level: 1, name: locale.headings[route.key] }),
      ).toBeVisible();
      if (route.key === "published") {
        // oxlint-disable-next-line no-await-in-loop -- verify empty catalogue renders instead of load error.
        await expect(page.getByText(locale.emptyPublished)).toBeVisible();
      }
      const header = page.getByRole("banner");
      // oxlint-disable-next-line no-await-in-loop -- wait for the top bar controls to be ready.
      await expect(header.getByRole("button", { name: locale.moreOptions })).toBeVisible();

      // oxlint-disable-next-line no-await-in-loop -- measure layout per route.
      await expectNoHorizontalOverflow(page, `${locale.name} ${route.name}`);

      // oxlint-disable-next-line no-await-in-loop -- check header bounds per route.
      await expectHorizontalFit({
        locator: header,
        width: PHONE.width,
        description: `${locale.name} ${route.name} header`,
      });

      // Every section link in the top bar stays on screen and unclipped without scrolling.
      const nav = header.getByRole("navigation");
      // oxlint-disable-next-line no-await-in-loop -- measure nav scroll width per route.
      const navOverflow = await nav.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
      expect(
        navOverflow.scrollWidth,
        `${locale.name} ${route.name}: section nav scrollWidth`,
      ).toBeLessThanOrEqual(navOverflow.clientWidth);
      const links = nav.getByRole("link");
      // oxlint-disable-next-line no-await-in-loop -- count links per route.
      const linkCount = await links.count();
      expect(linkCount, `${locale.name} ${route.name}: section link count`).toBeGreaterThanOrEqual(
        2,
      );
      for (let i = 0; i < linkCount; i += 1) {
        // oxlint-disable-next-line no-await-in-loop -- check each section link.
        await expectHorizontalFit({
          locator: links.nth(i),
          width: PHONE.width,
          description: `${locale.name} ${route.name} section link ${i}`,
        });
      }

      // Privacy control is on screen.
      const privacyButton = header.getByRole("button", { name: locale.privacy });
      // oxlint-disable-next-line no-await-in-loop -- check privacy control per route.
      await expectHorizontalFit({
        locator: privacyButton,
        width: PHONE.width,
        description: `${locale.name} ${route.name} privacy button`,
      });

      // Options menu is on screen and opens.
      const moreButton = header.getByRole("button", { name: locale.moreOptions });
      // oxlint-disable-next-line no-await-in-loop -- check options menu per route.
      await expectHorizontalFit({
        locator: moreButton,
        width: PHONE.width,
        description: `${locale.name} ${route.name} options button`,
      });
      // oxlint-disable-next-line no-await-in-loop -- open and verify menu per route.
      await moreButton.click();
      const startOverItem = page.getByRole("menuitem", { name: locale.startOver });
      // oxlint-disable-next-line no-await-in-loop -- wait for menuitem per route.
      await expectHorizontalFit({
        locator: startOverItem,
        width: PHONE.width,
        description: `${locale.name} ${route.name} Start over menu item`,
      });
      // oxlint-disable-next-line no-await-in-loop -- close menu before next check.
      await page.keyboard.press("Escape");
      // oxlint-disable-next-line no-await-in-loop -- wait for menu to finish closing.
      await expect(startOverItem).toBeHidden();

      if (route.building) {
        const stepsButton = header.getByRole("button", { name: locale.openSteps });
        // oxlint-disable-next-line no-await-in-loop -- check steps trigger on Build.
        await expectHorizontalFit({
          locator: stepsButton,
          width: PHONE.width,
          description: `${locale.name} ${route.name} steps button`,
        });

        const saveButton = header.getByRole("button", { name: locale.saveStatus });
        // oxlint-disable-next-line no-await-in-loop -- check save status on Build.
        await expectHorizontalFit({
          locator: saveButton,
          width: PHONE.width,
          description: `${locale.name} ${route.name} save status`,
        });
        // oxlint-disable-next-line no-await-in-loop -- open save status popover on Build.
        await saveButton.click();
        const saveHeading = page.getByText(locale.saveHeading);
        // oxlint-disable-next-line no-await-in-loop -- verify popover content on Build.
        await expect(saveHeading).toBeVisible();
        // oxlint-disable-next-line no-await-in-loop -- close popover before next route.
        await page.keyboard.press("Escape");
        // oxlint-disable-next-line no-await-in-loop -- wait for popover to close.
        await expect(saveHeading).toBeHidden();
      }
    }
  });

  test(`top bar fits at 640 px and 768 px in ${locale.name}, including save warnings`, async ({
    page,
  }) => {
    await stubCatalogue(page);
    // Block IndexedDB so SaveStatus enters its session-only warning state.
    await page.addInitScript(() => {
      Object.defineProperty(window, "indexedDB", {
        get() {
          throw new Error("Storage blocked");
        },
      });
    });

    for (const viewport of [TABLET_SM, TABLET_MD] as const) {
      // oxlint-disable-next-line no-await-in-loop -- viewports are checked one at a time.
      await page.setViewportSize(viewport);
      for (const route of ROUTES) {
        // oxlint-disable-next-line no-await-in-loop -- routes are checked one at a time.
        await page.goto(`/${locale.query}${route.hash}`);
        // oxlint-disable-next-line no-await-in-loop -- wait for the route's heading to load.
        await expect(
          page.getByRole("heading", { level: 1, name: locale.headings[route.key] }),
        ).toBeVisible();
        if (route.key === "published") {
          // oxlint-disable-next-line no-await-in-loop -- verify empty catalogue renders instead of load error.
          await expect(page.getByText(locale.emptyPublished)).toBeVisible();
        }
        const header = page.getByRole("banner");
        // oxlint-disable-next-line no-await-in-loop -- wait for top bar controls.
        await expect(header.getByRole("button", { name: locale.moreOptions })).toBeVisible();

        // oxlint-disable-next-line no-await-in-loop -- check document overflow.
        await expectNoHorizontalOverflow(page, `${locale.name} ${viewport.width}px ${route.name}`);

        // oxlint-disable-next-line no-await-in-loop -- check header stays inside viewport.
        await expectHorizontalFit({
          locator: header,
          width: viewport.width,
          description: `${locale.name} ${viewport.width}px ${route.name} header`,
        });

        // At 768 px (md) the top bar is single-row.
        if (viewport.width >= TABLET_MD.width) {
          // oxlint-disable-next-line no-await-in-loop -- measure single-row height at md.
          const headerBox = await requireVisibleBox(
            header,
            `${locale.name} ${viewport.width}px ${route.name} header`,
          );
          expect(
            headerBox.height,
            `${locale.name} ${viewport.width}px ${route.name} header height`,
          ).toBeLessThanOrEqual(60);
        }

        if (route.building) {
          const warningButton = header.getByRole("button", { name: locale.saveWarning });
          // oxlint-disable-next-line no-await-in-loop -- check warning button stays on screen.
          await expectHorizontalFit({
            locator: warningButton,
            width: viewport.width,
            description: `${locale.name} ${viewport.width}px save warning`,
          });
          // Warning text is visible from `sm:` (wider than an icon-only button).
          // oxlint-disable-next-line no-await-in-loop -- measure warning button width.
          const warningBox = await requireVisibleBox(
            warningButton,
            `${locale.name} ${viewport.width}px save warning`,
          );
          expect(
            warningBox.width,
            `${locale.name} ${viewport.width}px save warning text visible`,
          ).toBeGreaterThan(80);
        }
      }
    }
  });
}

test("top bar stays single-row with full labels at 1280 px", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/#/build/microhaplotypes");

  const header = page.getByRole("banner");
  const brand = header.getByRole("link", { name: "PMO Builder" });
  const nav = header.getByRole("navigation");
  const saveButton = header.getByRole("button", { name: "Draft saved" });
  const privacyButton = header.getByRole("button", { name: "Your data stays on this device" });
  const moreButton = header.getByRole("button", { name: "More options" });

  await expect(moreButton).toBeVisible();

  const headerBox = await header.boundingBox();
  expect(headerBox).not.toBeNull();
  if (headerBox === null) return;
  // Single-row top bar height matches `--spacing-topbar` (56 px).
  expect(headerBox.height).toBeLessThanOrEqual(60);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);

  // Full text labels for save status and privacy are visible (wider than icon-only buttons).
  const saveBox = await saveButton.boundingBox();
  const privacyBox = await privacyButton.boundingBox();
  const brandBox = await brand.boundingBox();
  const navBox = await nav.boundingBox();
  const moreBox = await moreButton.boundingBox();

  expect(saveBox?.width ?? 0).toBeGreaterThan(80);
  expect(privacyBox?.width ?? 0).toBeGreaterThan(150);

  // Every control sits on the same horizontal row.
  const centers = [brandBox, navBox, saveBox, privacyBox, moreBox].map((box) => {
    expect(box).not.toBeNull();
    return box === null ? 0 : box.y + box.height / 2;
  });
  const top = Math.min(...centers);
  const bottom = Math.max(...centers);
  expect(bottom - top).toBeLessThanOrEqual(4);
});
