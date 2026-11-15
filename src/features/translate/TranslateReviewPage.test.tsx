import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithStore } from "@/features/shared/testing";

import type { Fetcher } from "./reviewApi";
import { TranslateReviewPage } from "./TranslateReviewPage";

const SERVICE = "https://review.test";

const CATALOG = `msgid ""
msgstr ""

#: src/app/HomePage.tsx
msgid "Start"
msgstr "Commencer"

#. {fileName} is the name of the file
#: src/app/HomePage.tsx
msgid "Saved {fileName}"
msgstr "{fileName} enregistré"

#: src/features/panel/GenomeSection.tsx
msgid "Genome"
msgstr "Génome"
`;

interface Sent {
  readonly url: string;
  readonly body: unknown;
}

function service(options: { readonly session?: number } = {}): {
  readonly fetcher: Fetcher;
  readonly sent: Sent[];
} {
  const sent: Sent[] = [];
  const fetcher = vi.fn<Fetcher>(async (url, init) => {
    if (url.endsWith(".po")) return new Response(CATALOG);
    const body: unknown = typeof init.body === "string" ? JSON.parse(init.body) : null;
    sent.push({ url, body });
    if (url.endsWith("/review/session")) {
      if (options.session !== undefined) return new Response(null, { status: options.session });
      return Response.json({
        locale: "fr",
        label: "Bamako lab",
        suggestions: [
          {
            id: 7,
            reviewer: "Jean",
            context: "",
            msgid: "Genome",
            seen: "Génome",
            verdict: "edit",
            text: "Le génome",
            at: "2026-11-14T09:00:00.000Z",
          },
        ],
      });
    }
    return Response.json({ id: sent.length + 100, at: "2026-11-15T10:00:00.000Z" });
  });
  return { fetcher, sent };
}

async function renderPage(fetcher: Fetcher, locale = "fr"): Promise<void> {
  await renderWithStore(
    <TranslateReviewPage locale={locale} reviewKey="secret" service={SERVICE} fetcher={fetcher} />,
  );
}

describe("TranslateReviewPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows the messages of the first part of the app still to check, with the link's name", async () => {
    const { fetcher, sent } = service();
    await renderPage(fetcher);
    expect(
      await screen.findByRole("heading", { name: "Review the French translation" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Review link: Bamako lab")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByText("Note: {fileName} is the name of the file")).toBeInTheDocument();
    expect(sent[0]).toEqual({
      url: `${SERVICE}/review/session`,
      body: { key: "secret", locale: "fr" },
    });
  });

  it("keeps the buttons off until the reviewer gives a name, and remembers it", async () => {
    const { fetcher } = service();
    await renderPage(fetcher);
    const [first] = await screen.findAllByRole("article");
    if (first === undefined) throw new Error("no message");
    const looksRight = within(first).getByRole("button", { name: "Looks right" });
    expect(looksRight).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Your name/), "Awa");
    expect(looksRight).toBeEnabled();
    expect(window.localStorage.getItem("pmo-builder.reviewer-name")).toBe("Awa");
  });

  it("sends an approval with the translation the reviewer saw", async () => {
    window.localStorage.setItem("pmo-builder.reviewer-name", "Awa");
    const { fetcher, sent } = service();
    await renderPage(fetcher);
    const [first] = await screen.findAllByRole("article");
    if (first === undefined) throw new Error("no message");
    await userEvent.click(within(first).getByRole("button", { name: "Looks right" }));
    expect(await within(first).findByText(/You said this looks right/)).toBeInTheDocument();
    expect(sent.at(-1)).toEqual({
      url: `${SERVICE}/review/suggest`,
      body: {
        key: "secret",
        locale: "fr",
        context: "",
        msgid: "Start",
        seen: "Commencer",
        reviewer: "Awa",
        verdict: "ok",
        text: "Commencer",
      },
    });
  });

  it("will not send a change that drops a placeholder", async () => {
    window.localStorage.setItem("pmo-builder.reviewer-name", "Awa");
    const { fetcher, sent } = service();
    await renderPage(fetcher);
    const second = (await screen.findAllByRole("article"))[1];
    if (second === undefined) throw new Error("no message");
    await userEvent.click(within(second).getByRole("button", { name: "Suggest a change" }));
    const box = within(second).getByRole("textbox");
    await userEvent.clear(box);
    await userEvent.type(box, "Enregistré");
    expect(
      within(second).getByText("Keep {fileName} exactly as in the English."),
    ).toBeInTheDocument();
    expect(within(second).getByRole("button", { name: "Send suggestion" })).toBeDisabled();

    await userEvent.type(box, " : {{fileName}");
    await userEvent.click(within(second).getByRole("button", { name: "Send suggestion" }));
    expect(await within(second).findByText(/You suggested/)).toBeInTheDocument();
    expect(sent.at(-1)?.body).toMatchObject({ verdict: "edit", text: "Enregistré : {fileName}" });
  });

  it("shows other reviewers' suggestions by name", async () => {
    const { fetcher } = service();
    await renderPage(fetcher);
    await screen.findByRole("heading", { name: "Review the French translation" });
    await userEvent.click(screen.getByRole("radio", { name: "Changes suggested" }));
    await userEvent.type(screen.getByLabelText("Search every part"), "Genome");
    expect(await screen.findByText(/Jean suggested/)).toBeInTheDocument();
    expect(screen.getByText("Le génome")).toBeInTheDocument();
  });

  it("says when the link does not work", async () => {
    const { fetcher } = service({ session: 403 });
    await renderPage(fetcher);
    expect(await screen.findByText("This review link does not work")).toBeInTheDocument();
  });

  it("offers to try again when the service cannot be reached", async () => {
    const { fetcher } = service({ session: 500 });
    await renderPage(fetcher);
    expect(await screen.findByText("The review could not be loaded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("refuses English, which is the source", async () => {
    const { fetcher } = service();
    await renderPage(fetcher, "en");
    expect(screen.getByText("There is no translation to review here")).toBeInTheDocument();
  });
});
