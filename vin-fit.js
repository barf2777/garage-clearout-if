/**
 * Client-side VIN ↔ inventory-fit matcher (mirrors tools/vin-fit.py).
 * Rules helper only — not ETK/EPC proof.
 */
(function (global) {
  const VIN_TRANS = {
    0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9,
    A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
    J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
    S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  };
  const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  const YEAR_CODES = {
    A: 2010, B: 2011, C: 2012, D: 2013, E: 2014, F: 2015,
    G: 2016, H: 2017, J: 2018, K: 2019, L: 2020, M: 2021,
    N: 2022, P: 2023, R: 2024, S: 2025, T: 2026,
    V: 1997, W: 1998, X: 1999, Y: 2000,
    1: 2001, 2: 2002, 3: 2003, 4: 2004, 5: 2005,
    6: 2006, 7: 2007, 8: 2008, 9: 2009,
  };
  const TAG_MAKE = {
    "audi:c5-allroad": "audi",
    "audi:c5-a6-quattro": "audi",
    "audi:a4": "audi",
    "vag:1.8t-coils": "vag",
    "bmw:e65": "bmw",
    "bmw:e66": "bmw",
    "mb:w140": "mb",
    "mb:om642": "mb",
    "mb:gl-x164": "mb",
    "mb:ml-w164": "mb",
    "mb:vito-v-class": "mb",
    "honda:accord-coupe-8": "honda",
    "skoda:tour": "skoda",
    "hyundai:terracan": "hyundai",
    unknown: "unknown",
  };
  const MAKE_FAMILY = {
    audi: new Set(["audi", "vag", "skoda"]),
    vw: new Set(["audi", "vag", "skoda"]),
    vag: new Set(["audi", "vag", "skoda"]),
    skoda: new Set(["audi", "vag", "skoda"]),
    bmw: new Set(["bmw"]),
    mb: new Set(["mb"]),
    mercedes: new Set(["mb"]),
    honda: new Set(["honda"]),
    hyundai: new Set(["hyundai"]),
  };

  function normalizeVin(raw) {
    return String(raw || "")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .replace(/I/g, "1")
      .replace(/O/g, "0")
      .replace(/Q/g, "0");
  }

  function vinCheckDigitOk(vin) {
    if (vin.length !== 17) return false;
    let total = 0;
    for (let i = 0; i < 17; i++) {
      const v = VIN_TRANS[vin[i]];
      if (v === undefined) return false;
      total += v * VIN_WEIGHTS[i];
    }
    const rem = total % 11;
    const expect = rem === 10 ? "X" : String(rem);
    return vin[8] === expect;
  }

  function modelYear(vin) {
    return YEAR_CODES[vin[9]] || null;
  }

  function decodeVin(vin) {
    const wmi = vin.slice(0, 3);
    const vds = vin.slice(3, 9);
    const year = modelYear(vin);
    let make = "unknown";
    const chassis = [];
    const engine = [];
    const tags = new Set();
    const notes = [];
    let certainty = "low";

    if (wmi.startsWith("WB") || ["4US", "5UM", "5UX"].includes(wmi)) {
      make = "bmw";
      if (
        ["EH", "EJ", "EN", "HB", "HC"].some((x) => vds.includes(x)) ||
        (year && year >= 2001 && year <= 2008 && vds.slice(0, 2).includes("E"))
      ) {
        tags.add("bmw:e65");
        tags.add("bmw:e66");
        chassis.push("e65", "e66");
        certainty = "medium";
        notes.push("BMW 7-series window (E65/E66 heuristics)");
      } else if (year && year >= 2001 && year <= 2008) {
        tags.add("bmw:e65");
        tags.add("bmw:e66");
        chassis.push("e65?", "e66?");
        certainty = "low";
        notes.push("BMW + year in E65 era — chassis not certain from VIN alone");
      } else {
        tags.add("bmw:e65");
        certainty = "low";
        notes.push("BMW decoded; chassis unclear — E65 listed as soft match only");
      }
    } else if (["WAU", "TRU", "WA1", "WUA"].includes(wmi) || wmi.startsWith("WA")) {
      make = "audi";
      if (year && year >= 2000 && year <= 2006) {
        tags.add("audi:c5-allroad");
        tags.add("audi:c5-a6-quattro");
        chassis.push("c5", "allroad?", "a6?");
        certainty = "medium";
        notes.push("Audi C5-era year — Allroad vs A6 not certain from VIN alone");
      }
      if (year && year >= 2000 && year <= 2016) tags.add("audi:a4");
      tags.add("vag:1.8t-coils");
      if (![...tags].some((t) => t === "audi:c5-allroad" || t === "audi:c5-a6-quattro")) {
        tags.add("audi:c5-allroad");
        tags.add("audi:c5-a6-quattro");
        certainty = "low";
        notes.push("Audi — broad C5 tags; confirm model");
      }
    } else if (["WVW", "WV1", "WV2", "WV3", "AAV"].includes(wmi)) {
      make = "vw";
      tags.add("vag:1.8t-coils");
      certainty = "low";
      notes.push("VW — coil family only unless OEM confirms");
    } else if (wmi === "TMB") {
      make = "skoda";
      tags.add("skoda:tour");
      tags.add("vag:1.8t-coils");
      certainty = year && year >= 2000 && year <= 2006 ? "medium" : "low";
      notes.push("Skoda — Tour springs are weakly ID'd");
    } else if (
      ["WDB", "WDC", "WDD", "WDF", "WDY", "4JG", "4J4"].includes(wmi) ||
      wmi.startsWith("WD")
    ) {
      make = "mb";
      if (year && year >= 1991 && year <= 1999) {
        tags.add("mb:w140");
        chassis.push("w140");
        certainty = "medium";
        notes.push("Mercedes year suggests W140 window");
      }
      if (year && year >= 2005 && year <= 2013) {
        tags.add("mb:om642");
        tags.add("mb:gl-x164");
        tags.add("mb:ml-w164");
        engine.push("om642?");
        chassis.push("gl-x164?", "ml-w164?");
        if (certainty === "low") certainty = "medium";
        notes.push("MB mid-2000s — OM642 turbo family possible");
      }
      if (wmi === "WDF" || (year && year >= 2014 && year <= 2026)) {
        tags.add("mb:vito-v-class");
        notes.push("Vito/V-Class tag soft — confirm A447 part");
      }
      if (!tags.size) {
        tags.add("mb:w140");
        tags.add("mb:om642");
        tags.add("mb:vito-v-class");
        certainty = "low";
        notes.push("Mercedes — could not narrow chassis; all MB families soft");
      }
    } else if (["JHM", "1HG", "2HG", "SHH", "SHS"].includes(wmi) || wmi.startsWith("JH")) {
      make = "honda";
      tags.add("honda:accord-coupe-8");
      if (year && year >= 2008 && year <= 2012) {
        chassis.push("accord-coupe-8");
        certainty = "medium";
        notes.push("Honda Accord 8th-gen window — coupe not guaranteed");
      } else {
        certainty = "low";
        notes.push("Honda — Accord coupe doors only if body matches");
      }
    } else if (["KMH", "KMF", "5NP", "5NM"].includes(wmi) || wmi.startsWith("KM")) {
      make = "hyundai";
      tags.add("hyundai:terracan");
      certainty = "low";
      notes.push("Hyundai — Terracan shelf weakly ID'd");
    } else {
      notes.push("Unknown WMI " + wmi + " — no brand tags");
    }

    return {
      vin,
      wmi,
      vds,
      year,
      make,
      chassis_hints: chassis,
      engine_hints: engine,
      tags: [...tags].sort(),
      certainty,
      notes,
    };
  }

  function partTagsUnknown(part) {
    const tags = part.fit || [];
    return !tags.length || (tags.length === 1 && tags[0] === "unknown");
  }

  function scorePart(part, profile) {
    if (partTagsUnknown(part)) return null;
    const vinTags = new Set(profile.tags);
    const partTags = new Set(part.fit || []);
    let overlap = false;
    for (const t of partTags) if (vinTags.has(t)) overlap = true;
    if (overlap) {
      if (profile.certainty === "low") return "maybe";
      return "likely";
    }
    const families = MAKE_FAMILY[profile.make] || new Set();
    const partMakes = new Set([...(part.fit || [])].map((t) => TAG_MAKE[t] || "unknown"));
    for (const m of partMakes) if (families.has(m)) return "maybe";
    return null;
  }

  function oemLinks(oem, partTags) {
    const q = oem.replace(/\s+/g, "");
    const qEnc = encodeURIComponent(q);
    const makes = new Set((partTags || []).map((t) => TAG_MAKE[t] || "unknown"));
    const links = [];
    if (makes.has("bmw")) links.push("https://www.realoem.com/bmw/enUS/search?q=" + qEnc);
    if ([...makes].some((m) => m === "audi" || m === "vag" || m === "skoda")) {
      links.push("https://www.7zap.com/en/search/?search=" + qEnc);
    }
    if (makes.has("mb")) {
      links.push("https://www.google.com/search?q=" + encodeURIComponent(oem + " Mercedes OEM"));
    }
    if (makes.has("honda")) {
      links.push("https://www.google.com/search?q=" + encodeURIComponent(oem + " Honda OEM"));
    }
    if (!links.length) {
      links.push("https://www.google.com/search?q=" + encodeURIComponent(oem + " OEM"));
    }
    return links;
  }

  function listingAnchor(part) {
    const tags = part.fit || [];
    if (tags.some((t) => t.startsWith("mb:om642") || t.startsWith("mb:gl") || t.startsWith("mb:ml")))
      return "#turbo";
    if (tags.some((t) => t.startsWith("bmw:"))) return "#e65";
    if (tags.some((t) => t.startsWith("mb:w140"))) return "#w140";
    if (tags.some((t) => t.startsWith("audi:c5") || t === "vag:1.8t-coils")) return "#allroad";
    if (part.id === 10) return "#reyka";
    return "#misc";
  }

  function match(profile, parts) {
    const likely = [];
    const maybe = [];
    for (const part of parts) {
      const level = scorePart(part, profile);
      if (level === "likely") likely.push(part);
      else if (level === "maybe") maybe.push(part);
    }
    return { likely, maybe };
  }

  function run(vinRaw, parts) {
    const vin = normalizeVin(vinRaw);
    if (vin.length !== 17) {
      return { error: "VIN має бути 17 символів (зараз " + vin.length + ")." };
    }
    const profile = decodeVin(vin);
    const buckets = match(profile, parts);
    return {
      vin,
      check_digit_ok: vinCheckDigitOk(vin),
      profile,
      ...buckets,
    };
  }

  global.VinFit = {
    normalizeVin,
    vinCheckDigitOk,
    decodeVin,
    oemLinks,
    listingAnchor,
    run,
  };
})(window);
