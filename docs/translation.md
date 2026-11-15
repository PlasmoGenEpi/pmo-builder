# Translating PMO Builder

The interface is translated with [Lingui](https://lingui.dev). The English
text is written in the code; each language has a catalog in `src/locales/`
(`fr.po`, `pt.po`) that pairs each English message (`msgid`) with its
translation (`msgstr`). An empty `msgstr` shows the English.

French and Portuguese are drafted and need review by people who work in the
field in those languages. A language is offered to users only once it has
been reviewed (`OFFERED` in `src/i18n/languages.ts`). Until then it can be
previewed by adding `?lang=fr` or `?lang=pt` to the address, for example
`https://v2.pmotools.app/?lang=fr`.

## For reviewers

Open the review link you were sent. It looks like
`https://v2.pmotools.app/#/translate/fr/…` and works only for its language.
Keep it to yourself: anyone with it can send suggestions.

1. Enter your name. It is sent with each suggestion, so the team knows who to
   ask about it.
2. Choose a part of the app. "Open this part of the app in French" shows those
   screens in the translation, in a new tab, so you can see a message where it
   is used.
3. For each message, read the English and the translation. Choose **Looks
   right**, or **Suggest a change** and write a better wording.
4. Your progress is kept by the service: come back to the link at any time.
   Messages you and others have checked leave the "To check" list.

What reviewers send is not shown in the app straight away. The team takes the
suggestions in, checks them and publishes them with the next update.

When you suggest a change:

- Keep every placeholder in braces exactly as it is: `{fileName}`, `{count}`,
  `{0}`. They are filled in by the app. Their order may change. The page warns
  you if one is missing.
- Plural messages look like
  `{count, plural, one {# specimen} other {# specimens}}`. Translate the text
  inside each branch; keep `#`, which becomes the number. French and
  Portuguese use the `one` branch for 1 (French also for 0) and `other` for
  the rest.
- Some messages choose between variants:
  `{kind, select, file {…} other {…}}`. Translate each branch's text only.
- Tags such as `<0>link text</0>` mark a link or bold text. Keep the tags and
  translate the text between them.
- Do not translate PMO field names written in `snake_case`, column names,
  codes, file names, or the names PMO, Zenodo, DOI, BioProject, JSON.
- Some English words have more than one meaning in the app. Each meaning is
  its own message, with a line saying which it is ("Meaning here: step"), so
  that each translation can agree with its noun.
- Read the note under a message first, when there is one.
- If a message cannot be translated well because of how it is put together,
  say so in a suggestion: the code can change.

## For maintainers

Review links and suggestions are kept by the receiver Worker
(`receiver/src/review.ts`) in its D1 database. The site uses it when the
repository variable `VITE_TRANSLATION_REVIEW_URL` holds the Worker's
address. The commands below need `pnpm install` in `receiver/` once, and a
Cloudflare API token in `CLOUDFLARE_API_TOKEN` (the one the Deploy workflow
uses will do) or `wrangler login`.

```bash
pnpm translations link fr "Bamako lab"   # a new link; the address is shown only once
pnpm translations links                  # every link, with how much each has sent
pnpm translations revoke "Bamako lab"    # stop a link working; what it sent is kept
pnpm translations show [fr]              # suggestions not yet pulled, with who sent them
pnpm translations pull                   # take suggestions into src/locales/*.po
```

Give each group of reviewers its own link, so `links` and the reports show
where suggestions came from. The link's key is stored only as a hash, so a
lost link cannot be shown again: revoke it and make another.

`pull` writes the suggestions into the catalogs and prints a report: each
change with who suggested it, the approvals per reviewer, and the
suggestions it did not take. A change is taken only if the reviewer saw the
translation the catalog has now, so a suggestion never overwrites a later
fix. When reviewers disagree, the newest change is taken and the others are
listed. A change that drops a placeholder is never taken. Then:

1. Read the diff of `src/locales/`, and edit anything you disagree with.
2. Run `pnpm check`.
3. Open a pull request with the report as its description, and merge it.

`pull` marks what it read as pulled. `pull --dry-run` prints the report and
changes nothing. If you throw away a pull's changes, `pull --all` takes in
every suggestion again; ones already in the catalogs change nothing.

A translation is checked by `src/i18n/catalogs.test.ts`, which fails if a
translation drops or invents a placeholder.

## Conventions

|                              | French                                                                               | Portuguese                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Variety                      | French, formal "vous"                                                                | European and African Portuguese (Mozambique, Angola), not Brazilian. Impersonal or "você" forms, never "tu" |
| Quotation marks around names | « Nom » with non-breaking spaces inside                                              | «Nome», no spaces inside                                                                                    |
| Space before `: ; ? !`       | Non-breaking space                                                                   | None                                                                                                        |
| Table names                  | Always start with "tableau" (masculine), so articles agree: "le tableau des allèles" | Always start with "tabela" (feminine): "a tabela de alelos"                                                 |
| Dates and numbers            | Formatted by the app                                                                 | Formatted by the app                                                                                        |

## Glossary

| English                        | French                                          | Portuguese                                      |
| ------------------------------ | ----------------------------------------------- | ----------------------------------------------- |
| PMO, PMO file                  | PMO, fichier PMO                                | PMO, ficheiro PMO                               |
| Portable Microhaplotype Object | Portable Microhaplotype Object (not translated) | Portable Microhaplotype Object (not translated) |
| microhaplotype                 | microhaplotype (m.)                             | micro-haplótipo                                 |
| allele                         | allèle (m.)                                     | alelo                                           |
| allele table                   | tableau des allèles                             | tabela de alelos                                |
| panel                          | panel (m.)                                      | painel                                          |
| target                         | cible (f.)                                      | alvo                                            |
| target table                   | tableau des cibles                              | tabela de alvos                                 |
| primer (forward, reverse)      | amorce (sens, anti-sens)                        | primer (direto, reverso)                        |
| reference genome               | génome de référence                             | genoma de referência                            |
| specimen                       | spécimen (m.)                                   | espécime (m.)                                   |
| specimen table                 | tableau des spécimens                           | tabela de espécimes                             |
| library sample                 | échantillon de bibliothèque                     | amostra de biblioteca                           |
| library sample table           | tableau des échantillons de bibliothèque        | tabela de amostras de biblioteca                |
| read, reads                    | lecture, lectures                               | leitura, leituras                               |
| read count                     | nombre de lectures                              | número de leituras                              |
| read counts by stage           | nombre de lectures par étape                    | número de leituras por etapa                    |
| sequencing run                 | run de séquençage (m.)                          | corrida de sequenciação                         |
| bioinformatics run             | run bioinformatique (m.)                        | execução bioinformática                         |
| bioinformatics method          | méthode bioinformatique                         | método bioinformático                           |
| pipeline                       | pipeline (m.)                                   | pipeline (m.)                                   |
| project                        | projet                                          | projeto                                         |
| column                         | colonne                                         | coluna                                          |
| row                            | ligne                                           | linha                                           |
| table (a file of rows)         | tableau                                         | tabela                                          |
| field (of the PMO)             | champ                                           | campo                                           |
| match (a column to a field)    | associer                                        | associar                                        |
| step (of the app)              | étape                                           | etapa                                           |
| draft                          | brouillon                                       | rascunho                                        |
| Start over                     | Recommencer                                     | Recomeçar                                       |
| Download                       | Télécharger                                     | Transferir                                      |
| Upload, choose a file          | Importer, choisir un fichier                    | Carregar, escolher um ficheiro                  |
| valid, matches the PMO format  | valide, conforme au format PMO                  | válido, conforme ao formato PMO                 |
| warning                        | avertissement                                   | aviso                                           |
| Zenodo record                  | enregistrement Zenodo                           | registo Zenodo                                  |
| deposit (on Zenodo)            | déposer, dépôt                                  | depositar, depósito                             |
| community                      | communauté                                      | comunidade                                      |
| curator                        | curateur, curatrice                             | curador                                         |
| new version                    | nouvelle version                                | nova versão                                     |
| sign in                        | se connecter                                    | iniciar sessão                                  |
| author                         | auteur, autrice                                 | autor                                           |
| usage counts                   | statistiques d'utilisation                      | estatísticas de utilização                      |
| Your data stays on this device | Vos données restent sur cet appareil            | Os seus dados ficam neste dispositivo           |
| published PMOs                 | PMO publiés                                     | PMO publicados                                  |
