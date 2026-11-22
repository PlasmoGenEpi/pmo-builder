/**
 * Plain-word labels for specimen metadata fields, shared by the Compare tab
 * and the Subset tab so the same field always has the same name on screen.
 */
import { t } from "@lingui/core/macro";

/** Plain label for a specimen metadata field, or `field` itself when it has none. */
export function specimenFieldLabel(field: string): string {
  switch (field) {
    case "collection_country":
      return t`Country`;
    case "geo_admin1":
      return t`Administrative area, level 1`;
    case "geo_admin2":
      return t`Administrative area, level 2`;
    case "geo_admin3":
      return t`Administrative area, level 3`;
    case "collection_year":
      return t`Collection year`;
    case "collection_month":
      return t`Collection month`;
    case "project":
    case "project_id":
      return t`Project`;
    case "collection_date":
      return t`Collection date`;
    case "specimen_type":
      return t`Specimen type`;
    case "specimen_collect_device":
      return t`Collection method`;
    case "specimen_store_loc":
      return t`Storage site`;
    case "host_taxon_id":
      return t`Host taxon ID`;
    case "host_age":
      return t`Host age`;
    case "host_sex":
      return t`Host sex`;
    case "gravid":
      return t`Pregnant`;
    case "gravidity":
      return t`Previous pregnancies`;
    case "blood_meal":
      return t`Recent blood meal`;
    case "has_travel_out_six_month":
      return t`Travelled in last six months`;
    case "env_broad_scale":
      return t`Broad environment`;
    case "env_local_scale":
      return t`Local environment`;
    case "env_medium":
      return t`Environment medium`;
    default:
      return field;
  }
}
