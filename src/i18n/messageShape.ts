/**
 * What a translation must keep from its English message: the placeholders,
 * the plural and select variables, and the tags. Used by the catalog test.
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
