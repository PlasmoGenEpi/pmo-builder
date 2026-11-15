/**
 * What a translation must keep from its English message: the placeholders,
 * the plural and select variables, and the tags. Used by the catalog test,
 * the translation review page and the command that pulls its suggestions.
 */
import { parse, type Token } from "@messageformat/parser";

/** The parts of a message a translation has to keep. */
export interface MessageShape {
  /** Placeholder names, with `:plural` or `:select` for those that choose a form. */
  readonly variables: readonly string[];
  /** Tag numbers, such as `0` for `<0>…</0>`, each time they appear. */
  readonly tags: readonly string[];
  /** Whether every plural branch that uses `#` in English can use it here. */
  readonly octothorpe: boolean;
}

const TAG = /<\/?(\d+)\s*\/?>/g;

function walk(
  tokens: readonly Token[],
  variables: Set<string>,
  tags: string[],
  hash: { found: boolean },
): void {
  for (const token of tokens) {
    if (token.type === "content") {
      for (const match of token.value.matchAll(TAG)) tags.push(match[1] ?? "");
    } else if (token.type === "argument") {
      variables.add(token.arg);
    } else if (token.type === "octothorpe") {
      hash.found = true;
    } else if (
      token.type === "plural" ||
      token.type === "select" ||
      token.type === "selectordinal"
    ) {
      variables.add(`${token.arg}:${token.type}`);
      for (const branch of token.cases) walk(branch.tokens, variables, tags, hash);
    } else if (token.type === "function") {
      variables.add(`${token.arg}:${token.key}`);
    }
  }
}

/** Reads a message's shape. Throws when the message is not valid ICU. */
export function messageShape(message: string): MessageShape {
  const variables = new Set<string>();
  const tags: string[] = [];
  const hash = { found: false };
  walk(parse(message), variables, tags, hash);
  return { variables: [...variables].toSorted(), tags: tags.toSorted(), octothorpe: hash.found };
}

/** Placeholder names as a translator sees them: `{count}`, not `count:plural`. */
function shown(names: readonly string[]): string {
  return names.map((name) => `{${name.split(":")[0] ?? name}}`).join(", ");
}

/**
 * What is wrong with a translation of `english`, as a sentence for the person
 * who wrote it, or `null` when it keeps everything it must. An empty
 * translation is fine: the app shows the English.
 */
export function translationProblem(english: string, translation: string): string | null {
  if (translation.trim() === "") return null;
  let target: MessageShape;
  try {
    target = messageShape(translation);
  } catch {
    return "The braces { } do not pair up. Check each placeholder and each plural.";
  }
  const source = messageShape(english);
  const missing = source.variables.filter((name) => !target.variables.includes(name));
  const extra = target.variables.filter((name) => !source.variables.includes(name));
  if (missing.length > 0) return `Keep ${shown(missing)} exactly as in the English.`;
  if (extra.length > 0) return `${shown(extra)} is not in the English. Use only its placeholders.`;
  if (source.tags.join() !== target.tags.join())
    return "Keep each <0>…</0> tag of the English, around the words they mark.";
  if (source.octothorpe && !target.octothorpe)
    return "Keep the # in each plural form: it is replaced by the number.";
  return null;
}
