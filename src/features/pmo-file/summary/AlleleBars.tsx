import { plural, t } from "@lingui/core/macro";

import { useTheme } from "@/app/theme";
import type { TargetSummary } from "@/domain/tools/types";
import { intlLocale } from "@/i18n/languages";
import { SERIES } from "@/ui";

/** The most microhaplotypes drawn; the rest are counted. */
const MAX_BARS = 20;

/**
 * Labels that tell microhaplotypes apart: the bases at the positions where the
 * sequences differ, as microhaplotypes are usually written. When lengths
 * differ, the length is added, since an insertion shifts every base after it.
 */
function variantLabels(sequences: readonly string[]): string[] {
  if (sequences.length === 0) return [];
  const lengths = new Set(sequences.map((seq) => seq.length));
  const shortest = Math.min(...sequences.map((seq) => seq.length));
  const positions: number[] = [];
  for (let index = 0; index < shortest; index += 1) {
    const base = sequences[0]?.[index];
    if (sequences.some((seq) => seq[index] !== base)) positions.push(index);
  }
  return sequences.map((seq) => {
    const signature = positions.map((index) => seq[index] ?? "").join("");
    const shown = signature.length > 24 ? `${signature.slice(0, 23)}…` : signature;
    return lengths.size > 1 ? `${shown} · ${seq.length} bp` : shown;
  });
}

/**
 * One target's microhaplotypes as horizontal bars: each one's share of the
 * target's detections, with its sequence and how many samples carry it.
 */
export function AlleleBars({ target }: { readonly target: TargetSummary }) {
  const { resolved } = useTheme();
  const percent = new Intl.NumberFormat(intlLocale(), {
    style: "percent",
    maximumFractionDigits: 1,
  });
  const shown = target.alleles.slice(0, MAX_BARS);
  const rest = target.alleles.length - shown.length;
  const top = shown[0]?.freq ?? 1;
  const labels = variantLabels(shown.map((allele) => allele.seq));
  const targetName = target.name;
  const sampleCount = target.samples;

  if (target.alleles.length === 0) {
    return (
      <p className="text-sm text-text-muted">{t`No microhaplotypes were counted at ${targetName}.`}</p>
    );
  }
  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="text-base font-medium break-all text-text">
        {plural(sampleCount, {
          one: `Microhaplotypes at ${targetName}, seen in # sample`,
          other: `Microhaplotypes at ${targetName}, seen in # samples`,
        })}
      </figcaption>
      <ul className="flex flex-col gap-2">
        {shown.map((allele, index) => {
          const share = percent.format(allele.freq);
          const count = allele.count;
          return (
            <li
              key={allele.mhapId}
              className="grid grid-cols-[minmax(0,12rem)_1fr] items-center gap-3"
            >
              <span className="truncate font-mono text-xs text-text-muted" title={allele.seq}>
                {allele.seq === "" || labels[index] === "" ? `#${allele.mhapId}` : labels[index]}
              </span>
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-3 rounded-r-[4px]"
                  style={{
                    width: `${Math.max(1, (allele.freq / top) * 100)}%`,
                    maxWidth: "calc(100% - 9rem)",
                    background: SERIES[resolved],
                  }}
                />
                <span className="text-sm whitespace-nowrap text-text tabular-nums">
                  {plural(count, { one: `${share} (# sample)`, other: `${share} (# samples)` })}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {rest > 0 ? (
        <p className="text-sm text-text-muted">
          {plural(rest, {
            one: "# rarer microhaplotype is not drawn.",
            other: "# rarer microhaplotypes are not drawn.",
          })}
        </p>
      ) : null}
      <p className="text-xs text-text-subtle">
        {t`Each microhaplotype is labelled by its bases where the sequences differ; hover over one to see the whole sequence. Each bar is a share of the target's detections: a sample with two microhaplotypes here counts once for each.`}
      </p>
    </figure>
  );
}
