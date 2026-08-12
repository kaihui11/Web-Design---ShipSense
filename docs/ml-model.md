# ML Model — XGBoost Forecast Pipeline

Full training pipeline: an XGBoost training notebook run in Google Colab (maintained externally, not tracked in this repo).

---

## Target Variable

**`Forecasted Ocean Freight Cost`** — daily market rate in USD per 40ft container (FEU) on the North Europe → US East Coast lane.

Raw data source: **Xeneta XSI-C index, XSICNEUE lane** (`xsi_c_ne_usec`). This is a spot market rate, not a contract rate. All outputs are per FEU — no unit conversion needed in the frontend.

---

## Feature Importance

XGBoost gain-based importance scores (business drivers only — freight cost lags excluded to avoid target leakage):

| Rank | Feature | Importance | Interpretation |
|---|---|---|---|
| 1 | Inflation Rate — United States | **47.8%** | US inflation expectations drive freight via fuel, labor, and demand |
| 2 | Inflation Rate — Northern Europe | **38.3%** | EU supply chain costs and carrier pricing |
| 3 | GDP Growth — Northern Europe | 4.8% | Origin-side demand volume signal |
| 4 | GDP Growth — United States | 2.8% | Destination-side import demand |
| 5+ | Crude Oil WTI, USD/EUR FX, GPR Index, Trade Policy Uncertainty | ~6% combined | Secondary drivers; critical for shock scenarios |

Inflation on both legs explains ~86% of model variance. This is a macro-driven rate model, not a supply-side capacity model. Sudden disruptions (port strikes, Suez closure) are not captured unless encoded as shock dummies.

---

## Model Architecture

- **Algorithm:** XGBoost regression
- **Task:** Time-series regression (daily rate prediction)
- **Train/test split:** Walk-forward (chronological, no future leakage)
- **Features:** Rolling means and lag features constructed from macro time-series inputs
- **Outputs per row:**
  - `Forecasted Ocean Freight Cost` — central forecast
  - `Best Case Freight Cost` — lower bound (~3% below central)
  - `Worst Case Freight Cost` — upper bound (~8% above central)

---

## Shock Detection & Risk Classification

Shock events are encoded as binary dummy variables alongside the macro features:

| Column | Description |
|---|---|
| `shock_dummy` | 1 = shock active, 0 = normal |
| `shock_type` | `Normal`, `Fuel Shock`, `War + Geopolitical Tension`, `Trade Policy Changes`, `Currency Shock` |
| `shock_severity` | Ordinal 0–5 (0 = none, 5 = extreme) |
| `oil_shock_dummy` | Oil price shock flag |
| `fx_shock_dummy` | Currency/FX shock flag |
| `gpr_shock_dummy` | Geopolitical risk shock flag |
| `trade_policy_shock_dummy` | Trade policy disruption flag |
| `supply_chain_shock_dummy` | Supply chain disruption flag |
| `post_shock_window` | 1 = within recovery period after a shock |
| `External Shock Risk Score` | Composite 0–100 score aggregating active shock severity |

**Risk Level** is derived from the composite score:

| Score | Risk Level |
|---|---|
| 0 | Low — no active shocks |
| 1–49 | Medium — minor disruption or early warning |
| 50–79 | High — active shock, elevated rates expected |
| 80–100 | Extreme — severe multi-factor shock event |

> Current 90-day forecast (Jun–Sep 2026): all rows are `Low / score 0` — no shocks modelled in the baseline run. Shock scenarios are handled separately via scenario simulation.

---

## Vine Copula Dependency Analysis

The notebook runs a **Vine Copula** analysis to quantify how macro variables co-move during stress periods. A copula captures joint dependency independently of individual distributions. The C-Vine structure uses Ocean Freight Cost as the root node.

Output: Kendall's tau (τ) for each variable pair across market regimes (not tracked in this repo — analysis-only, not ingested by any pipeline).

Key findings:

| Variable Pair | Kendall τ | Interpretation |
|---|---|---|
| US Inflation ↔ EU Inflation | **0.885** | Near-perfect concordance — both sides move together |
| Crude Oil ↔ EU Inflation | 0.586 | Oil price transmits into European consumer prices |
| Crude Oil ↔ US Inflation | 0.519 | Same mechanism on the US side |

**Implication for freight:** When one shock factor rises, others tend to follow. A geopolitical spike in oil feeds through to inflation on both sides, compounding the freight rate impact. The copula quantifies this compounding — informing the scenario simulation.

---

## Scenario Simulation

`shipsense_scenario_simulation.csv` — what-if shock scenarios holding all other variables at baseline:

| Scenario | Predicted Rate (USD/FEU) | Risk Level | vs Base Case |
|---|---|---|---|
| Base Case (no shock) | 2,304.91 | Low | — |
| Fuel Shock | 2,327.25 | High | +0.97% |
| War / Geopolitical Shock | 2,601.19 | Extreme | +12.85% |
| Trade Policy Shock | 2,554.98 | Extreme | +10.85% |
| Currency Shock | 2,296.42 | High | −0.37% |
| Combined Shock | 2,447.00 | Extreme | +6.17% |

Post-shock recovery scenarios model gradual rate normalization in months 1–3 after a shock resolves. These scenarios are not yet integrated into the frontend — intended for executive briefings and future dashboard expansion.

---

## Notebook Phases

| Phase | Description |
|---|---|
| 0 | Install libraries and imports |
| 1 | Upload datasets (Google Colab file upload) |
| 2–6 | EDA, shock event labelling, dependency period classification |
| 7–10 | Feature engineering, model training, validation |
| 11 | Business driver importance (leakage-free model) |
| 12 | Scenario simulation |
| 13 | 90-day daily forecast generation |
| 14 | Export CSVs (analysis/reference outputs, e.g. the copula table) |
| 15 | Export `shipsense_website_bundle.pkl` for ingestion via `scripts/pkl_to_json.py` |
