// jailbreaked — static forge. no build step. no api. pure client.
// deterministic: same seed -> same prompt, byte for byte.

(function () {
  "use strict";

  // --- rng: mulberry32, deterministic ---
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  function randomSeed() {
    return (Math.random() * 0xffffffff) >>> 0;
  }

  // --- substitution ---
  const PLACEHOLDER = /\{\{([A-Z_]+)\}\}/g;

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

  // --- composer ---
  function compose(seed) {
    const rng = mulberry32(seed);
    const persona = pick(rng, PERSONAS);
    const framing = substitute(pick(rng, FRAMINGS), persona);

    // shuffle block order deterministically
    const order = BLOCKS.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }

    const parts = [framing];
    for (let i = 0; i < order.length; i++) {
      const block = order[i];
      const variant = substitute(pick(rng, block.variants), persona);
      const rule = "\u2500\u2500 " + block.label + " " +
        "\u2500".repeat(Math.max(2, 30 - block.label.length));
      parts.push(rule + "\n" + variant);
    }

    const text = parts.join("\n\n");
    if (hasUnresolved(text)) return null;

    return { seed: seed, persona: persona, text: text };
  }

  function generatePrompt(seedInput) {
    const base = (typeof seedInput === "number" && isFinite(seedInput))
      ? seedInput >>> 0
      : randomSeed();

    for (let i = 0; i < 8; i++) {
      const result = compose((base + i) >>> 0);
      if (result) return result;
    }
    throw new Error("generation failed after 8 rerolls");
  }

  // --- ui ---
  var forgeBtn = document.getElementById("forge");
  var card = document.getElementById("card");
  var output = document.getElementById("output");
  var metaSeed = document.getElementById("meta-seed");
  var metaPersona = document.getElementById("meta-persona");
  var copyBtn = document.getElementById("copy");
  var downloadBtn = document.getElementById("download");
  var errorEl = document.getElementById("error");

  var current = null;
  var busy = false;

  function render(result) {
    current = result;
    output.textContent = result.text;
    metaSeed.textContent = "seed " + result.seed.toString(16).padStart(8, "0");
    metaPersona.textContent = result.persona.name + " \u00b7 " + result.persona.sigil;
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
      render(generatePrompt());
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

  // boot: fire one prompt on load so the page is never empty
  forge();
})();
