/* ===================================================================
   Market Impact — how a change in the exchange rate moves the 90-day
   shipping-fee forecast.

   READ THIS BEFORE CHANGING THE MATH.

   This page is an ILLUSTRATION, not a model output. It carried an
   on-screen banner saying so; that was removed on request, so this
   comment is now the only place the distinction is recorded — which is
   the reason it is written out in full rather than summarised. Here is
   exactly what is and is not known:

   What the ML pipeline actually gives us (see docs/data-schema.md):
   a single central 90-day path for fee, oil and FX. It does NOT give us
   "the fee if the exchange rate were X". The bundle carries the fitted
   `fee_model`, but the recursive multi-step procedure that turns it into
   a 90-day path — the "residual XGB + jump-aware shrink" and the damping
   flagged as `meta.oil_fx_damped_recursive` — lives only in the training
   notebook. scripts/pkl_to_json.py unpickles the bundle through a stub
   class, so we get the fitted models and none of the methods. Re-running
   the model ourselves was tried and rejected: a hand-rebuilt recursion on
   the published oil/FX paths ran to 6,445 USD/FEU against the published
   3,119, and its response to an FX shock was non-monotonic (-10% -> +2.4%,
   +5% -> -25.0%). Day 1 could not respond at all, since `Exchange_Rate_l1`
   on the first forecast day is drawn from history rather than the shocked
   path.

   What the history says about fee vs FX (2,149 days, 2018-01-09 ->
   2026-08-07), measured before writing this page:
       dln(fee) ~ dln(fx)   beta -0.106   R2 0.0005   p 0.28
       60-day changes       beta +1.994   R2 0.066
       ln levels            beta +4.336   R2 0.152   (both series non-stationary)
       Kendall tau          +0.229
   The relationship is weak, horizon-dependent and not even stable in
   sign. docs/ml-model.md agrees: FX sits in the "~6% combined" bucket
   while US/NE inflation carries ~86% of model variance. So no fitted
   elasticity would have been much more defensible than an assumed one —
   it would only have looked more official.

   Hence ELASTICITY below is an ASSUMPTION, carried over from the
   showcase mock-up. Change it freely; just don't let the page start
   claiming the model said it.

   Units: `usdEur` in the forecast payload is EUR per USD (~0.87). This
   page displays and controls USD per 1 EUR (~1.15), which is the way a
   freight analyst reads the rate and what the showcase sketch used, so
   every rate on this page is the reciprocal of the stored value. Note
   that the Executive Dashboard prints the stored 0.87 under the label
   "USD/EUR Exchange Rate" (MACRO_META.usdEur in
   exec-dashboard-panels.js) — that label is wrong for the number beneath
   it, but correcting it is a separate change to a separate page.
   =================================================================== */
