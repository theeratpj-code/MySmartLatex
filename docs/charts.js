// SVG chart helpers with entrance animation and hover tooltips. No libraries.
// Everything dynamic goes in through textContent or the CSS object model (CSP-safe: no inline style attributes).
(function (root) {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function el(name, attrs, text) {
    var e = document.createElementNS(NS, name);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function html(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ---- tooltip -----------------------------------------------------------
  var tipEl = null;
  function tipNode() { return tipEl || (tipEl = document.getElementById("tip")); }
  function showTip(x, y, title, rows) {
    var t = tipNode();
    if (!t) return;
    t.replaceChildren();
    t.appendChild(html("strong", "tip-title", title));
    rows.forEach(function (r) {
      var line = html("div", "tip-row");
      if (r.cls) line.appendChild(html("span", "tip-dot " + r.cls));
      line.appendChild(html("span", "tip-label", r.label));
      line.appendChild(html("span", "tip-val", r.value));
      t.appendChild(line);
    });
    t.hidden = false;
    var w = t.offsetWidth, h = t.offsetHeight;
    var left = Math.min(Math.max(8, x + 16), window.innerWidth - w - 8);
    var top = y - h - 14;
    if (top < 8) top = y + 18;
    t.style.left = left + "px";
    t.style.top = top + "px";
  }
  function hideTip() { var t = tipNode(); if (t) t.hidden = true; }

  function niceScale(max, ticks) {
    if (!(max > 0)) return { max: 1, step: 1 };
    var raw = max / ticks, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), n = raw / mag;
    var step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
    return { max: Math.ceil(max / step) * step, step: step };
  }
  function svgRoot(w, h, label) {
    return el("svg", { viewBox: "0 0 " + w + " " + h, role: "img", "aria-label": label, "class": "chart-svg" });
  }
  function mount(container, svg) { hideTip(); container.replaceChildren(svg); }
  function gridLines(svg, sc, L, W, R, T, ih, fmt, min) {
    for (var v = min || 0; v <= (min || 0) + sc.max + 1e-9; v += sc.step) {
      var y = T + ih - ((v - (min || 0)) / sc.max) * ih;
      svg.appendChild(el("line", { x1: L, x2: W - R, y1: y, y2: y, "class": Math.abs(v) < 1e-9 ? "axis" : "grid" }));
      svg.appendChild(el("text", { x: L - 8, y: y + 4, "class": "tick", "text-anchor": "end" }, fmt(v)));
    }
  }
  function grow(node, i, animate) {
    if (animate === false) return;
    node.setAttribute("class", node.getAttribute("class") + " grow");
    if (!reduced) node.style.animationDelay = Math.min(i * 28, 700) + "ms";
  }

  // data: [{label, a, b}]  a = money in, b = money out
  function groupedBars(container, data, o) {
    var W = 720, H = 350, L = 52, R = 8, T = 12, B = 32;
    var max = 0;
    data.forEach(function (d) { max = Math.max(max, d.a, d.b); });
    var sc = niceScale(max, 4), iw = W - L - R, ih = H - T - B;
    var svg = svgRoot(W, H, o.label);
    gridLines(svg, sc, L, W, R, T, ih, o.fmt);
    var gw = iw / Math.max(data.length, 1), bw = Math.min(18, gw * 0.34), every = Math.ceil(data.length / 12);
    data.forEach(function (d, i) {
      var cx = L + gw * i + gw / 2;
      [["a", -bw - 1, "bar-a"], ["b", 1, "bar-b"]].forEach(function (s) {
        var val = d[s[0]], h = (val / sc.max) * ih;
        if (val > 0) {
          var r = el("rect", { x: cx + s[1], y: T + ih - h, width: bw, height: Math.max(h, 1), rx: 3,
            "class": s[2] + (o.selected && d.key !== o.selected ? " dim" : "") });
          grow(r, i, o.animate);
          svg.appendChild(r);
        }
      });
      if (i % every === 0) svg.appendChild(el("text", { x: cx, y: H - 10, "class": "tick", "text-anchor": "middle" }, d.label));
      var hit = el("rect", { x: L + gw * i, y: T, width: gw, height: ih, "class": "hit" + (o.onPick ? " pick" : "") + (o.selected === d.key ? " sel" : "") });
      function move(e) {
        showTip(e.clientX, e.clientY, d.label, [
          { cls: "a", label: o.aName, value: o.fmtFull(d.a) },
          { cls: "b", label: o.bName, value: o.fmtFull(d.b) },
          { label: "Net", value: (d.a - d.b >= 0 ? "+" : "-") + o.fmtFull(Math.abs(d.a - d.b)) }
        ]);
      }
      hit.addEventListener("pointermove", move);
      hit.addEventListener("pointerdown", move);
      hit.addEventListener("pointerleave", hideTip);
      if (o.onPick) {
        hit.setAttribute("role", "button"); hit.setAttribute("tabindex", "0");
        hit.setAttribute("aria-label", "Filter transactions to " + d.label);
        hit.addEventListener("click", function () { o.onPick(d.key); });
        hit.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); o.onPick(d.key); } });
      }
      svg.appendChild(hit);
    });
    mount(container, svg);
  }

  // data: [{label, v}]
  function bars(container, data, o) {
    var W = 720, H = 240, L = 52, R = 8, T = 12, B = 32;
    var max = 0;
    data.forEach(function (d) { max = Math.max(max, d.v); });
    var sc = niceScale(max, 3), iw = W - L - R, ih = H - T - B;
    var svg = svgRoot(W, H, o.label);
    gridLines(svg, sc, L, W, R, T, ih, o.fmt);
    var gw = iw / Math.max(data.length, 1), bw = Math.min(30, gw * 0.6), every = Math.ceil(data.length / 12);
    data.forEach(function (d, i) {
      var cx = L + gw * i + gw / 2, h = (d.v / sc.max) * ih;
      if (d.v > 0) {
        var r = el("rect", { x: cx - bw / 2, y: T + ih - h, width: bw, height: Math.max(h, 1), rx: 3, "class": o.cls || "bar-a" });
        grow(r, i, o.animate);
        svg.appendChild(r);
      }
      if (i % every === 0) svg.appendChild(el("text", { x: cx, y: H - 10, "class": "tick", "text-anchor": "middle" }, d.label));
      var hit = el("rect", { x: L + gw * i, y: T, width: gw, height: ih, "class": "hit" });
      function move(e) { showTip(e.clientX, e.clientY, d.label, [{ cls: "a", label: o.name || "Value", value: o.fmtFull(d.v) }]); }
      hit.addEventListener("pointermove", move);
      hit.addEventListener("pointerdown", move);
      hit.addEventListener("pointerleave", hideTip);
      svg.appendChild(hit);
    });
    mount(container, svg);
  }

  // data: [{date: "YYYY-MM-DD", value}] with a crosshair that follows the pointer
  function line(container, data, o) {
    var W = 720, H = 280, L = 58, R = 12, T = 12, B = 32;
    var svg = svgRoot(W, H, o.label);
    if (data.length < 2) { mount(container, svg); return; }
    var t0 = Date.parse(data[0].date), t1 = Date.parse(data[data.length - 1].date);
    var min = Infinity, max = -Infinity;
    data.forEach(function (d) { min = Math.min(min, d.value); max = Math.max(max, d.value); });
    min = Math.min(0, min);
    var sc = niceScale(max - min, 4), top = min + sc.max, iw = W - L - R, ih = H - T - B;
    function X(d) { return L + ((Date.parse(d) - t0) / Math.max(t1 - t0, 1)) * iw; }
    function Y(v) { return T + ih - ((v - min) / (top - min)) * ih; }
    for (var v = min; v <= top + 1e-9; v += sc.step) {
      var y = Y(v);
      svg.appendChild(el("line", { x1: L, x2: W - R, y1: y, y2: y, "class": Math.abs(v) < 1e-9 ? "axis" : "grid" }));
      svg.appendChild(el("text", { x: L - 8, y: y + 4, "class": "tick", "text-anchor": "end" }, o.fmt(v)));
    }
    var pts = data.map(function (d) { return X(d.date).toFixed(1) + "," + Y(d.value).toFixed(1); }).join(" ");
    svg.appendChild(el("polygon", { points: X(data[0].date).toFixed(1) + "," + Y(0).toFixed(1) + " " + pts + " " + X(data[data.length - 1].date).toFixed(1) + "," + Y(0).toFixed(1), "class": "area" }));
    svg.appendChild(el("polyline", { points: pts, "class": "line-a draw", fill: "none", pathLength: "1" }));
    for (var i = 0; i <= 5; i++) {
      var iso = new Date(t0 + (t1 - t0) * i / 5).toISOString().slice(0, 10);
      svg.appendChild(el("text", { x: L + iw * i / 5, y: H - 10, "class": "tick", "text-anchor": i === 0 ? "start" : i === 5 ? "end" : "middle" }, o.dateLabel(iso)));
    }
    var vline = el("line", { x1: 0, x2: 0, y1: T, y2: T + ih, "class": "vline" });
    var dot = el("circle", { cx: 0, cy: 0, r: 5.5, "class": "cursor" });
    vline.style.display = "none"; dot.style.display = "none";
    svg.appendChild(vline); svg.appendChild(dot);
    var hit = el("rect", { x: L, y: T, width: iw, height: ih, "class": "hit-line" });
    function at(e) {
      var rect = svg.getBoundingClientRect();
      var sx = (e.clientX - rect.left) * (W / rect.width);
      var best = 0, bd = Infinity;
      for (var k = 0; k < data.length; k++) {
        var dd = Math.abs(X(data[k].date) - sx);
        if (dd < bd) { bd = dd; best = k; }
      }
      var p = data[best], px = X(p.date), py = Y(p.value);
      vline.setAttribute("x1", px); vline.setAttribute("x2", px);
      dot.setAttribute("cx", px); dot.setAttribute("cy", py);
      vline.style.display = ""; dot.style.display = "";
      showTip(e.clientX, e.clientY, p.date, [{ cls: "a", label: "Balance", value: o.fmtFull(p.value) }]);
    }
    hit.addEventListener("pointermove", at);
    hit.addEventListener("pointerdown", at);
    hit.addEventListener("pointerleave", function () { vline.style.display = "none"; dot.style.display = "none"; hideTip(); });
    svg.appendChild(hit);
    mount(container, svg);
  }

  // small decorative trend line for the feature card
  function sparkline(container, data) {
    var W = Math.max(240, container.clientWidth || 360), H = 90;
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, "class": "spark-svg", "aria-hidden": "true" });
    if (data.length < 2) { container.replaceChildren(); return; }
    var step = Math.max(1, Math.floor(data.length / 70)), pts = [];
    for (var i = 0; i < data.length; i += step) pts.push(data[i]);
    if (pts[pts.length - 1] !== data[data.length - 1]) pts.push(data[data.length - 1]);
    var min = Infinity, max = -Infinity;
    pts.forEach(function (d) { min = Math.min(min, d.value); max = Math.max(max, d.value); });
    var span = Math.max(max - min, 1);
    var coords = pts.map(function (d, k) {
      return [(k / (pts.length - 1)) * (W - 8) + 4, H - 8 - ((d.value - min) / span) * (H - 20)];
    });
    var path = coords.map(function (c) { return c[0].toFixed(1) + "," + c[1].toFixed(1); }).join(" ");
    svg.appendChild(el("polygon", { points: "4," + (H - 2) + " " + path + " " + (W - 4) + "," + (H - 2), "class": "spark-area" }));
    svg.appendChild(el("polyline", { points: path, "class": "spark-line draw", fill: "none", pathLength: "1" }));
    var last = coords[coords.length - 1];
    svg.appendChild(el("circle", { cx: last[0], cy: last[1], r: 4, "class": "spark-dot" }));
    container.replaceChildren(svg);
  }

  // items: [{name, value, count}]
  function hbars(container, items, o) {
    container.replaceChildren();
    if (!items.length) { container.appendChild(html("p", "empty", "Nothing to show for this period.")); return; }
    var max = items[0].value || 1, ul = html("ul", "hbars"), fills = [];
    items.forEach(function (it, i) {
      var li = html("li", "hb-item");
      var top = html("div", "hb-top");
      top.appendChild(html("span", "hb-rank", String(i + 1)));
      top.appendChild(html("span", "hb-name", it.name));
      top.appendChild(html("span", "hb-val", o.fmt(it.value)));
      var track = html("div", "hb-track"), fill = html("div", "hb-fill " + o.cls);
      track.appendChild(fill);
      li.appendChild(top); li.appendChild(track);
      li.appendChild(html("span", "hb-sub", it.count + (it.count === 1 ? " transaction" : " transactions")));
      ul.appendChild(li);
      fills.push([fill, Math.max(1.5, it.value / max * 100), i]);
    });
    container.appendChild(ul);
    // set widths on the next frame so the CSS transition animates them
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        fills.forEach(function (f) {
          if (!reduced) f[0].style.transitionDelay = f[2] * 60 + "ms";
          f[0].style.width = f[1] + "%";
        });
      });
    });
  }

  root.Charts = { groupedBars: groupedBars, bars: bars, line: line, sparkline: sparkline, hbars: hbars, hideTip: hideTip };
})(window);
