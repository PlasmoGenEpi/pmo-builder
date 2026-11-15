import { plural, t } from "@lingui/core/macro";

import { useTheme } from "@/app/theme";
import type { TargetSummary } from "@/domain/tools/types";
import { intlLocale } from "@/i18n/languages";
import { SERIES } from "@/ui";

/** The most microhaplotypes drawn; the rest are counted. */
const MAX_BARS = 20;

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
  const sources = new Set(shown.map((allele) => allele.label.source));
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
        {shown.map((allele) => {
          const share = percent.format(allele.freq);
          const count = allele.count;
          return (
            <li
              key={allele.mhapId}
              className="grid grid-cols-[minmax(0,16rem)_1fr] items-center gap-3"
            >
              <span
                className="truncate font-mono text-xs text-text-muted"
                title={
                  allele.label.note === null ? allele.seq : `${allele.seq}\n${allele.label.note}`
                }
              >
                {allele.label.label === "" ? `#${allele.mhapId}` : allele.label.label}
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
      <div className="flex flex-col gap-1 text-xs text-text-subtle">
        {sources.has("pseudocigar") ? (
          <p>{t`Labels in the pipeline's pseudoCIGAR notation are shown as the PMO gives them.`}</p>
        ) : null}
        {sources.has("variants") ? (
          <p>{t`Labels with a chromosome position are the variants the PMO lists for that microhaplotype.`}</p>
        ) : null}
        {sources.has("alignment") ? (
          <p>
            {sources.size > 1
              ? t`Other labels give the differences from the most common microhaplotype, found by aligning the sequences: a substitution such as C12T, a deletion such as del 101–109, an insertion such as ins 140 ATT. Positions count along the most common sequence.`
              : t`Labels give the differences from the most common microhaplotype, found by aligning the sequences: a substitution such as C12T, a deletion such as del 101–109, an insertion such as ins 140 ATT. Positions count along the most common sequence.`}
          </p>
        ) : null}
        <p>
          {t`Hover over a label to see the whole sequence. Each bar is a share of the target's detections: a sample with two microhaplotypes here counts once for each.`}
        </p>
      </div>
    </figure>
  );
}
