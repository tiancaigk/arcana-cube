"use strict";

const { cardPriceKey } = require("./priceHistory.js");

const BUCKETS = ["W", "U", "B", "R", "G", "C", "M", "L"];

function pad(value, width = 4) {
  return String(value).padStart(width, "0");
}

function bucketFields(bucket) {
  if (bucket === "L") return { colors: [], frontColors: [], typeLine: "Land", frontTypeLine: "Land", manaCost: "", cmc: 0 };
  if (bucket === "C") return { colors: [], frontColors: [], typeLine: "Artifact", frontTypeLine: "Artifact", manaCost: "{2}", cmc: 2 };
  if (bucket === "M") return { colors: ["W", "U"], frontColors: ["W", "U"], typeLine: "Creature — Wizard", frontTypeLine: "Creature — Wizard", manaCost: "{W}{U}", cmc: 2 };
  const cmc = BUCKETS.indexOf(bucket) % 5 + 1;
  return { colors: [bucket], frontColors: [bucket], typeLine: "Creature — Test", frontTypeLine: "Creature — Test", manaCost: `{${bucket}}`, cmc };
}

function buildCards(count = 600) {
  return Array.from({ length: Math.max(0, Number(count) || 0) }, (_, index) => {
    const bucket = BUCKETS[index % BUCKETS.length];
    const number = pad(index + 1);
    const finish = index % 4 === 0 ? "nonfoil" : "foil";
    return {
      id: `fixture-card-${number}`,
      scryfallId: `fixture-printing-${number}`,
      oracleId: `fixture-oracle-${number}`,
      name: `Fixture Card ${number}`,
      localizedNames: {},
      ...bucketFields(bucket),
      colorIdentity: bucket === "M" ? ["W", "U"] : ("WUBRG".includes(bucket) ? [bucket] : []),
      set: "TST",
      collectorNumber: String(index + 1),
      rarity: "rare",
      image: `images/tst-${index + 1}-fixture-card-${number}.png`,
      remoteImage: `https://cards.scryfall.io/png/front/fixture/${number}.png`,
      localImage: `images/tst-${index + 1}-fixture-card-${number}.png`,
      localThumbnail: `images/thumbnails/tst-${index + 1}-fixture-card-${number}.webp`,
      backImage: "",
      remoteBackImage: "",
      localBackImage: "",
      localBackThumbnail: "",
      prices: {
        usd: ((index + 100) / 100).toFixed(2),
        usdFoil: ((index + 250) / 100).toFixed(2),
        usdEtched: ""
      },
      priceUpdatedAt: "2025-01-01T00:00:00.000Z",
      finishes: ["nonfoil", "foil"],
      finish,
      JapanPrint: index % 10 === 0,
      addedAt: "2025-01-01T00:00:00.000Z",
      bucket
    };
  });
}

function dateKeyUtc(date) {
  return date.toISOString().slice(0, 10);
}

function buildPriceHistory(cards, days = 180) {
  const sourceCards = Array.isArray(cards) ? cards : [];
  const snapshotCount = Math.max(0, Number(days) || 0);
  const snapshots = {};
  for (let day = 0; day < snapshotCount; day += 1) {
    const date = dateKeyUtc(new Date(Date.UTC(2025, 0, 1 + day)));
    const snapshotCards = {};
    let totalUsd = 0;
    sourceCards.forEach((card, index) => {
      const base = card.finish === "nonfoil" ? Number(card.prices.usd) : Number(card.prices.usdFoil);
      const usd = Math.round((base + day * 0.01 + (index % 3) * 0.01) * 100) / 100;
      snapshotCards[cardPriceKey(card, card.finish)] = usd;
      totalUsd += usd;
    });
    snapshots[date] = {
      date,
      totalUsd: Math.round(totalUsd * 100) / 100,
      cardCount: sourceCards.length,
      pricedCount: sourceCards.length,
      missingCount: 0,
      cards: snapshotCards
    };
  }
  return {
    version: 1,
    currency: "USD",
    updatedAt: snapshotCount ? `${Object.keys(snapshots).at(-1)}T00:00:00.000Z` : "",
    snapshots
  };
}

module.exports = { buildCards, buildPriceHistory };
