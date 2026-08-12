/* ===================================================================
   Executive Dashboard — data loading & shared computation layer.

   Row shape used everywhere below (both tabs):
     { date, shipping_fee, wti, usdEur, gdpOrigin, gdpDestination, inflationOrigin, inflationDestination }
   Origin = North Europe, destination = US — kept separate rather than
   averaged, since the two economies differ in size/currency/policy and a
   mean can hide one side moving while the other doesn't (see
   docs/data-schema.md).

   loadExecData():
     - Forecast tab: sourced strictly from Supabase's snapshots table
       (kind='forecast') for shipping_fee/wti/usdEur — genuinely
       forecasted by the model — with placeholders only for
       gdp/inflation, which the model doesn't forecast per day. If
       Supabase isn't configured or has no forecast snapshot yet, the
       Forecast tab simply has no data.
     - Historical tab: sourced strictly from Supabase's historical_data
       table — real ingested actuals from the pkl's `history` DataFrame,
       see scripts/pkl_to_json.py. If Supabase isn't configured or the
       table is empty, the Historical tab simply has no data.
   GPR/TPU are dropped entirely: the model never forecasts them, and the
   dashboard has no display for them anymore. See docs/after-receiving-pkl.md.
   =================================================================== */
(function () {
  const ISD_STORAGE_KEY = "ss_isd"; // shared between New Forecast and the Executive Dashboard

  function getSelectedISD() { try { return localStorage.getItem(ISD_STORAGE_KEY); } catch (e) { return null; } }
  function setSelectedISD(iso) {
    try { if (iso) localStorage.setItem(ISD_STORAGE_KEY, iso); else localStorage.removeItem(ISD_STORAGE_KEY); } catch (e) { /* unavailable */ }
  }

  function median(nums) {
    const s = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  // Mirrors pandas' df['shipping_fee'].rolling(window, center=True).median():
  // a centered window, NaN (null here) wherever it would run off either edge.
  function rollingMedian(values, window) {
    const half = Math.floor(window / 2);
    return values.map((_, i) => {
      const lo = i - half, hi = i + (window - 1 - half);
      if (lo < 0 || hi >= values.length) return null;
      return median(values.slice(lo, hi + 1));
    });
  }

  // Spec §3.1 — lowest/highest 7-day-median window across the full forecast,
  // reused by KPI Cards 2 & 3 and the default-state chart shading.
  function rollingWindowStats(rows, window = 7) {
    const values = rows.map((r) => r.shipping_fee);
    const rolled = rollingMedian(values, window);
    const half = Math.floor(window / 2);
    let lowIdx = -1, highIdx = -1;
    rolled.forEach((v, i) => {
      if (v == null) return;
      if (lowIdx === -1 || v < rolled[lowIdx]) lowIdx = i;
      if (highIdx === -1 || v > rolled[highIdx]) highIdx = i;
    });
    function windowAt(centerIdx) {
      const lo = centerIdx - half, hi = centerIdx + (window - 1 - half);
      return { startDate: rows[lo].date, endDate: rows[hi].date, median: rolled[centerIdx] };
    }
    return {
      lowest: lowIdx === -1 ? null : windowAt(lowIdx),
      highest: highIdx === -1 ? null : windowAt(highIdx),
    };
  }

  // Spec §3.2 — the 11-day (selectedISD ± window) slice and its lowest-fee
  // row. Single source of truth for chart markers, table highlighting/labels,
  // and calendar dots so all three can never disagree.
  function nearbyWindow(rows, selectedISD, window = 5) {
    if (!selectedISD) return null;
    const isdIdx = rows.findIndex((r) => r.date === selectedISD);
    if (isdIdx === -1) return null;
    const lo = Math.max(0, isdIdx - window), hi = Math.min(rows.length - 1, isdIdx + window);
    const slice = rows.slice(lo, hi + 1);
    let lowIdx = 0;
    slice.forEach((r, i) => { if (r.shipping_fee < slice[lowIdx].shipping_fee) lowIdx = i; });
    return {
      rows: slice,
      isdDate: selectedISD,
      lowestDate: slice[lowIdx].date,
      isSameRow: slice[lowIdx].date === selectedISD,
    };
  }

  // Spec §3.3 — per-variable base-100 normalization for "All Variables" views.
  function normalizeToIndex(values, base = 100) {
    const first = values[0];
    return values.map((v) => (v / first) * base);
  }

  // Supabase's historical_data table uses crude_oil/exchange_rate column
  // names (matches the pkl's own field names); normalize to this app's
  // wti/usdEur row shape here so callers don't care which source it came from.
  function normalizeHistoricalRow(r) {
    return {
      date: r.date, shipping_fee: r.shipping_fee,
      wti: r.crude_oil, usdEur: r.exchange_rate,
      gdpOrigin: r.gdp_origin, gdpDestination: r.gdp_destination,
      inflationOrigin: r.inflation_origin, inflationDestination: r.inflation_destination,
    };
  }

  // Forecast tab data source: the `snapshots` table (kind='forecast'),
  // read directly here rather than reusing app.js's FORECAST_DATA global,
  // since this fetch is independent of app.js's login-time load timing.
  async function tryFetchForecastFromSupabase() {
    if (typeof SUPABASE_URL === "undefined" || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
    try {
      const url = `${SUPABASE_URL}/rest/v1/snapshots?kind=eq.forecast&select=payload&order=id.desc&limit=1`;
      const res = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
      if (!res.ok) return null;
      const rows = await res.json();
      const forecast = rows[0] && rows[0].payload && rows[0].payload.forecast;
      if (!forecast || !forecast.length) return null;
      return forecast.map((d) => ({ date: d.date, shipping_fee: d.f, wti: d.wti, usdEur: d.usdEur }));
    } catch (e) {
      return null;
    }
  }

  async function tryFetchHistoricalFromSupabase() {
    if (typeof SUPABASE_URL === "undefined" || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
    try {
      const url = `${SUPABASE_URL}/rest/v1/historical_data?select=date,shipping_fee,crude_oil,exchange_rate,gdp_origin,gdp_destination,inflation_origin,inflation_destination&order=date.asc`;
      const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Prefer: "count=exact" };

      // Supabase caps rows per request server-side (db-max-rows, commonly
      // 1000) no matter what's asked for, so a single fetch silently
      // truncates a table this size (2,000+ rows of daily history).
      // Page with Range, using each response's actual length (robust to
      // whatever the server's cap turns out to be) and Content-Range's
      // total to know when to stop.
      let rows = [];
      let offset = 0;
      let total = null;
      while (total === null || rows.length < total) {
        const res = await fetch(url, { headers: { ...headers, Range: `${offset}-${offset + 999}` } });
        if (!res.ok && res.status !== 206) break;
        const page = await res.json();
        if (!page.length) break;
        rows = rows.concat(page);
        offset += page.length;
        if (total === null) {
          const match = (res.headers.get("content-range") || "").match(/\/(\d+)$/);
          total = match ? parseInt(match[1], 10) : rows.length; // header missing — assume this page was everything
        }
      }
      return rows.length ? rows.map(normalizeHistoricalRow) : null;
    } catch (e) {
      return null;
    }
  }

  function buildPlaceholderMacroByDate(lastKnown, dates) {
    return dates.map((date) => ({
      date, wti: lastKnown.wti, usdEur: lastKnown.usdEur,
      gdpOrigin: lastKnown.gdpOrigin, gdpDestination: lastKnown.gdpDestination,
      inflationOrigin: lastKnown.inflationOrigin, inflationDestination: lastKnown.inflationDestination,
    }));
  }

  // wti/usdEur come from feeRows when the pkl provided real forecasted
  // values for that date; only gdp/inflation (which the model never
  // forecasts per day) use the held-constant placeholder instead.
  function mergeFeeWithMacro(feeRows, macroRows) {
    const macroByDate = new Map(macroRows.map((r) => [r.date, r]));
    return feeRows.map((r) => {
      const m = macroByDate.get(r.date) || {};
      return {
        date: r.date, shipping_fee: r.shipping_fee,
        wti: r.wti != null ? r.wti : m.wti,
        usdEur: r.usdEur != null ? r.usdEur : m.usdEur,
        gdpOrigin: m.gdpOrigin, gdpDestination: m.gdpDestination,
        inflationOrigin: m.inflationOrigin, inflationDestination: m.inflationDestination,
      };
    });
  }

  // Loads the two datasets the dashboard needs, both sourced strictly from
  // Supabase — see file header comment.
  async function loadExecData() {
    const flags = { forecastMacroIsPlaceholder: false };

    let macroHistoryJson = null;
    try {
      const res = await fetch("data/macro-history.json");
      if (res.ok) macroHistoryJson = await res.json();
    } catch (e) { /* ignore — hardcoded defaults below are used instead */ }
    const lastKnownMacro = macroHistoryJson && macroHistoryJson.historical.length
      ? macroHistoryJson.historical[macroHistoryJson.historical.length - 1]
      : { wti: 90.54, usdEur: 0.868, gdpOrigin: 2.25, gdpDestination: 2.53, inflationOrigin: 1.8, inflationDestination: 2.44 };

    // Forecast rows: Supabase's `snapshots` table only — real fee/wti/usdEur
    // series genuinely forecasted by the model. If Supabase isn't
    // configured or has no forecast snapshot yet, the Forecast tab
    // (chart/table/calendar) simply has no data to show. gdp/inflation
    // still use held-constant placeholders since the model doesn't
    // forecast those per day.
    let forecastRows = await tryFetchForecastFromSupabase();
    if (forecastRows) {
      const macroPlaceholder = buildPlaceholderMacroByDate(lastKnownMacro, forecastRows.map((r) => r.date));
      forecastRows = mergeFeeWithMacro(forecastRows, macroPlaceholder);
      flags.forecastMacroIsPlaceholder = true;
    } else {
      forecastRows = [];
    }

    // Historical rows (Historical tab): Supabase's historical_data table
    // only (ingested from the pkl's `history` DataFrame — see
    // scripts/pkl_to_json.py). If Supabase isn't configured or the table
    // is empty, the Historical tab simply has no data to show.
    const historicalFullRows = (await tryFetchHistoricalFromSupabase()) || [];

    // The Forecast tab's pre-forecast window always derives from
    // historicalFull (the 90 days immediately before the forecast starts) —
    // shared with the Historical tab rather than recomputed independently.
    let historicalWindowRows = [];
    if (forecastRows.length && historicalFullRows.length) {
      historicalWindowRows = historicalFullRows.filter((r) => r.date < forecastRows[0].date).slice(-90);
    }

    return { forecast: forecastRows, historicalWindow: historicalWindowRows, historicalFull: historicalFullRows, flags };
  }

  window.ExecData = {
    getSelectedISD, setSelectedISD,
    rollingWindowStats, nearbyWindow, normalizeToIndex,
    loadExecData,
  };
})();