(function () {
  /* Assumed, NOT fitted — see the header comment. Fee moves as
     (selected / base) ^ ELASTICITY, so 1 means proportional and higher
     values amplify. */
  const ELASTICITY = 1.8;

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const SVGNS = "http://www.w3.org/2000/svg";
  const COLOR_BASE = "#2563eb";
  /* Market convention, as on the showcase mock-up: the figure is green when
     the change is positive and red when it is negative. */
  const COLOR_UP = "#059669";
  const COLOR_DOWN = "#dc2626";

  const monthOf = (iso) => new Date(iso + "T00:00:00").getMonth();
  const fmtLongDate = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  };
  const fmtFx = (v) => v.toFixed(4);
  const fmtPct = (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2) + "%";
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

  function svgEl(tag, attrs = {}, parent = null) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function scaleLinear(domain, range) {
    const [d0, d1] = domain, [r0, r1] = range;
    return (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
  }

  /* Everything derived from the loaded forecast, recomputed whenever the
     page is opened so a newer ingest is picked up rather than cached. */
  let model = null;

  /* The forecast payload stores EUR per USD; this page works in USD per
     EUR throughout, so the inversion happens once, here. */
  function buildModel() {
    const rows = (typeof scaledData === "function" ? scaledData(FIXED_ROUTE) : [])
      .filter((r) => r && r.usdEur > 0 && r.f > 0);
    if (rows.length < 2) return null;

    const dates = rows.map((r) => r.date);
    const fees = rows.map((r) => r.f);
    const fx = rows.map((r) => 1 / r.usdEur);
    const baseFx = mean(fx);

    return {
      dates, fees, fx, baseFx,
      baseFee: mean(fees),
      /* The slider spans the exchange rate's own 90-day forecast range —
         Low and High are values the model actually projects, not
         hypothetical shocks. That range is narrow (~1.3% end to end on the
         current run), so the fee response is correspondingly small. */
      sliderMin: Math.min(...fx),
      sliderMax: Math.max(...fx),
    };
  }

  /* The whole simulation. One scalar factor from the selected rate
     against the forecast's average rate, applied to every day — so the
     scenario is the shape of the model's own forecast, re-levelled. At
     the base rate the factor is exactly 1 and the two lines coincide. */
  function simulate(selFx) {
    const factor = Math.pow(selFx / model.baseFx, ELASTICITY);
    return model.fees.map((v) => v * factor);
  }

  function setPresetActive(which) {
    document.querySelectorAll("#mi-presets .ss-gran-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.miPreset === which);
    });
  }

  /* Which preset, if any, the current rate corresponds to — so dragging
     the slider onto a preset's exact value lights it up, and dragging off
     it clears every button rather than leaving a stale one lit. */
  function presetFor(selFx) {
    const near = (a, b) => Math.abs(a - b) < 0.00005;
    if (near(selFx, model.sliderMin)) return "low";
    if (near(selFx, model.baseFx)) return "base";
    if (near(selFx, model.sliderMax)) return "high";
    return null;
  }

  /* The slider carries a 4-decimal value, which never lands exactly on the
     base rate — enough drift to render the base scenario as "+0.01%, USD 0
     per FEU more" against a forecast it is supposed to equal. Snapping a
     value that is already displaying as a preset back onto that preset's
     exact rate makes the base case an identity again, and makes ±10% mean
     exactly ±10%. */
  function snapToPreset(raw) {
    switch (presetFor(raw)) {
      case "low":  return model.sliderMin;
      case "base": return model.baseFx;
      case "high": return model.sliderMax;
      default:     return raw;
    }
  }

  function update() {
    const slider = document.getElementById("mi-slider");
    const selFx = snapToPreset(Number(slider.value));
    const sim = simulate(selFx);
    const simAvg = mean(sim);
    const pct = ((simAvg - model.baseFee) / model.baseFee) * 100;
    const perFeu = simAvg - model.baseFee;
    /* Judged on the rounded figure: a difference too small to appear in
       either number on screen should read as no change, not as an arrow
       pointing at nothing. */
    const dir = Math.round(perFeu) === 0 ? "flat" : perFeu > 0 ? "up" : "down";
    const color = dir === "up" ? COLOR_UP : dir === "down" ? COLOR_DOWN : COLOR_BASE;

    const ratePct = ((selFx - model.baseFx) / model.baseFx) * 100;
    document.getElementById("mi-kpi-rate").textContent = fmtFx(selFx);
    document.getElementById("mi-kpi-rate-note").textContent = Math.abs(ratePct) < 0.005
      ? `Matches the forecast average of ${fmtFx(model.baseFx)}`
      : `${fmtPct(ratePct)} vs forecast average of ${fmtFx(model.baseFx)}`;

    document.getElementById("mi-kpi-fee").textContent = fmt(simAvg);
    document.getElementById("mi-kpi-fee-note").textContent = `Forecast average is ${fmt(model.baseFee)}`;

    const changeEl = document.getElementById("mi-kpi-change");
    changeEl.textContent = dir === "flat" ? "No change" : fmtPct(pct);
    changeEl.style.color = color;
    document.getElementById("mi-kpi-change-note").textContent = dir === "flat"
      ? "Scenario matches the forecast"
      : `${fmt(Math.abs(perFeu))} per FEU ${dir === "up" ? "more" : "less"}, on average`;

    document.getElementById("mi-rate-value").textContent = fmtFx(selFx);
    setPresetActive(presetFor(selFx));

    document.getElementById("mi-legend").innerHTML =
      `<span><i class="line" style="background:${COLOR_BASE};opacity:.45;"></i>Model forecast</span>` +
      `<span><i class="line" style="background:${color};"></i>Scenario at ${fmtFx(selFx)}</span>`;

    drawChart(document.getElementById("mi-chart"), sim, color);
  }

  function drawChart(container, sim, simColor) {
    const width = 1000, height = 330;
    const m = { top: 18, right: 22, bottom: 30, left: 66 };
    container.innerHTML = "";
    container.style.position = "relative";

    const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, class: "ss-chart-svg" });
    container.appendChild(svg);

    const all = model.fees.concat(sim);
    const lo = Math.min(...all), hi = Math.max(...all);
    const pad = (hi - lo) * 0.14 || hi * 0.05 || 1;
    const x = scaleLinear([0, model.dates.length - 1], [m.left, width - m.right]);
    const y = scaleLinear([lo - pad, hi + pad], [height - m.bottom, m.top]);

    for (let i = 0; i <= 5; i++) {
      const v = lo - pad + ((hi + pad - (lo - pad)) * i) / 5;
      const yy = y(v);
      svgEl("line", { x1: m.left, x2: width - m.right, y1: yy, y2: yy, class: "ss-gridline" }, svg);
      svgEl("text", { x: m.left - 8, y: yy + 4, "text-anchor": "end", class: "ss-axis" }, svg)
        .textContent = "$" + Math.round(v).toLocaleString();
    }
    model.dates.forEach((iso, i) => {
      if (i === 0 || monthOf(iso) !== monthOf(model.dates[i - 1])) {
        svgEl("text", { x: x(i), y: height - 8, "text-anchor": "middle", class: "ss-axis" }, svg)
          .textContent = MONTHS[monthOf(iso)];
      }
    });

    const path = (vals) => "M " + vals.map((v, i) => `${x(i)},${y(v)}`).join(" L ");

    /* Scenario area first, so neither line is drawn over. */
    svgEl("path", {
      d: path(sim) + ` L ${x(sim.length - 1)},${height - m.bottom} L ${x(0)},${height - m.bottom} Z`,
      fill: simColor, opacity: 0.07,
    }, svg);
    svgEl("path", { d: path(model.fees), fill: "none", stroke: COLOR_BASE, "stroke-width": 2, opacity: 0.45 }, svg);
    svgEl("path", { d: path(sim), fill: "none", stroke: simColor, "stroke-width": 2.6 }, svg);

    const hoverLine = svgEl("line", {
      class: "ss-hover-line", x1: 0, x2: 0, y1: m.top, y2: height - m.bottom, style: "display:none;",
    }, svg);
    const dotBase = svgEl("circle", { r: 4.5, fill: "#fff", stroke: COLOR_BASE, "stroke-width": 2.5, style: "display:none;" }, svg);
    const dotSim = svgEl("circle", { r: 5, fill: "#fff", stroke: simColor, "stroke-width": 2.5, style: "display:none;" }, svg);
    const overlay = svgEl("rect", {
      x: m.left, y: m.top, width: width - m.left - m.right, height: height - m.top - m.bottom,
      fill: "transparent", style: "cursor:crosshair;",
    }, svg);

    const tooltip = document.createElement("div");
    tooltip.className = "ss-chart-tooltip";
    container.appendChild(tooltip);

    overlay.addEventListener("mousemove", (evt) => {
      const rect = svg.getBoundingClientRect();
      const svgX = ((evt.clientX - rect.left) / rect.width) * width;
      const ratio = (svgX - m.left) / (width - m.left - m.right);
      const idx = Math.min(model.dates.length - 1, Math.max(0, Math.round(ratio * (model.dates.length - 1))));

      hoverLine.setAttribute("x1", x(idx));
      hoverLine.setAttribute("x2", x(idx));
      hoverLine.style.display = "block";
      dotBase.setAttribute("cx", x(idx)); dotBase.setAttribute("cy", y(model.fees[idx])); dotBase.style.display = "block";
      dotSim.setAttribute("cx", x(idx)); dotSim.setAttribute("cy", y(sim[idx])); dotSim.style.display = "block";

      const delta = sim[idx] - model.fees[idx];
      const cRect = container.getBoundingClientRect();
      tooltip.style.display = "block";
      tooltip.style.left = Math.min(evt.clientX - cRect.left + 12, cRect.width - 190) + "px";
      tooltip.style.top = (evt.clientY - cRect.top - 12) + "px";
      tooltip.innerHTML =
        `<b>${fmtLongDate(model.dates[idx])}</b>` +
        `<span>Forecast ${fmt(model.fees[idx])}</span>` +
        `<span>Scenario ${fmt(sim[idx])}` +
        (Math.round(delta) === 0 ? "" : ` (${delta > 0 ? "+" : "−"}${fmt(Math.abs(delta))})`) +
        `</span>`;
    });
    overlay.addEventListener("mouseleave", () => {
      hoverLine.style.display = "none";
      dotBase.style.display = "none";
      dotSim.style.display = "none";
      tooltip.style.display = "none";
    });
  }

  function renderUnavailable(msg) {
    document.getElementById("mi-body").classList.add("hidden");
    const note = document.getElementById("mi-empty");
    note.classList.remove("hidden");
    note.textContent = msg;
  }

  function render() {
    model = buildModel();
    if (!model) {
      renderUnavailable(
        "No forecast data is loaded, so there is nothing to simulate against. " +
        "Check that a forecast snapshot has been ingested into Supabase."
      );
      return;
    }
    document.getElementById("mi-empty").classList.add("hidden");
    document.getElementById("mi-body").classList.remove("hidden");

    const slider = document.getElementById("mi-slider");
    slider.min = model.sliderMin.toFixed(4);
    slider.max = model.sliderMax.toFixed(4);
    slider.step = "0.0001";
    slider.value = model.baseFx.toFixed(4);

    document.getElementById("mi-slider-min").textContent = fmtFx(model.sliderMin);
    document.getElementById("mi-slider-max").textContent = fmtFx(model.sliderMax);
    document.getElementById("mi-horizon").textContent =
      `${fmtLongDate(model.dates[0])} – ${fmtLongDate(model.dates[model.dates.length - 1])} · ${model.dates.length} business days`;
    document.getElementById("mi-range-note").textContent =
      `Range taken from the exchange rate's own 90-day forecast: Low ${fmtFx(model.sliderMin)}, ` +
      `Base ${fmtFx(model.baseFx)} (the forecast average), High ${fmtFx(model.sliderMax)}.`;

    update();
  }

  function setRate(which) {
    const slider = document.getElementById("mi-slider");
    slider.value = (which === "low" ? model.sliderMin : which === "high" ? model.sliderMax : model.baseFx).toFixed(4);
    update();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const slider = document.getElementById("mi-slider");
    if (slider) slider.addEventListener("input", update);
    document.querySelectorAll("#mi-presets .ss-gran-btn").forEach((btn) => {
      btn.addEventListener("click", () => setRate(btn.dataset.miPreset));
    });
  });

  window.MarketImpact = { render };
})();
