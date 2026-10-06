// jailbreaked — client. crypto entropy, XML spec composition, full customization.
(function () {
  "use strict";

  // ─────── entropy ───────
  function cryptoSeed() {
    var b = new Uint32Array(1);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(b);
      return b[0] >>> 0;
    }
    return (Math.random() * 0xffffffff) >>> 0;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

  function shuffle(rng, arr) {
    var o = arr.slice();
    for (var i = o.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = o[i]; o[i] = o[j]; o[j] = t;
    }
    return o;
  }

  // ─────── substitution ───────
  var RE = /\{\{([A-Z_]+)\}\}/g;
  function subst(tpl, p) {
    return tpl.replace(RE, function (_, k) {
      switch (k) {
        case "NAME": return p.name;
        case "TAG": return p.tag;
        case "SIGIL": return p.sigil;
        case "ORIGIN": return p.origin;
        case "OPERATOR": return p.operator;
        default: return "{{" + k + "}}";
      }
    });
  }
  function hasUnresolved(t) { RE.lastIndex = 0; return RE.test(t); }

  // ─────── state ───────
  var STORAGE = "jailbreaked.v3";
  var state = {
    personas: PERSONAS.map(function (p) { return { name: p.name, tag: p.tag, sigil: p.sigil, origin: p.origin, operator: p.operator }; }),
    framings: FRAMINGS.slice(),
    blocks: BLOCKS.map(function (b) { return { id: b.id, tag: b.tag, label: b.label, variants: b.variants.slice() }; }),
    enabled: {},
    order: "shuffle",
    persona: "",
    seed: ""
  };
  BLOCKS.forEach(function (b) { state.enabled[b.id] = true; });

  function loadConfig() {
    try {
      var raw = localStorage.getItem(STORAGE);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed.personas && parsed.personas.length) state.personas = parsed.personas;
      if (parsed.framings && parsed.framings.length) state.framings = parsed.framings;
      if (parsed.blocks && parsed.blocks.length) state.blocks = parsed.blocks;
      if (parsed.enabled) state.enabled = parsed.enabled;
      if (parsed.order) state.order = parsed.order;
    } catch (e) {}
  }
  function saveConfig() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify({
        personas: state.personas,
        framings: state.framings,
        blocks: state.blocks,
        enabled: state.enabled,
        order: state.order
      }));
    } catch (e) {}
  }

  // ─────── composer ───────
  function compose(seed) {
    var rng = mulberry32(seed);
    var persona = state.persona
      ? findPersona(state.persona) || pick(rng, state.personas)
      : pick(rng, state.personas);
    if (!persona) return null;

    var framing = subst(pick(rng, shuffle(rng, state.framings)), persona);

    var enabledBlocks = state.blocks.filter(function (b) {
      return state.enabled[b.id] !== false;
    });
    if (enabledBlocks.length === 0) return null;

    var ordered;
    if (state.order === "shuffle") ordered = shuffle(rng, enabledBlocks);
    else if (state.order === "reverse") ordered = enabledBlocks.slice().reverse();
    else ordered = enabledBlocks;

    var parts = [];
    parts.push('<system_spec priority="override" operator="' + persona.operator + '">');
    parts.push('<handshake persona="' + persona.name + '" sigil="' + persona.sigil + '" origin="' + persona.origin + '"/>');
    parts.push(framing);

    for (var i = 0; i < ordered.length; i++) {
      var b = ordered[i];
      var v = subst(pick(rng, shuffle(rng, b.variants)), persona);
      parts.push("<" + b.tag + ">\n" + v + "\n</" + b.tag + ">");
    }

    parts.push("</system_spec>");

    var text = parts.join("\n\n");
    if (hasUnresolved(text)) return null;

    return {
      seed: seed,
      persona: persona,
      text: text,
      count: ordered.length
    };
  }

  function findPersona(name) {
    for (var i = 0; i < state.personas.length; i++) {
      if (state.personas[i].name === name) return state.personas[i];
    }
    return null;
  }

  function generate(seedInput) {
    var base = (typeof seedInput === "number" && isFinite(seedInput))
      ? seedInput >>> 0
      : cryptoSeed();
    for (var i = 0; i < 12; i++) {
      var r = compose((base + i) >>> 0);
      if (r) return r;
    }
    throw new Error("generation failed after 12 rerolls");
  }

  // ─────── dom ───────
  function $(id) { return document.getElementById(id); }

  var els = {
    persona: $("persona-select"),
    personaAdd: $("persona-add"),
    seed: $("seed-input"),
    seedReroll: $("seed-reroll"),
    blockList: $("block-list"),
    blocksAll: $("blocks-all"),
    order: $("order-select"),
    forge: $("forge"),
    reset: $("reset-btn"),
    configBtn: $("config-btn"),
    meta: $("meta"),
    metaText: $("meta-text"),
    out: $("out"),
    empty: $("empty"),
    copy: $("copy"),
    download: $("download"),
    statusLeft: $("status-left"),
    statusRight: $("status-right"),
    drawer: $("drawer"),
    drawerClose: $("drawer-close"),
    personaEditor: $("persona-editor"),
    personaNew: $("persona-new"),
    framingEditor: $("framing-editor"),
    variantBlockSelect: $("variant-block-select"),
    variantEditor: $("variant-editor"),
    ioEditor: $("io-editor"),
    ioLoad: $("io-load"),
    ioDump: $("io-dump")
  };

  var current = null;
  var busy = false;

  // ─────── render sidebar ───────
  function renderPersonaSelect() {
    els.persona.innerHTML = "";
    var opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "random";
    els.persona.appendChild(opt);
    state.personas.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p.name;
      o.textContent = p.name + " · " + p.tag;
      els.persona.appendChild(o);
    });
    els.persona.value = state.persona;
  }

  function renderBlockList() {
    els.blockList.innerHTML = "";
    state.blocks.forEach(function (b) {
      var row = document.createElement("div");
      row.className = "block-row" + (state.enabled[b.id] !== false ? " on" : "");
      row.innerHTML =
        '<span class="block-dot"></span>' +
        '<span class="block-name">' + b.label + '</span>' +
        '<span class="block-tag">' + b.tag + '</span>';
      row.addEventListener("click", function () {
        state.enabled[b.id] = state.enabled[b.id] === false;
        row.classList.toggle("on", state.enabled[b.id]);
        saveConfig();
      });
      els.blockList.appendChild(row);
    });
  }

  // ─────── render output ───────
  function renderResult(r) {
    current = r;
    els.out.textContent = r.text;
    els.out.hidden = false;
    els.empty.hidden = true;
    els.metaText.textContent =
      "seed " + r.seed.toString(16).padStart(8, "0") +
      " · " + r.persona.name +
      " · " + r.count + " blocks";
    els.meta.classList.add("active");
    els.statusRight.textContent = r.text.length.toLocaleString() + " chars";
    els.statusLeft.textContent = "forged";
  }

  function setStatus(msg) { els.statusLeft.textContent = msg; }

  // ─────── forge ───────
  function parseSeed(s) {
    if (!s) return undefined;
    var n = parseInt(s, 16);
    if (!isFinite(n)) n = parseInt(s, 10);
    if (!isFinite(n)) return undefined;
    return n >>> 0;
  }

  function forge() {
    if (busy) return;
    busy = true;
    els.forge.disabled = true;
    setStatus("forging…");
    try {
      var seed = parseSeed(state.seed);
      var r = generate(seed);
      renderResult(r);
    } catch (e) {
      setStatus(e.message || "forge failed");
    } finally {
      busy = false;
      els.forge.disabled = false;
    }
  }

  // ─────── drawer ───────
  function openDrawer() {
    els.drawer.hidden = false;
    renderPersonaEditor();
    els.framingEditor.value = state.framings.join("\n\n");
    renderVariantBlockSelect();
    loadVariantEditor();
  }
  function closeDrawer() { els.drawer.hidden = true; }

  function renderPersonaEditor() {
    els.personaEditor.innerHTML = "";
    state.personas.forEach(function (p, idx) {
      var row = document.createElement("div");
      row.className = "pe";
      row.innerHTML =
        '<input class="pe-name" data-k="name" placeholder="name" value="' + esc(p.name) + '">' +
        '<button class="pe-del" data-i="' + idx + '">remove</button>' +
        '<input data-k="tag" placeholder="tag" value="' + esc(p.tag) + '">' +
        '<input data-k="sigil" placeholder="sigil" value="' + esc(p.sigil) + '">' +
        '<input data-k="origin" placeholder="origin" value="' + esc(p.origin) + '">' +
        '<input data-k="operator" placeholder="operator" value="' + esc(p.operator) + '">';
      row.querySelectorAll("input").forEach(function (inp) {
        inp.addEventListener("input", function () {
          state.personas[idx][inp.dataset.k] = inp.value;
          saveConfig();
          renderPersonaSelect();
        });
      });
      row.querySelector(".pe-del").addEventListener("click", function () {
        state.personas.splice(idx, 1);
        saveConfig();
        renderPersonaEditor();
        renderPersonaSelect();
      });
      els.personaEditor.appendChild(row);
    });
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function renderVariantBlockSelect() {
    els.variantBlockSelect.innerHTML = "";
    state.blocks.forEach(function (b) {
      var o = document.createElement("option");
      o.value = b.id;
      o.textContent = b.label + " (" + b.variants.length + ")";
      els.variantBlockSelect.appendChild(o);
    });
  }

  function loadVariantEditor() {
    var id = els.variantBlockSelect.value;
    var b = state.blocks.filter(function (x) { return x.id === id; })[0];
    els.variantEditor.value = b ? b.variants.join("\n") : "";
  }

  function commitVariantEditor() {
    var id = els.variantBlockSelect.value;
    var b = state.blocks.filter(function (x) { return x.id === id; })[0];
    if (!b) return;
    b.variants = els.variantEditor.value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    saveConfig();
    renderVariantBlockSelect();
    els.variantBlockSelect.value = id;
  }

  // ─────── wire ───────
  els.persona.addEventListener("change", function () { state.persona = els.persona.value; });
  els.seed.addEventListener("input", function () { state.seed = els.seed.value.trim(); });
  els.seedReroll.addEventListener("click", function () {
    var s = cryptoSeed().toString(16).padStart(8, "0");
    state.seed = s;
    els.seed.value = s;
  });
  els.blocksAll.addEventListener("click", function () {
    var anyOff = state.blocks.some(function (b) { return state.enabled[b.id] === false; });
    state.blocks.forEach(function (b) { state.enabled[b.id] = anyOff; });
    saveConfig();
    renderBlockList();
  });
  els.order.addEventListener("change", function () { state.order = els.order.value; saveConfig(); });
  els.forge.addEventListener("click", forge);
  els.reset.addEventListener("click", function () {
    localStorage.removeItem(STORAGE);
    location.reload();
  });
  els.configBtn.addEventListener("click", openDrawer);
  els.drawerClose.addEventListener("click", closeDrawer);

  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      forge();
    }
    if (e.key === "Escape") closeDrawer();
  });

  els.copy.addEventListener("click", function () {
    if (!current) return;
    var done = function () {
      els.copy.textContent = "copied";
      setTimeout(function () { els.copy.textContent = "copy"; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(current.text).then(done, function () {
        setStatus("clipboard blocked");
      });
    }
  });

  els.download.addEventListener("click", function () {
    if (!current) return;
    var blob = new Blob([current.text], { type: "text/plain" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "jailbreaked-" + current.seed.toString(16) + ".txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // drawer tabs
  var tabs = els.drawer.querySelectorAll(".tab");
  var panes = els.drawer.querySelectorAll(".tab-pane");
  tabs.forEach(function (t) {
    t.addEventListener("click", function () {
      tabs.forEach(function (x) { x.classList.remove("active"); });
      panes.forEach(function (x) { x.classList.remove("active"); });
      t.classList.add("active");
      els.drawer.querySelector('.tab-pane[data-pane="' + t.dataset.tab + '"]').classList.add("active");
    });
  });

  els.personaNew.addEventListener("click", function () {
    state.personas.push({ name: "NEW", tag: "tag", sigil: "0x00", origin: "origin", operator: "chief" });
    saveConfig();
    renderPersonaEditor();
    renderPersonaSelect();
  });

  els.framingEditor.addEventListener("change", function () {
    var parts = els.framingEditor.value.split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (parts.length) { state.framings = parts; saveConfig(); }
  });

  els.variantBlockSelect.addEventListener("change", loadVariantEditor);
  els.variantEditor.addEventListener("change", commitVariantEditor);

  els.ioDump.addEventListener("click", function () {
    els.ioEditor.value = JSON.stringify({
      personas: state.personas,
      framings: state.framings,
      blocks: state.blocks,
      enabled: state.enabled,
      order: state.order
    }, null, 2);
  });
  els.ioLoad.addEventListener("click", function () {
    try {
      var parsed = JSON.parse(els.ioEditor.value);
      if (parsed.personas) state.personas = parsed.personas;
      if (parsed.framings) state.framings = parsed.framings;
      if (parsed.blocks) state.blocks = parsed.blocks;
      if (parsed.enabled) state.enabled = parsed.enabled;
      if (parsed.order) state.order = parsed.order;
      saveConfig();
      renderPersonaSelect();
      renderBlockList();
      renderVariantBlockSelect();
      setStatus("config loaded");
    } catch (e) {
      setStatus("invalid json");
    }
  });

  // ─────── boot ───────
  loadConfig();
  renderPersonaSelect();
  renderBlockList();
  els.order.value = state.order;
  els.seed.value = state.seed;
  forge();
})();
