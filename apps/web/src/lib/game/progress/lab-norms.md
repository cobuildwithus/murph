# Lab rank reference tables

The Health wins ranker uses 84 population reference tables derived from the
August 2021–August 2023 NHANES public-use files. Each row identifies the
survey file, analyte, unit, age band, sex, weighting method and unweighted
sample size. The tables cover adults aged 20 and older in six age bands per
sex. The final band combines ages 70 and above. [Bundled tables](lab-norms.json)

## Population and weights

The calculation joined laboratory observations to the cycle's demographic
records (`DEMO_L`) and excluded identified pregnant participants. The
insulin and HbA1c strata also excluded participants who reported diagnosed
diabetes (`DIQ_L`). The lipid strata include people taking lipid-lowering
medication.

| Measure | NHANES file | Variable | Survey weight |
| --- | --- | --- | --- |
| HDL cholesterol | HDL_L | LBDHDD | WTPH2YR |
| Total cholesterol | TCHOL_L | LBXTC | WTPH2YR |
| High-sensitivity CRP | HSCRP_L | LBXHSCRP | WTPH2YR |
| HbA1c | GHB_L | LBXGH | WTPH2YR |
| Triglycerides | TRIGLY_L | LBXTLG | WTSAF2YR |
| LDL cholesterol (Martin–Hopkins calculation) | TRIGLY_L | LBDLDLM | WTSAF2YR |
| Fasting insulin | INS_L | LBXIN | WTSAF2YR |

The phlebotomy weight (`WTPH2YR`) accounts for participants who gave a blood
sample. The fasting weight (`WTSAF2YR`) applies to the morning subsample.
The calculation treated near-zero SAS transport weights as zero before
selecting positive weights. Fasting questionnaire records were used to check
the subsample. Each row's source field links to its public data file.

## Percentiles and use in the app

Within each stratum, observations are sorted by value. Each percentile is
the first observed value for which the cumulative survey weight reaches the
requested fraction of total weight. This preserves ties and the precision of
the assay. All strata meet the minimum of 100 observations. The bundled cuts
are p1, p5, p10, p25, p50, p75, p90, p95 and p99.

The app uses p5 through p95 for lab comparisons because the outermost cuts
can depend on very few participants. A compatible unit and demographic
stratum are required. For a fasting reference group, a known non-fasting result
is ineligible. An unknown fasting status is disclosed on the card.

These are weighted population estimates. They include participants with a
range of health histories. Measurement methods, including insulin assays
and LDL calculations, can differ across laboratories. The source tables do
not provide confidence intervals. The reporting laboratory's reference range
is handled separately by the card engine. [Health wins engine](../../health-wins/engine/README.md)
