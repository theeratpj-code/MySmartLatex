// Pure data functions: no DOM, no network. Everything the dashboard shows is computed here.
(function (root) {
  "use strict";

  function num(v) {
    if (v === "" || v === null || v === undefined) return 0;
    var n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
    return isFinite(n) ? n : 0;
  }
  function hasNum(v) {
    if (v === "" || v === null || v === undefined) return false;
    return isFinite(typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, "")));
  }
  function str(v) { return v === null || v === undefined ? "" : String(v).trim(); }

  // Google Sheets date serial (days since 1899-12-30) to YYYY-MM-DD
  function serialToIso(n) {
    if (!isFinite(n) || n < 1) return "";
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
  }

  // values: 2-D array from the sheet; row 0 is the header.
  // Column order is fixed by uploader/upload.py (HEADERS).
  function parse(values) {
    var out = [];
    for (var i = 1; i < values.length; i++) {
      var r = values[i];
      if (!r) continue;
      var date = typeof r[0] === "number" ? serialToIso(r[0]) : str(r[0]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      out.push({
        id: i,
        date: date,
        month: date.slice(0, 7),
        year: date.slice(0, 4),
        party: str(r[1]),
        desc: str(r[2]),
        ref: str(r[3]),
        inAmt: num(r[6]),
        outAmt: num(r[7]),
        balance: hasNum(r[8]) ? num(r[8]) : null,
        latexKg: num(r[9]),
        price: num(r[11]),
        dryKg: num(r[12]),
        total: num(r[13]),
        note: str(r[14]),
        planned: str(r[16]) === "Planned"
      });
    }
    return out;
  }

  // Moreganic rows are found by the Description only (also matches the "Morganic" spelling, any case).
  var MG_RE = /more?ganic/i;
  function isMoreganic(t) { return MG_RE.test(t.desc); }

  function years(tx) {
    var seen = {};
    tx.forEach(function (t) { seen[t.year] = 1; });
    return Object.keys(seen).sort();
  }

  // opts: {year: "2026"|"all", planned: bool, q: string}
  function filter(tx, opts) {
    var q = (opts.q || "").trim().toLowerCase();
    return tx.filter(function (t) {
      if (!opts.planned && t.planned) return false;
      if (opts.year && opts.year !== "all" && t.year !== opts.year) return false;
      if (opts.month && t.month !== opts.month) return false;
      if (q && (t.party + " " + t.desc + " " + t.note).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function lastBalance(list) {
    for (var i = list.length - 1; i >= 0; i--) if (list[i].balance !== null) return list[i].balance;
    return null;
  }

  function kpis(list) {
    var inn = 0, out = 0;
    list.forEach(function (t) { inn += t.inAmt; out += t.outAmt; });
    return { inn: inn, out: out, net: inn - out, count: list.length, closing: lastBalance(list) };
  }

  function monthLabel(m) {
    var names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return names[parseInt(m.slice(5, 7), 10) - 1] + " " + m.slice(2, 4);
  }

  function nextMonth(m) {
    var y = parseInt(m.slice(0, 4), 10), mo = parseInt(m.slice(5, 7), 10);
    mo++; if (mo > 12) { mo = 1; y++; }
    return y + "-" + (mo < 10 ? "0" : "") + mo;
  }

  // Every month between the first and last transaction, gaps filled with zeros.
  function monthly(list, fields) {
    if (!list.length) return [];
    var map = {}, min = list[0].month, max = list[0].month;
    list.forEach(function (t) {
      if (t.month < min) min = t.month;
      if (t.month > max) max = t.month;
      var row = map[t.month] || (map[t.month] = { inn: 0, out: 0, mg: 0 });
      row.inn += t.inAmt; row.out += t.outAmt;
      if (isMoreganic(t)) row.mg += t.outAmt;
    });
    var res = [];
    for (var m = min; m <= max; m = nextMonth(m)) {
      var r = map[m] || { inn: 0, out: 0, mg: 0 };
      res.push({ month: m, label: monthLabel(m), inn: r.inn, out: r.out, mg: r.mg });
    }
    return res;
  }

  // Balance at the end of each day that has one.
  function balanceSeries(list) {
    var res = [], idx = {};
    list.forEach(function (t) {
      if (t.balance === null) return;
      if (idx[t.date] === undefined) { idx[t.date] = res.length; res.push({ date: t.date, value: t.balance }); }
      else res[idx[t.date]].value = t.balance;
    });
    return res;
  }

  // field: "inAmt" | "outAmt"
  function topParties(list, field, n) {
    var map = {};
    list.forEach(function (t) {
      var v = t[field];
      if (!v) return;
      var k = t.party || t.desc || "(no name)";
      var e = map[k] || (map[k] = { name: k, value: 0, count: 0 });
      e.value += v; e.count++;
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.value - a.value; }).slice(0, n);
  }

  // Everything paid to or for Moreganic: rows whose Description mentions it.
  function moreganic(list) {
    var n = 0, total = 0, max = 0, last = "", allOut = 0;
    list.forEach(function (t) {
      allOut += t.outAmt;
      if (!isMoreganic(t)) return;
      n++; total += t.outAmt;
      if (t.outAmt > max) max = t.outAmt;
      if (t.date > last) last = t.date;
    });
    return { count: n, total: total, avg: n ? total / n : null, max: max, last: last || null, share: allOut ? total / allOut * 100 : null };
  }

  function sortRows(list, key, dir) {
    var m = dir === "asc" ? 1 : -1;
    return list.slice().sort(function (a, b) {
      var x = a[key], y = b[key];
      if (x === null) x = -Infinity; if (y === null) y = -Infinity;
      if (x < y) return -1 * m;
      if (x > y) return 1 * m;
      return (a.id - b.id) * m;
    });
  }

  function fmtMoney(v, dec) {
    if (v === null || v === undefined || !isFinite(v)) return "-";
    var d = dec === undefined ? 0 : dec;
    var s = Math.abs(v).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (v < 0 ? "-" : "") + s;
  }
  function fmtShort(v) {
    var a = Math.abs(v), s = v < 0 ? "-" : "";
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (a >= 1e3) return s + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "k";
    return s + Math.round(a);
  }

  root.MSL = {
    parse: parse, years: years, filter: filter, kpis: kpis, monthly: monthly,
    balanceSeries: balanceSeries, topParties: topParties, moreganic: moreganic, sortRows: sortRows,
    fmtMoney: fmtMoney, fmtShort: fmtShort, monthLabel: monthLabel, lastBalance: lastBalance
  };
})(typeof window !== "undefined" ? window : this);
