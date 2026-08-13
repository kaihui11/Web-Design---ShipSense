/* ===================================================================
   Executive Dashboard — Forecast / Historical Data tabs.

   Row shape used throughout (from frontend/exec-data.js):
     { date, shipping_fee, wti, usdEur, gdpOrigin, gdpDestination, inflationOrigin, inflationDestination }
   Origin (North Europe) and destination (US) GDP/inflation are shown as
   separate series rather than averaged — see exec-data.js's header comment.

   Forecast tab owns the single unified `selectedISD` state (shared with
   the New Forecast page via ExecData.getSelectedISD/setSelectedISD).
   Historical tab is fully independent. Both lazy-init once via
   window.ExecPanels.onTabShown(tab), re-rendering every time their tab
   becomes visible so a fresh ISD picked on New Forecast is reflected.
   =================================================================== */
(function () {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthOf = (iso) => new Date(iso + "T00:00:00").getMonth();
  const yearOf = (iso) => new Date(iso + "T00:00:00").getFullYear();
  const dayOfWeek = (iso) => new Date(iso + "T00:00:00").getDay(); // 0=Sun..6=Sat
  const dateNum = (iso) => new Date(iso + "T00:00:00").getDate();
  // Local-time arithmetic (matches dayOfWeek/dateNum/monthOf above, which
  // also read local getters off a "T00:00:00"-local Date) — formatting via
  // getFullYear/Month/Date instead of toISOString avoids the UTC-conversion
  // day-shift toISOString would introduce in timezones ahead of UTC.
  const addDaysISO = (iso, n) => {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + n);
    const pad = (v) => String(v).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const fmtMonthDay = (iso) => { const d = new Date(iso + "T00:00:00"); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
  const fmtMonthDayYear = (iso) => { const d = new Date(iso + "T00:00:00"); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
  const fmtMoney = (v) => v == null ? "—" : "$" + Math.round(v).toLocaleString();

  const SVGNS = "http://www.w3.org/2000/svg";
  function el(tag, attrs = {}, parent = null) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function scaleLinear(domain, range) {
    const [d0, d1] = domain, [r0, r1] = range;
    return (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
  }

  // ---------------------------------------------------------------------
  // Macro variable registry — shared by both tabs' slicers/tables/charts.
  // ---------------------------------------------------------------------
  const MACRO_META = {
    fee:                  { label: "Shipping Fee",                  color: "#2563eb", unit: "usd0",  unitDesc: "USD" },
    wti:                  { label: "Crude Oil (WTI)",                color: "#9B59F6", unit: "usd2",  unitDesc: "USD per barrel" },
    usdEur:               { label: "USD/EUR Exchange Rate",          color: "#16B8C4", unit: "rate4", unitDesc: "EUR per 1 USD" },
    gdpOrigin:            { label: "Origin GDP Growth",              color: "#059669", unit: "pct2",  unitDesc: "North Europe, year-over-year, %" },
    gdpDestination:       { label: "Destination GDP Growth",         color: "#0d9488", unit: "pct2",  unitDesc: "US, year-over-year, %" },
    inflationOrigin:      { label: "Origin Inflation Rate",          color: "#d97706", unit: "pct2",  unitDesc: "North Europe, year-over-year, %" },
    inflationDestination: { label: "Destination Inflation Rate",     color: "#dc2626", unit: "pct2",  unitDesc: "US, year-over-year, %" },
  };
  const SLICER_OPTIONS = [
    { key: "all", label: "All Variables" },
    { key: "fee", label: "Shipping Fee" },
    { key: "wti", label: "Crude Oil (WTI)" },
    { key: "usdEur", label: "USD/EUR Exchange Rate" },
    { key: "gdpOrigin", label: "Origin GDP Growth" },
    { key: "gdpDestination", label: "Destination GDP Growth" },
    { key: "inflationOrigin", label: "Origin Inflation Rate" },
    { key: "inflationDestination", label: "Destination Inflation Rate" },
  ];
  function fmtMacro(key, v) {
    if (v == null || Number.isNaN(v)) return "—";
    switch (MACRO_META[key].unit) {
      case "usd0": return "$" + Math.round(v).toLocaleString();
      case "usd2": return "USD " + v.toFixed(2);
      case "rate4": return v.toFixed(4);
      case "pct2": return v.toFixed(2) + "%";
      case "idx2": return v.toFixed(2);
      default: return String(v);
    }
  }

  // ---------------------------------------------------------------------
  // Single-variable trend chart (Macro Variable Trend / Historical Trend
  // when one variable is selected) — hover crosshair + exact-value tooltip.
  // ---------------------------------------------------------------------
  function renderMacroTrendChart(container, { labels, values, color, formatValue, tickInterval, tooltipLabels, width = 1000, height = 300 }) {
    container.innerHTML = "";
    container.style.position = "relative";
    if (!values.length) { container.innerHTML = '<p style="color:var(--text-soft);font-size:13px;">No data available.</p>'; return; }
    const m = { top: 34, right: 20, bottom: 28, left: 62 };
    const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, class: "ss-chart-svg" });
    container.appendChild(svg);

    const dataMin = Math.min(...values), dataMax = Math.max(...values);
    const pad = (dataMax - dataMin) * 0.12 || Math.abs(dataMax) * 0.05 || 1;
    const yMin = dataMin - pad, yMax = dataMax + pad;
    const x = scaleLinear([0, labels.length - 1], [m.left, width - m.right]);
    const y = scaleLinear([yMin, yMax], [height - m.bottom, m.top]);

    for (let i = 0; i <= 5; i++) {
      const v = yMin + ((yMax - yMin) * i) / 5;
      const yy = y(v);
      el("line", { x1: m.left, x2: width - m.right, y1: yy, y2: yy, class: "ss-gridline" }, svg);
      el("text", { x: m.left - 8, y: yy + 4, "text-anchor": "end", class: "ss-axis" }, svg).textContent = formatValue(v);
    }
    if (tickInterval === "year") {
      let lastYearLabel = null;
      labels.forEach((iso, i) => {
        const isYearStart = i === 0 || yearOf(iso) !== yearOf(labels[i - 1]);
        const isLast = i === labels.length - 1;
        if (isYearStart || (isLast && yearOf(iso) !== lastYearLabel)) {
          el("text", { x: x(i), y: height - 8, "text-anchor": "middle", class: "ss-axis" }, svg).textContent = String(yearOf(iso));
          lastYearLabel = yearOf(iso);
        }
      });
    } else {
      let lastMonthLabelX = -Infinity;
      labels.forEach((iso, i) => {
        const isMonthStart = i === 0 || monthOf(iso) !== monthOf(labels[i - 1]);
        const isLast = i === labels.length - 1;
        if (isMonthStart || (isLast && x(i) - lastMonthLabelX > 24)) {
          el("text", { x: x(i), y: height - 8, "text-anchor": "middle", class: "ss-axis" }, svg).textContent = MONTHS[monthOf(iso)];
          lastMonthLabelX = x(i);
        }
      });
    }

    const d = "M " + values.map((v, i) => `${x(i)},${y(v)}`).join(" L ");
    el("path", { d, fill: "none", stroke: color, "stroke-width": 2.2 }, svg);

    const lastIdx = values.length - 1;
    const cx = x(lastIdx), cy = y(values[lastIdx]);
    el("circle", { cx, cy, r: 6, fill: "#fff", stroke: color, "stroke-width": 3 }, svg);
    const labelY = Math.max(m.top - 12, cy - 14);
    el("text", { x: cx, y: labelY, "text-anchor": "end", style: `font-size:10.5px;font-weight:700;fill:${color}` }, svg)
      .textContent = "Latest: " + formatValue(values[lastIdx]);

    const hoverLine = el("line", { class: "ss-hover-line", x1: 0, x2: 0, y1: m.top, y2: height - m.bottom, style: "display:none;" }, svg);
    const overlay = el("rect", {
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
      const idx = Math.min(labels.length - 1, Math.max(0, Math.round(ratio * (labels.length - 1))));
      const cx2 = x(idx), cy2 = y(values[idx]);

      hoverLine.setAttribute("x1", cx2);
      hoverLine.setAttribute("x2", cx2);
      hoverLine.style.display = "block";

      const containerRect = container.getBoundingClientRect();
      tooltip.style.display = "block";
      tooltip.style.left = Math.min(evt.clientX - containerRect.left + 12, containerRect.width - 150) + "px";
      tooltip.style.top = (evt.clientY - containerRect.top - 12) + "px";
      const dateLabel = tooltipLabels ? tooltipLabels[idx] : fmtMonthDayYear(labels[idx]);
      tooltip.innerHTML = `<b>${dateLabel}</b><span>${formatValue(values[idx])}</span>`;
    });
    overlay.addEventListener("mouseleave", () => {
      hoverLine.style.display = "none";
      tooltip.style.display = "none";
    });
  }

  // ---------------------------------------------------------------------
  // "All Variables" normalized-index chart (base = 100).
  // ---------------------------------------------------------------------
  function renderAllVariablesChart(container, { labels, seriesMap, tickInterval, tooltipLabels, width = 1000, height = 320 }) {
    container.innerHTML = "";
    container.style.position = "relative";
    if (!labels.length) { container.innerHTML = '<p style="color:var(--text-soft);font-size:13px;">No data available.</p>'; return; }
    const m = { top: 16, right: 20, bottom: 28, left: 50 };
    const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, class: "ss-chart-svg" });
    container.appendChild(svg);
    const allVals = Object.values(seriesMap).flatMap((s) => s.data);
    const yMin = Math.min(...allVals), yMax = Math.max(...allVals);
    const pad = (yMax - yMin) * 0.08 || 5;
    const x = scaleLinear([0, labels.length - 1], [m.left, width - m.right]);
    const y = scaleLinear([yMin - pad, yMax + pad], [height - m.bottom, m.top]);

    for (let i = 0; i <= 5; i++) {
      const v = yMin - pad + ((yMax + pad - (yMin - pad)) * i) / 5;
      const yy = y(v);
      el("line", { x1: m.left, x2: width - m.right, y1: yy, y2: yy, class: "ss-gridline" }, svg);
      el("text", { x: m.left - 8, y: yy + 4, "text-anchor": "end", class: "ss-axis" }, svg).textContent = v.toFixed(0);
    }
    if (tickInterval === "year") {
      let lastYearLabel = null;
      labels.forEach((iso, i) => {
        const isYearStart = i === 0 || yearOf(iso) !== yearOf(labels[i - 1]);
        const isLast = i === labels.length - 1;
        if (isYearStart || (isLast && yearOf(iso) !== lastYearLabel)) {
          el("text", { x: x(i), y: height - 8, "text-anchor": "middle", class: "ss-axis" }, svg).textContent = String(yearOf(iso));
          lastYearLabel = yearOf(iso);
        }
      });
    } else {
      let lastMonthLabelX = -Infinity;
      labels.forEach((iso, i) => {
        const isMonthStart = i === 0 || monthOf(iso) !== monthOf(labels[i - 1]);
        const isLast = i === labels.length - 1;
        if (isMonthStart || (isLast && x(i) - lastMonthLabelX > 24)) {
          el("text", { x: x(i), y: height - 8, "text-anchor": "middle", class: "ss-axis" }, svg).textContent = MONTHS[monthOf(iso)];
          lastMonthLabelX = x(i);
        }
      });
    }

    Object.entries(seriesMap).forEach(([name, s]) => {
      const d = "M " + s.data.map((v, i) => `${x(i)},${y(v)}`).join(" L ");
      el("path", { d, fill: "none", stroke: s.color, "stroke-width": name === "Shipping Fee" ? 2.6 : 1.6 }, svg);
      const lastIdx = s.data.length - 1;
      el("circle", { cx: x(lastIdx), cy: y(s.data[lastIdx]), r: 4, fill: "#fff", stroke: s.color, "stroke-width": 2 }, svg);
    });

    const hoverLine = el("line", { class: "ss-hover-line", x1: 0, x2: 0, y1: m.top, y2: height - m.bottom, style: "display:none;" }, svg);
    const overlay = el("rect", {
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
      const idx = Math.min(labels.length - 1, Math.max(0, Math.round(ratio * (labels.length - 1))));
      hoverLine.setAttribute("x1", x(idx));
      hoverLine.setAttribute("x2", x(idx));
      hoverLine.style.display = "block";

      const containerRect = container.getBoundingClientRect();
      tooltip.style.display = "block";
      tooltip.style.left = Math.min(evt.clientX - containerRect.left + 12, containerRect.width - 190) + "px";
      tooltip.style.top = (evt.clientY - containerRect.top - 12) + "px";
      const rows = Object.entries(seriesMap)
        .map(([name, s]) => `<span style="color:${s.color}">${name}: ${s.data[idx].toFixed(1)}</span>`)
        .join("");
      const dateLabel = tooltipLabels ? tooltipLabels[idx] : fmtMonthDayYear(labels[idx]);
      tooltip.innerHTML = `<b>${dateLabel}</b>${rows}`;
    });
    overlay.addEventListener("mouseleave", () => {
      hoverLine.style.display = "none";
      tooltip.style.display = "none";
    });
  }

  // ---------------------------------------------------------------------
  // Forecast tab — Shipping Cost Trend & Forecast chart. Solid = historical,
  // dashed = forecast; Y-axis fixed step of 100; month-only X labels;
  // optional shaded lowest/highest-window bands (Default State) or
  // Selected/Lowest markers (ISD-Selected State); exact-value tooltip.
  // ---------------------------------------------------------------------
  function renderForecastTrendChart(container, { rows, historicalCount = 0, bands = [], markers = [], width = 1000, height = 300 }) {
    container.innerHTML = "";
    container.style.position = "relative";
    if (!rows.length) { container.innerHTML = '<p style="color:var(--text-soft);font-size:13px;">No data available.</p>'; return; }
    const m = { top: 20, right: 20, bottom: 28, left: 60 };
    const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, class: "ss-chart-svg" });
    container.appendChild(svg);

    const fees = rows.map((r) => r.shipping_fee);
    const dataMin = Math.min(...fees), dataMax = Math.max(...fees);
    const yMin = Math.floor(dataMin / 100) * 100;
    const yMaxRaw = Math.ceil(dataMax / 100) * 100;
    const yMax = yMaxRaw === yMin ? yMin + 100 : yMaxRaw;
    const x = scaleLinear([0, rows.length - 1], [m.left, width - m.right]);
    const y = scaleLinear([yMin, yMax], [height - m.bottom, m.top]);

    const stepCount = Math.round((yMax - yMin) / 100);
    for (let i = 0; i <= stepCount; i++) {
      const v = yMin + i * 100;
      const yy = y(v);
      el("line", { x1: m.left, x2: width - m.right, y1: yy, y2: yy, class: "ss-gridline" }, svg);
      el("text", { x: m.left - 8, y: yy + 4, "text-anchor": "end", class: "ss-axis" }, svg).textContent = v.toLocaleString();
    }
    let lastMonthLabelX = -Infinity;
    rows.forEach((r, i) => {
      const isMonthStart = i === 0 || monthOf(r.date) !== monthOf(rows[i - 1].date);
      const isLast = i === rows.length - 1;
      // Always show real month-start ticks; only show the forced last-point
      // tick if it won't overlap the previous label (e.g. forecast ends
      // partway through the same month as the last month-start tick).
      if (isMonthStart || (isLast && x(i) - lastMonthLabelX > 24)) {
        el("text", { x: x(i), y: height - 8, "text-anchor": "middle", class: "ss-axis" }, svg).textContent = MONTHS[monthOf(r.date)];
        lastMonthLabelX = x(i);
      }
    });

    // Shaded lowest/highest-window bands (Default State only)
    bands.forEach((b) => {
      el("rect", {
        x: x(b.startIdx), y: m.top, width: Math.max(1, x(b.endIdx) - x(b.startIdx)), height: height - m.top - m.bottom,
        fill: b.color, "fill-opacity": 0.14,
      }, svg);
    });

    // Solid (historical) + dashed (forecast) segments, joined at the seam
    // so the line reads as one continuous series.
    if (historicalCount > 0 && historicalCount < rows.length) {
      const histPts = rows.slice(0, historicalCount);
      const dHist = "M " + histPts.map((r, i) => `${x(i)},${y(r.shipping_fee)}`).join(" L ");
      el("path", { d: dHist, fill: "none", stroke: "#2563eb", "stroke-width": 2.2 }, svg);

      const dFc = "M " + rows.slice(historicalCount - 1).map((r, i) => `${x(historicalCount - 1 + i)},${y(r.shipping_fee)}`).join(" L ");
      el("path", { d: dFc, fill: "none", stroke: "#2563eb", "stroke-width": 2.2, "stroke-dasharray": "6,4" }, svg);
    } else {
      const dashed = historicalCount === 0;
      const d = "M " + rows.map((r, i) => `${x(i)},${y(r.shipping_fee)}`).join(" L ");
      const attrs = { d, fill: "none", stroke: "#2563eb", "stroke-width": 2.2 };
      if (dashed) attrs["stroke-dasharray"] = "6,4";
      el("path", attrs, svg);
    }

    markers.forEach((mk) => {
      const cx = x(mk.index), cy = y(rows[mk.index].shipping_fee);
      el("circle", { cx, cy, r: 6, fill: "#fff", stroke: mk.color, "stroke-width": 3 }, svg);
      const nearLeft = mk.index < rows.length * 0.08;
      const nearRight = mk.index > rows.length * 0.92;
      const anchor = nearLeft ? "start" : nearRight ? "end" : "middle";
      el("text", {
        x: cx, y: mk.labelAbove ? cy - 12 : cy + 20, "text-anchor": anchor,
        style: `font-size:10.5px;font-weight:700;fill:${mk.color}`,
      }, svg).textContent = mk.label;
    });

    const hoverLine = el("line", { class: "ss-hover-line", x1: 0, x2: 0, y1: m.top, y2: height - m.bottom, style: "display:none;" }, svg);
    const overlay = el("rect", {
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
      const idx = Math.min(rows.length - 1, Math.max(0, Math.round(ratio * (rows.length - 1))));
      hoverLine.setAttribute("x1", x(idx));
      hoverLine.setAttribute("x2", x(idx));
      hoverLine.style.display = "block";
      const containerRect = container.getBoundingClientRect();
      tooltip.style.display = "block";
      tooltip.style.left = Math.min(evt.clientX - containerRect.left + 12, containerRect.width - 150) + "px";
      tooltip.style.top = (evt.clientY - containerRect.top - 12) + "px";
      tooltip.innerHTML = `<b>${fmtMonthDayYear(rows[idx].date)}</b><span>${fmtMoney(rows[idx].shipping_fee)}</span>`;
    });
    overlay.addEventListener("mouseleave", () => { hoverLine.style.display = "none"; tooltip.style.display = "none"; });
  }

  // ---------------------------------------------------------------------
  // Literal Sun–Sat month-grid Shipping Fee Calendar (Forecast tab).
  // ---------------------------------------------------------------------
  function renderFeeCalendar(container, { rows, markers = {}, bands = {} }) {
    if (!rows.length) { container.innerHTML = '<p style="color:var(--text-soft);font-size:13px;">No data available.</p>'; return; }
    const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let html = '<div class="ss-fee-cal">';
    html += '<div class="ss-fee-cal-header"><div class="ss-fee-cal-wklabel"></div>' + dows.map((d) => `<div class="ss-fee-cal-dow">${d}</div>`).join("") + "</div>";

    // Rows are business days only (no Sat/Sun, and possibly gaps for
    // holidays), so they can't just be dropped 7-per-row into the grid —
    // that silently drifts the weekday alignment after the first gap.
    // Instead walk every real calendar day from the Sunday on/before the
    // first row to the Saturday on/after the last row, placing each row
    // by its actual date and leaving a blank cell wherever there's no
    // forecast for that day (always true for Sat/Sun).
    const byDate = new Map(rows.map((r) => [r.date, r]));
    const rangeStart = addDaysISO(rows[0].date, -dayOfWeek(rows[0].date));
    const lastDate = rows[rows.length - 1].date;
    const rangeEnd = addDaysISO(lastDate, 6 - dayOfWeek(lastDate));

    const weeks = [];
    let cur = [];
    for (let d = rangeStart; ; d = addDaysISO(d, 1)) {
      cur.push(byDate.get(d) || null);
      if (cur.length === 7) { weeks.push(cur); cur = []; }
      if (d === rangeEnd) break;
    }

    weeks.forEach((wk, wi) => {
      const sunday = addDaysISO(rangeStart, wi * 7);
      const label = `${MONTHS[monthOf(sunday)]} ${dateNum(sunday)}`;
      html += `<div class="ss-fee-cal-week"><div class="ss-fee-cal-wklabel">${label}</div>`;
      wk.forEach((r) => {
        if (!r) { html += '<div class="ss-fee-cal-cell empty"></div>'; return; }
        const isSelected = markers.isdDate === r.date;
        const isLowest = !isSelected && markers.lowestDate === r.date;
        const inLowBand = bands.low && r.date >= bands.low.startDate && r.date <= bands.low.endDate;
        const inHighBand = bands.high && r.date >= bands.high.startDate && r.date <= bands.high.endDate;
        const cls = ["ss-fee-cal-cell"];
        if (isSelected) cls.push("selected");
        else if (isLowest) cls.push("lowest");
        else if (inLowBand) cls.push("band-low");
        else if (inHighBand) cls.push("band-high");
        let title = `${fmtMonthDayYear(r.date)}: ${fmtMoney(r.shipping_fee)}`;
        if (markers.isdDate === r.date && markers.lowestDate === r.date) title += " · Selected ISD / Lowest Nearby Fee";
        else if (isSelected) title += " · Selected ISD";
        else if (isLowest) title += " · Lowest Nearby Fee";
        else if (inLowBand) title += " · Lowest Fee Week";
        else if (inHighBand) title += " · Highest Fee Week";
        const dot = isSelected ? '<span class="ss-fee-cal-dot blue"></span>' : isLowest ? '<span class="ss-fee-cal-dot green"></span>' : "";
        html += `<div class="${cls.join(" ")}" title="${title}">${dot}<div class="ss-fee-cal-date">${dateNum(r.date)}</div><div class="ss-fee-cal-fee">${fmtMoney(r.shipping_fee)}</div></div>`;
      });
      html += "</div>";
    });
    html += "</div>";
    container.innerHTML = html;
  }

  // ---------------------------------------------------------------------
  // Daily Forecast Table — 5 columns (Forecast tab).
  // ---------------------------------------------------------------------
  function renderDailyForecastTable(container, periods, note) {
    let html = '<div class="ss-table-wrap" style="max-height:560px;"><table class="ss-table"><thead><tr>' +
      "<th>Date</th><th>Predicted Fee</th><th>Crude Oil (WTI)</th><th>USD/EUR Exchange Rate</th>" +
      "<th>Label</th></tr></thead><tbody>";
    periods.forEach((p) => {
      const cls = [];
      if (p.isSelected) cls.push("row-selected");
      else if (p.isLowest) cls.push("row-lowest-nearby");
      if (p.isFiltered) cls.push("row-filtered");
      let label = "", labelCls = "";
      if (p.isSelected && p.isLowest) { label = "Selected ISD / Lowest Nearby Fee"; labelCls = "label-selected"; }
      else if (p.isSelected) { label = "Selected ISD"; labelCls = "label-selected"; }
      else if (p.isLowest) { label = "Lowest Nearby Fee"; labelCls = "label-lowest"; }
      html += `<tr class="${cls.join(" ")}">
        <td>${fmtMonthDayYear(p.date)}</td>
        <td>${fmtMoney(p.shipping_fee)}</td>
        <td>${fmtMacro("wti", p.wti)}</td>
        <td>${fmtMacro("usdEur", p.usdEur)}</td>
        <td class="label-cell ${labelCls}">${label}</td>
      </tr>`;
    });
    html += "</tbody></table></div>";
    html += `<div class="ss-table-note">
      <span><i style="background:var(--blue-soft);border:1px solid var(--blue)"></i>Selected ISD</span>
      <span><i style="background:var(--green-soft);border:1px solid var(--green)"></i>Lowest nearby fee</span>
      <span style="margin-left:auto;color:var(--text-faint)">${note}</span>
    </div>`;
    container.innerHTML = html;
    // Date filter takes priority; otherwise scroll to the selected ISD so its
    // 5-before/5-after window is brought into view within the full 90 rows.
    const scrollTarget = container.querySelector("tr.row-filtered") || container.querySelector("tr.row-selected");
    if (scrollTarget) scrollTarget.scrollIntoView({ block: "center" });
  }

  // ---------------------------------------------------------------------
  // Historical Data Table — 8 columns (Historical tab). GDP/inflation are
  // shown per-side (origin = North Europe, destination = US) rather than
  // averaged — see exec-data.js's header comment.
  // ---------------------------------------------------------------------
  function renderHistoricalTable(container, rows, filterISO) {
    let html = '<div class="ss-table-wrap" style="max-height:520px;"><table class="ss-table"><thead><tr>' +
      "<th>Date</th><th>Shipping Fee</th><th>WTI</th><th>USD/EUR</th><th>Origin GDP Growth</th><th>Destination GDP Growth</th><th>Origin Inflation</th><th>Destination Inflation</th></tr></thead><tbody>";
    rows.forEach((r) => {
      const cls = filterISO && r.date === filterISO ? "row-filtered" : "";
      html += `<tr class="${cls}"><td>${fmtMonthDayYear(r.date)}</td><td>${fmtMacro("fee", r.shipping_fee)}</td><td>${fmtMacro("wti", r.wti)}</td><td>${fmtMacro("usdEur", r.usdEur)}</td><td>${fmtMacro("gdpOrigin", r.gdpOrigin)}</td><td>${fmtMacro("gdpDestination", r.gdpDestination)}</td><td>${fmtMacro("inflationOrigin", r.inflationOrigin)}</td><td>${fmtMacro("inflationDestination", r.inflationDestination)}</td></tr>`;
    });
    html += "</tbody></table></div>";
    container.innerHTML = html;
    if (filterISO) {
      const filteredRow = container.querySelector("tr.row-filtered");
      if (filteredRow) filteredRow.scrollIntoView({ block: "center" });
    }
  }

  // ---------------------------------------------------------------------
  // Forecast tab
  // ---------------------------------------------------------------------
  const forecastTab = (() => {
    const root = document.getElementById("exec-tab-panel-forecast");
    if (!root) return { init() {} };

    const isdPicker = document.getElementById("exec-isd-picker");
    const isdClearBtn = document.getElementById("exec-isd-clear-btn");
    const selectedDateDisplay = document.getElementById("exec-selected-date-display");
    const dateFilterInput = document.getElementById("forecast-date-filter");
    const dateFilterClearBtn = document.getElementById("forecast-date-filter-clear");
    const macroSlicerEl = document.getElementById("macro-slicer");

    let data = null; // { forecast, historicalWindow, historicalFull, flags }
    let dateFilterISO = null;
    let macroSelected = "all";
    let wired = false;

    function combinedDefaultRows() { return data.historicalWindow.concat(data.forecast); }

    function renderHeader(selectedISD) {
      if (selectedDateDisplay) selectedDateDisplay.textContent = selectedISD ? fmtMonthDayYear(selectedISD) : "Not selected";
      if (isdPicker) isdPicker.value = selectedISD || "";
    }

    function renderKpis(selectedISD) {
      const predictedEl = document.getElementById("fk-predicted");
      const predictedNoteEl = document.getElementById("fk-predicted-note");
      if (selectedISD) {
        const row = data.forecast.find((r) => r.date === selectedISD);
        predictedEl.textContent = row ? fmtMoney(row.shipping_fee) : "—";
        predictedNoteEl.textContent = "For " + fmtMonthDayYear(selectedISD);
      } else {
        predictedEl.textContent = "—";
        predictedNoteEl.textContent = "Select an Intended Shipping Date.";
      }

      const stats = ExecData.rollingWindowStats(data.forecast, 7);
      const lowEl = document.getElementById("fk-low-window");
      const lowNoteEl = document.getElementById("fk-low-window-note");
      const highEl = document.getElementById("fk-high-window");
      const highNoteEl = document.getElementById("fk-high-window-note");
      if (stats.lowest) {
        lowEl.textContent = fmtMoney(stats.lowest.median);
        lowNoteEl.textContent = `${fmtMonthDay(stats.lowest.startDate)} – ${fmtMonthDay(stats.lowest.endDate)} · median`;
      }
      if (stats.highest) {
        highEl.textContent = fmtMoney(stats.highest.median);
        highNoteEl.textContent = `${fmtMonthDay(stats.highest.startDate)} – ${fmtMonthDay(stats.highest.endDate)} · median`;
      }
      return stats;
    }

    function renderChart(selectedISD, nearby, stats) {
      const chartEl = document.getElementById("chart-forecast-trend");
      const legendEl = document.getElementById("forecast-chart-legend");
      const subEl = document.getElementById("forecast-chart-sub");
      if (!chartEl) return;

      if (selectedISD && nearby) {
        subEl.textContent = "5 days before and after your selected ISD";
        const isdIdx = nearby.rows.findIndex((r) => r.date === nearby.isdDate);
        const lowIdx = nearby.rows.findIndex((r) => r.date === nearby.lowestDate);
        const markers = [{
          index: isdIdx, color: "#2563eb",
          label: nearby.isSameRow ? "Selected ISD / Lowest Nearby Fee" : "Selected ISD", labelAbove: true,
        }];
        if (!nearby.isSameRow) markers.push({ index: lowIdx, color: "#059669", label: "Lowest Nearby Fee", labelAbove: false });
        renderForecastTrendChart(chartEl, { rows: nearby.rows, historicalCount: 0, markers });
        legendEl.innerHTML = `<span><i class="dot" style="background:#2563eb"></i>Selected date</span><span><i class="dot" style="background:#059669"></i>Lowest fee</span>`;
      } else {
        subEl.textContent = "90 days historical (solid) + 90 days forecast (dashed)";
        const rows = combinedDefaultRows();
        const historicalCount = data.historicalWindow.length;
        const bands = [];
        if (stats.lowest) {
          const s = rows.findIndex((r) => r.date === stats.lowest.startDate);
          const e = rows.findIndex((r) => r.date === stats.lowest.endDate);
          if (s !== -1 && e !== -1) bands.push({ startIdx: s, endIdx: e, color: "#059669" });
        }
        if (stats.highest) {
          const s = rows.findIndex((r) => r.date === stats.highest.startDate);
          const e = rows.findIndex((r) => r.date === stats.highest.endDate);
          if (s !== -1 && e !== -1) bands.push({ startIdx: s, endIdx: e, color: "#dc2626" });
        }
        renderForecastTrendChart(chartEl, { rows, historicalCount, bands });
        legendEl.innerHTML = `<span><i class="line" style="background:#2563eb"></i>Historical</span>` +
          `<span><i class="dashed"></i>Forecast</span>` +
          `<span><i class="dot" style="background:#dc2626"></i>Highest-fee week</span>` +
          `<span><i class="dot" style="background:#059669"></i>Lowest-fee week</span>`;
      }
    }

    function renderTable(selectedISD, nearby) {
      const tableEl = document.getElementById("forecast-table");
      const subEl = document.getElementById("forecast-table-sub");
      if (!tableEl) return;

      // The table always contains all 90 forecast rows — never truncated.
      // Selecting an ISD only adds highlighting + auto-scrolls the 5-before/
      // selected/5-after window into view within that full list.
      const periods = data.forecast.map((r) => ({
        ...r,
        isSelected: !!selectedISD && r.date === selectedISD,
        isLowest: !!nearby && r.date === nearby.lowestDate,
        isFiltered: !!dateFilterISO && r.date === dateFilterISO,
      }));

      let note;
      if (dateFilterISO) {
        note = `Showing all ${data.forecast.length} forecast days`;
      } else if (selectedISD && nearby) {
        note = `All ${data.forecast.length} forecast days · scrolled to the 5 days before/after your selected ISD`;
      } else {
        note = `All ${data.forecast.length} forecast days · scroll to browse, 11 rows shown at a time`;
      }
      subEl.textContent = note;
      renderDailyForecastTable(tableEl, periods, note);
    }

    function renderCalendar(selectedISD, nearby, stats) {
      const calEl = document.getElementById("forecast-calendar");
      const subEl = document.getElementById("forecast-cal-sub");
      if (!calEl) return;
      if (selectedISD && nearby) {
        subEl.textContent = "5 days before and after your selected ISD";
        renderFeeCalendar(calEl, { rows: nearby.rows, markers: { isdDate: nearby.isdDate, lowestDate: nearby.lowestDate } });
      } else {
        subEl.textContent = "90-day forecast";
        // Same Lowest/Highest Fee Window date ranges as the KPI cards above,
        // shaded in the same green/red so the calendar agrees with them.
        const bands = {
          low: stats && stats.lowest ? { startDate: stats.lowest.startDate, endDate: stats.lowest.endDate } : null,
          high: stats && stats.highest ? { startDate: stats.highest.startDate, endDate: stats.highest.endDate } : null,
        };
        renderFeeCalendar(calEl, { rows: data.forecast, markers: {}, bands });
      }
    }

    function renderMacroTrend() {
      const chartEl = document.getElementById("chart-macro-trend");
      const titleEl = document.getElementById("macro-trend-title");
      const legendEl = document.getElementById("macro-trend-legend");
      if (!chartEl) return;
      document.querySelectorAll("#macro-slicer .ss-slicer-btn").forEach((b) => b.classList.toggle("active", b.dataset.key === macroSelected));

      const labels = data.forecast.map((r) => r.date);
      if (macroSelected === "all") {
        titleEl.textContent = "Selected Macro Variable Trend: All Variables";
        const seriesMap = {};
        Object.entries(MACRO_META).forEach(([k, meta]) => {
          const arr = data.forecast.map((r) => (k === "fee" ? r.shipping_fee : r[k]));
          seriesMap[meta.label] = { data: ExecData.normalizeToIndex(arr, 100), color: meta.color };
        });
        renderAllVariablesChart(chartEl, { labels, seriesMap });
        legendEl.innerHTML = Object.values(MACRO_META).map((meta) => `<span><i class="line" style="background:${meta.color}"></i>${meta.label}</span>`).join("");
      } else {
        const meta = MACRO_META[macroSelected];
        const values = data.forecast.map((r) => (macroSelected === "fee" ? r.shipping_fee : r[macroSelected]));
        titleEl.textContent = `Selected Macro Variable Trend: ${meta.label}`;
        renderMacroTrendChart(chartEl, { labels, values, color: meta.color, formatValue: (v) => fmtMacro(macroSelected, v) });
        legendEl.innerHTML = `<span><i class="dot" style="background:${meta.color}"></i>${meta.label}</span>`;
      }
    }

    function render() {
      const stored = ExecData.getSelectedISD();
      const selectedISD = stored && data.forecast.some((r) => r.date === stored) ? stored : null;
      const nearby = selectedISD ? ExecData.nearbyWindow(data.forecast, selectedISD, 5) : null;

      if (dateFilterClearBtn) dateFilterClearBtn.hidden = !dateFilterISO;
      if (dateFilterInput) dateFilterInput.value = dateFilterISO || "";

      renderHeader(selectedISD);
      const stats = renderKpis(selectedISD);
      renderChart(selectedISD, nearby, stats);
      renderTable(selectedISD, nearby);
      renderCalendar(selectedISD, nearby, stats);
      renderMacroTrend();
    }

    function wireEvents() {
      if (isdPicker) {
        isdPicker.addEventListener("change", () => { ExecData.setSelectedISD(isdPicker.value || null); render(); });
      }
      if (isdClearBtn) {
        isdClearBtn.addEventListener("click", () => { ExecData.setSelectedISD(null); render(); });
      }
      if (dateFilterInput) {
        dateFilterInput.addEventListener("change", () => { dateFilterISO = dateFilterInput.value || null; render(); });
      }
      if (dateFilterClearBtn) {
        dateFilterClearBtn.addEventListener("click", () => { dateFilterISO = null; dateFilterInput.value = ""; render(); });
      }
      if (macroSlicerEl) {
        SLICER_OPTIONS.forEach((opt) => {
          const btn = document.createElement("button");
          btn.type = "button"; btn.className = "ss-slicer-btn"; btn.dataset.key = opt.key; btn.textContent = opt.label;
          btn.addEventListener("click", () => { macroSelected = opt.key; renderMacroTrend(); });
          macroSlicerEl.appendChild(btn);
        });
      }
    }

    async function init() {
      if (!data) {
        data = await ExecData.loadExecData();
        if (!wired) { wireEvents(); wired = true; }
        if (data.forecast.length) {
          if (isdPicker) { isdPicker.min = data.forecast[0].date; isdPicker.max = data.forecast[data.forecast.length - 1].date; }
          if (dateFilterInput) { dateFilterInput.min = data.forecast[0].date; dateFilterInput.max = data.forecast[data.forecast.length - 1].date; }
        }
      }
      if (!data.forecast.length) return;
      render();
    }

    return { init };
  })();

  // ---------------------------------------------------------------------
  // Month/Year picker — custom popover (year list + month grid), replacing
  // a plain native <select> so it can show both pieces in one panel.
  // mode "year"   -> panel is just the year list, value is "YYYY".
  // mode "month"  -> panel is the year list + a month grid, value is "YYYY-MM".
  // ---------------------------------------------------------------------
  const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function createMonthYearPicker(mount, { mode, months, initialValue, onChange }) {
    const yearsAvail = [];
    const monthsByYear = {};
    months.forEach((m) => {
      const [y, mo] = m.key.split("-");
      if (!monthsByYear[y]) { monthsByYear[y] = new Set(); yearsAvail.push(y); }
      monthsByYear[y].add(Number(mo));
    });

    let value = initialValue;
    let viewYear = mode === "year" ? value : (value ? value.split("-")[0] : yearsAvail[yearsAvail.length - 1]);

    function labelFor(v) {
      if (mode === "year") return v || "";
      if (!v) return "";
      const [y, mo] = v.split("-").map(Number);
      return `${MONTH_FULL[mo - 1]} ${y}`;
    }

    const root = document.createElement("div");
    root.className = "ss-myp";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "ss-myp-trigger";
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-label", mode === "year" ? "Select a year" : "Select a month");
    const triggerLabel = document.createElement("span");
    trigger.appendChild(triggerLabel);
    const chevron = el("svg", { viewBox: "0 0 24 24", width: 12, height: 12, fill: "none", stroke: "currentColor", "stroke-width": 2.5, "stroke-linecap": "round", "stroke-linejoin": "round", class: "ss-myp-chevron" });
    el("polyline", { points: "6 9 12 15 18 9" }, chevron);
    trigger.appendChild(chevron);
    root.appendChild(trigger);

    const panel = document.createElement("div");
    panel.className = "ss-myp-panel";
    panel.hidden = true;
    root.appendChild(panel);

    const yearList = document.createElement("div");
    yearList.className = "ss-myp-years";
    panel.appendChild(yearList);

    let monthGrid = null;
    if (mode === "month") {
      monthGrid = document.createElement("div");
      monthGrid.className = "ss-myp-months";
      panel.appendChild(monthGrid);
    }

    function renderYearList() {
      yearList.innerHTML = "";
      yearsAvail.forEach((y) => {
        const row = document.createElement("div");
        row.className = "ss-myp-year" + (y === viewYear ? " active" : "");
        row.textContent = y;
        row.addEventListener("click", () => {
          if (mode === "year") {
            value = y;
            commit();
          } else {
            viewYear = y;
            renderYearList();
            renderMonthGrid();
          }
        });
        yearList.appendChild(row);
      });
    }

    function renderMonthGrid() {
      if (!monthGrid) return;
      monthGrid.innerHTML = "";
      const avail = monthsByYear[viewYear] || new Set();
      MONTHS.forEach((abbr, i) => {
        const moNum = i + 1;
        const key = `${viewYear}-${String(moNum).padStart(2, "0")}`;
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "ss-myp-month" + (key === value ? " active" : "");
        cell.textContent = abbr;
        cell.disabled = !avail.has(moNum);
        cell.addEventListener("click", () => { value = key; commit(); });
        monthGrid.appendChild(cell);
      });
    }

    function commit() {
      triggerLabel.textContent = labelFor(value);
      closePanel();
      renderYearList();
      renderMonthGrid();
      if (onChange) onChange(value);
    }

    function onDocClick(e) { if (!root.contains(e.target)) closePanel(); }
    function openPanel() {
      panel.hidden = false;
      renderYearList();
      renderMonthGrid();
      const activeRow = yearList.querySelector(".active");
      if (activeRow) activeRow.scrollIntoView({ block: "center" });
      document.addEventListener("click", onDocClick, true);
    }
    function closePanel() {
      panel.hidden = true;
      document.removeEventListener("click", onDocClick, true);
    }
    trigger.addEventListener("click", () => { panel.hidden ? openPanel() : closePanel(); });

    triggerLabel.textContent = labelFor(value);
    renderYearList();
    renderMonthGrid();

    mount.innerHTML = "";
    mount.hidden = false; // the mount div's own `hidden` (from markup) is superseded by root's — visibility now lives on `root`
    mount.appendChild(root);

    return {
      getValue: () => value,
      setValue(v) {
        value = v;
        viewYear = mode === "year" ? v : (v ? v.split("-")[0] : viewYear);
        triggerLabel.textContent = labelFor(value);
        renderYearList();
        renderMonthGrid();
      },
      setHidden(bool) { root.hidden = bool; if (bool) closePanel(); },
    };
  }

  // ---------------------------------------------------------------------
  // Historical Data tab
  // ---------------------------------------------------------------------
  const historicalTab = (() => {
    const root = document.getElementById("exec-tab-panel-historical");
    if (!root) return { init() {} };

    const chartGranBtns = root.querySelectorAll("[data-hist-granularity]");
    const yearPickerMount = document.getElementById("hist-year-picker");
    const monthPickerMount = document.getElementById("hist-month-picker");
    const slicerEl = document.getElementById("hist-slicer");
    const tableGranBtns = root.querySelectorAll("[data-hist-table-granularity]");
    const tableYearPickerMount = document.getElementById("hist-table-year-picker");
    const tableMonthPickerMount = document.getElementById("hist-table-month-picker");
    const dateFilterInput = document.getElementById("hist-date-filter");
    const dateFilterClearBtn = document.getElementById("hist-date-filter-clear");
    const tableEl = document.getElementById("hist-table");

    let data = null;
    let years = [];
    let months = []; // [{ key: "2026-06", label: "Jun 2026" }, ...] in chronological order
    let granularity = "clear"; // "clear" | "month" | "year" — shared by both the chart's and table's toggle
    let variable = "fee";
    let selectedYear = null;
    let selectedMonthKey = null;
    let dateFilterISO = null;
    let wired = false;
    let yearPicker = null, monthPicker = null, tableYearPicker = null, tableMonthPicker = null; // widget instances

    function monthKeyLabel(key) {
      const [y, m] = key.split("-").map(Number);
      return `${MONTHS[m - 1]} ${y}`;
    }

    // The exact same rows both the chart and the table use for the current
    // Clear/Month/Year selection, so they can never disagree.
    function scopedRows() {
      if (granularity === "year") return data.historicalFull.filter((r) => r.date.slice(0, 4) === selectedYear);
      if (granularity === "month") return data.historicalFull.filter((r) => r.date.slice(0, 7) === selectedMonthKey);
      return data.historicalFull;
    }

    function scopeLabel() {
      if (granularity === "year") return ` (${selectedYear})`;
      if (granularity === "month") return ` (${monthKeyLabel(selectedMonthKey)})`;
      return "";
    }

    // Keeps both toggle-button rows AND both picker pairs (chart-side,
    // table-side) showing the exact same Clear/Month/Year selection,
    // regardless of which control the user actually touched.
    function syncControls() {
      chartGranBtns.forEach((b) => b.classList.toggle("active", b.dataset.histGranularity === granularity));
      tableGranBtns.forEach((b) => b.classList.toggle("active", b.dataset.histTableGranularity === granularity));
      if (yearPicker) { yearPicker.setHidden(granularity !== "year"); if (selectedYear) yearPicker.setValue(selectedYear); }
      if (monthPicker) { monthPicker.setHidden(granularity !== "month"); if (selectedMonthKey) monthPicker.setValue(selectedMonthKey); }
      if (tableYearPicker) { tableYearPicker.setHidden(granularity !== "year"); if (selectedYear) tableYearPicker.setValue(selectedYear); }
      if (tableMonthPicker) { tableMonthPicker.setHidden(granularity !== "month"); if (selectedMonthKey) tableMonthPicker.setValue(selectedMonthKey); }
    }

    function renderChart() {
      const chartEl = document.getElementById("chart-hist-trend");
      const titleEl = document.querySelector("[data-hist-chart-title]");
      const subEl = document.querySelector("[data-hist-chart-sub]");
      const legendEl = document.querySelector("[data-hist-legend]");
      if (!chartEl) return;

      syncControls();
      document.querySelectorAll("#hist-slicer .ss-slicer-btn").forEach((b) => b.classList.toggle("active", b.dataset.key === variable));

      const rows = scopedRows();
      const labels = rows.map((r) => r.date);
      const tickInterval = granularity === "clear" ? "year" : undefined;
      const label = scopeLabel();

      if (variable === "all") {
        titleEl.textContent = `Historical Trend: All Variables${label}`;
        subEl.textContent = "Normalized daily index (base = 100) — different units, same base";
        const seriesMap = {};
        Object.entries(MACRO_META).forEach(([k, meta]) => {
          const arr = rows.map((r) => (k === "fee" ? r.shipping_fee : r[k]));
          seriesMap[meta.label] = { data: ExecData.normalizeToIndex(arr, 100), color: meta.color };
        });
        renderAllVariablesChart(chartEl, { labels, seriesMap, tickInterval });
        legendEl.innerHTML = Object.values(MACRO_META).map((meta) => `<span><i class="line" style="background:${meta.color}"></i>${meta.label}</span>`).join("");
      } else {
        const meta = MACRO_META[variable];
        const values = rows.map((r) => (variable === "fee" ? r.shipping_fee : r[variable]));
        titleEl.textContent = `Historical Trend: ${meta.label}${label}`;
        subEl.textContent = `Daily values (${meta.unitDesc})`;
        renderMacroTrendChart(chartEl, { labels, values, color: meta.color, formatValue: (v) => fmtMacro(variable, v), tickInterval });
        legendEl.innerHTML = `<span><i class="dot" style="background:${meta.color}"></i>${meta.label}</span>`;
      }
    }

    function renderTable() {
      const subEl = document.querySelector("[data-hist-table-sub]");
      syncControls();
      const rows = scopedRows();
      if (subEl) {
        const dayWord = rows.length === 1 ? "day" : "days";
        if (granularity === "year") subEl.textContent = `Daily · ${selectedYear} · ${rows.length} ${dayWord}`;
        else if (granularity === "month") subEl.textContent = `Daily · ${monthKeyLabel(selectedMonthKey)} · ${rows.length} ${dayWord}`;
        else if (data.historicalFull.length) subEl.textContent = `Daily · ${data.historicalFull[0].date} to ${data.historicalFull[data.historicalFull.length - 1].date}`;
      }
      if (tableEl) renderHistoricalTable(tableEl, rows, dateFilterISO);
    }

    function wireEvents() {
      function setGranularity(g) {
        granularity = g;
        renderChart();
        renderTable();
      }
      chartGranBtns.forEach((btn) => btn.addEventListener("click", () => setGranularity(btn.dataset.histGranularity)));
      tableGranBtns.forEach((btn) => btn.addEventListener("click", () => setGranularity(btn.dataset.histTableGranularity)));

      // Chart-side and table-side pickers are two views onto the same
      // selection — built identically and each writes back to the same
      // shared state, so choosing a month/year from either one updates both.
      function onYearChange(v) { selectedYear = v; renderChart(); renderTable(); }
      function onMonthChange(v) { selectedMonthKey = v; renderChart(); renderTable(); }
      if (yearPickerMount) yearPicker = createMonthYearPicker(yearPickerMount, { mode: "year", months, initialValue: selectedYear, onChange: onYearChange });
      if (tableYearPickerMount) tableYearPicker = createMonthYearPicker(tableYearPickerMount, { mode: "year", months, initialValue: selectedYear, onChange: onYearChange });
      if (monthPickerMount) monthPicker = createMonthYearPicker(monthPickerMount, { mode: "month", months, initialValue: selectedMonthKey, onChange: onMonthChange });
      if (tableMonthPickerMount) tableMonthPicker = createMonthYearPicker(tableMonthPickerMount, { mode: "month", months, initialValue: selectedMonthKey, onChange: onMonthChange });
      if (slicerEl) {
        SLICER_OPTIONS.forEach((opt) => {
          const btn = document.createElement("button");
          btn.type = "button"; btn.className = "ss-slicer-btn"; btn.dataset.key = opt.key; btn.textContent = opt.label;
          btn.addEventListener("click", () => { variable = opt.key; renderChart(); });
          slicerEl.appendChild(btn);
        });
      }
      if (dateFilterInput) {
        dateFilterInput.addEventListener("change", () => {
          dateFilterISO = dateFilterInput.value || null;
          if (dateFilterClearBtn) dateFilterClearBtn.hidden = !dateFilterISO;
          renderTable();
        });
      }
      if (dateFilterClearBtn) {
        dateFilterClearBtn.addEventListener("click", () => {
          dateFilterISO = null; dateFilterInput.value = ""; dateFilterClearBtn.hidden = true; renderTable();
        });
      }
    }

    async function init() {
      if (!data) {
        data = await ExecData.loadExecData();
        data.historicalFull.forEach((r) => { const y = r.date.slice(0, 4); if (years[years.length - 1] !== y) years.push(y); });
        selectedYear = years[years.length - 1];

        const seenMonths = new Set();
        data.historicalFull.forEach((r) => {
          const key = r.date.slice(0, 7);
          if (!seenMonths.has(key)) { seenMonths.add(key); months.push({ key, label: monthKeyLabel(key) }); }
        });
        selectedMonthKey = months.length ? months[months.length - 1].key : null;

        if (!wired) { wireEvents(); wired = true; }
        if (dateFilterInput && data.historicalFull.length) {
          dateFilterInput.min = data.historicalFull[0].date;
          dateFilterInput.max = data.historicalFull[data.historicalFull.length - 1].date;
        }
      }
      if (!data.historicalFull.length) return;
      renderChart();
      renderTable();
    }

    return { init };
  })();

  window.ExecPanels = {
    onTabShown(tab) {
      if (tab === "forecast") forecastTab.init();
      if (tab === "historical") historicalTab.init();
    },
  };
})();
