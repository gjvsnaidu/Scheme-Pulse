# SchemePulse

Personal government-scheme discovery and eligibility-evaluation engine.

This repository is the demo build produced for SchemePulse. It ingests two external
government-portal datasets and exposes a unified scheme catalog, eligibility
simulation, search, recommendations, document checklist and an admin data-health
view.

## Ingested datasets (committed under server/sp/data)

- `server/sp/data/govt_portal_schemes.csv` — government-portal scheme corpus used to
  populate the imported scheme catalog.
- `server/sp/data/eligibility_patterns.csv` — eligibility-pattern dataset used to derive
  data-driven rule priors.

## Validation after ingestion

Before packaging, I verified the copied CSV files are intact:

- `govt_portal_schemes.csv`: header starts with `scheme_name,slug,details,benefits,...`
- `eligibility_patterns.csv`: header starts with `Age,Annual_Income_INR,State,Category,Eligible_Scheme`

## Notes

- The audio dataset `archive (1).zip` is an Indian-language media corpus and is NOT
  part of SchemePulse. It was intentionally excluded.
- Schemes imported from the government-portal corpus are labelled as imported and flagged
  for review in the admin data-health center. They do not contain per-scheme official URLs.
- SchemePulse does not invent scheme lists for portals whose structured exports were not
  available offline (for example IPPB or Buddy4Study). Only public CSVs were ingested.
