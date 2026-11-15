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

## How to review

- Each entry has the English, the translation, the file it comes from, and
  sometimes a note for translators (`#.` lines). Read the note first.
- Keep every placeholder in braces exactly as it is: `{fileName}`, `{count}`,
  `{0}`. They are filled in by the app. Their order may change.
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
- If a message cannot be translated well because of how it is put together,
  say so: the code can change.

A translation is checked by `src/i18n/catalogs.test.ts`, which fails if a
translation drops or invents a placeholder.

Some English words have more than one meaning in the app, and each meaning
has its own entry with a `msgctxt` line saying which it is. "Required" for a
step (étape, etapa) and for a table (tableau, tabela) are separate entries so
each can agree with its noun.

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
