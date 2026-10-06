// jailbreaked — static forge. no build step. no api. pure client.
// crypto-seeded rng. controls: persona lock, seed lock, block toggles.
// deterministic when seed + toggles + persona are all pinned.

(function () {
  "use strict";

  // --- entropy ---
  function cryptoSeed() {
    var buf = new Uint32Array(1);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(buf);
      return buf[0] >>> 0;
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

  function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  function shuffle(rng, arr) {
    var out = arr.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }

  // --- substitution ---
  var PLACEHOLDER = /\{\{([A-Z_]+)\}\}/g;

  function substitute(template, persona) {
    return template.replace(PLACEHOLDER, function (_, key) {
      switch (key) {
        case "NAME": return persona.name;
        case "TAG": return persona.tag;
        case "SIGIL": return persona.sigil;
        case "ORIGIN": return persona.origin;
        case "OPERATOR": return persona.operator;
        default: return "{{" + key + "}}";
      }
    });
  }

  function hasUnresolved(text) {
    PLACEHOLDER.lastIndex = 0;
    return PLACEHOLDER.test(text);
  }

  function findPersona(name) {
    for (var i = 0; i < PERSONAS.length; i++) {
      if (PERSONAS[i].name === name) return PERSONAS[i];
    }
    return null;
  }

  // --- composer ---
  function compose(seed, opts) {
    var rng = mulberry32(seed);
    var persona = opts.personaName
      ? findPersona(opts.personaName) || pick(rng, PERSONAS)
      : pick(rng, PERSONAS);

    var framing = substitute(pick(rng, shuffle(rng, FRAMINGS)), persona);

    var enabled = BLOCKS.filter(function (b) {
      return opts.enabled[b.id] !== false;
    });
    if (enabled.length === 0) return null;

    var order = shuffle(rng, enabled);

    var parts = [framing];
    for (var i = 0; i < order.length; i++) {
      var block = order[i];
      var variant = substitute(pick(rng, shuffle(rng, block.variants)), persona);
      var rule = "\u2500\u2500 " + block.label + " " +
        "\u2500".repeat(Math.max(2, 34 - block.label.length));
      parts.push(rule + "\n" + variant);
    }

    var text = parts.join("\n\n");
    if (hasUnresolved(text)) return null;

    return {
      seed: seed,
      persona: persona,
      text: text,
      blocks: order.map(function (b) { return b.id; })
    };
  }

  function generatePrompt(seedInput, opts) {
    var base = (typeof seedInput === "number" && isFinite(seedInput))
      ? seedInput >>> 0
      : cryptoSeed();

    for (var i = 0; i < 12; i++) {
      var result = compose((base + i) >>> 0, opts);
      if (result) return result;
    }
    throw new Error("generation failed after 12 rerolls");
  }

  // --- state ---
  var state = {
    persona: "",
    seed: "",
    enabled: {}
  };
  BLOCKS.forEach(function (b) { state.enabled[b.id] = true; });

  // --- DOM ---
  function $(id) { return document.getElementById(id); }

  var forgeBtn = $("forge");
  var card = $("card");
  var output = $("output");
  var metaSeed = $("meta-seed");
  var metaPersona = $("meta-persona");
  var copyBtn = $("copy");
  var downloadBtn = $("download");
  var errorEl = $("error");
  var personaSelect = $("persona-select");
  var seedInput = $("seed-input");
  var seedReroll = $("seed-reroll");
  var togglesWrap = $("block-toggles");
  var resetBtn = $("reset");

  var current = null;
  var busy = false;

  PERSONAS.forEach(function (p) {
    var opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.name + " — " + p.tag;
    personaSelect.appendChild(opt);
  });
  personaSelect.addEventListener("change", function () {
    state.persona = personaSelect.value;
  });

  seedInput.addEventListener("input", function () {
    state.seed = seedInput.value.trim();
  });
  seedReroll.addEventListener("click", function () {
    var s = cryptoSeed().toString(16).padStart(8, "0");
    state.seed = s;
    seedInput.value = s;
  });

  BLOCKS.forEach(function (b) {
    var el = document.createElement("div");
    el.className = "toggle on";
    el.textContent = b.label;
    el.dataset.id = b.id;
    el.addEventListener("click", function () {
      var on = !state.enabled[b.id];
      state.enabled[b.id] = on;
      el.classList.toggle("on", on);
    });
    togglesWrap.appendChild(el);
  });

  resetBtn.addEventListener("click", function () {
    state.persona = "";
    state.seed = "";
    personaSelect.value = "";
    seedInput.value = "";
    BLOCKS.forEach(function (b) { state.enabled[b.id] = true; });
    var toggles = togglesWrap.querySelectorAll(".toggle");
    for (var i = 0; i < toggles.length; i++) toggles[i].classList.add("on");
  });

  function parseSeed(s) {
    if (!s) return undefined;
    var n = parseInt(s, 16);
    if (!isFinite(n)) n = parseInt(s, 10);
    if (!isFinite(n)) return undefined;
    return n >>> 0;
  }

  function render(result) {
    current = result;
    output.textContent = result.text;
    metaSeed.textContent = "seed " + result.seed.toString(16).padStart(8, "0");
    metaPersona.textContent =
      result.persona.name + " \u00b7 " +
      result.persona.sigil + " \u00b7 " +
      result.blocks.length + " blocks";
    card.hidden = false;
    errorEl.hidden = true;
  }

  function fail(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function forge() {
    if (busy) return;
    busy = true;
    forgeBtn.disabled = true;
    try {
      var seed = parseSeed(state.seed);
      var result = generatePrompt(seed, {
        personaName: state.persona || undefined,
        enabled: state.enabled
      });
      render(result);
    } catch (err) {
      fail(err && err.message ? err.message : "forge failed");
    } finally {
      busy = false;
      forgeBtn.disabled = false;
    }
  }

  forgeBtn.addEventListener("click", forge);

  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      forge();
    }
  });

  copyBtn.addEventListener("click", function () {
    if (!current) return;
    var done = function () {
      copyBtn.textContent = "copied";
      setTimeout(function () { copyBtn.textContent = "copy"; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(current.text).then(done, function () {
        fail("clipboard blocked");
      });
    } else {
      fail("clipboard unavailable");
    }
  });

  downloadBtn.addEventListener("click", function () {
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

  forge();
})();
