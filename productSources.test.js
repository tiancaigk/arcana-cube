const test = require("node:test");
const assert = require("node:assert/strict");
const {
  collapseProducts,
  createProductSourceCatalog,
  isPaperProduct,
  productType,
  selectProductSources,
  validateIndex
} = require("./productSources.js");
const { buildDeckCardMap, buildIndexScript, isDirectProductSource } = require("./scripts/build-product-source-index.js");

function product(uuid, name, category, subtype) {
  return { uuid, name, category, subtype, releaseDate: "" };
}

test("product types distinguish collector boosters and fixed preconstructed decks", () => {
  assert.equal(productType(product("collector", "Collector Booster Pack", "booster_pack", "collector")), "collector");
  assert.equal(productType(product("deck", "Timeless Wisdom", "deck", "commander")), "precon");
});

test("paper product filtering removes online redemptions without rejecting physical branded products", () => {
  assert.equal(isPaperProduct(product("mtgo", "Kaladesh MTGO Redemption Foil", "box_set", "")), false);
  assert.equal(isPaperProduct(product("arena", "2021 Arena Starter Kit", "multiple_decks", "two_player_starter")), true);
  assert.equal(isPaperProduct(product("sld", "Secret Lair x Hatsune Miku Digital Sensation", "box_set", "secret_lair")), true);
});

test("collector pack, box, and case collapse to the most useful pack entry", () => {
  const collapsed = collapseProducts([
    product("case", "Double Masters 2022 Collector Booster Box Case", "booster_case", "collector"),
    product("box", "Double Masters 2022 Collector Booster Box", "booster_box", "collector"),
    product("pack", "Double Masters 2022 Collector Booster Pack", "booster_pack", "collector")
  ]);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].uuid, "pack");
  assert.equal(collapsed[0].typeLabel, "聚珍补充包");
  assert.equal(collapsed[0].availability, "随机可能开出");
});

test("a specific deck suppresses its aggregate deck set product", () => {
  const collapsed = collapseProducts([
    product("deck", "Commander 2020 Commander Deck Timeless Wisdom", "deck", "commander"),
    product("set", "Commander 2020 Commander Decks Set of 5", "subset", "commander")
  ]);
  assert.deepEqual(collapsed.map((item) => item.uuid), ["deck"]);
  assert.equal(collapsed[0].availability, "固定收录");
});

test("deck wrappers are omitted when a printing only comes from an included sample pack", () => {
  const wrapper = {
    uuid: "deck",
    category: "deck",
    contents: {
      deck: [{ set: "MOC" }],
      sealed: [{ uuid: "sample-pack" }]
    }
  };
  const deckCards = buildDeckCardMap([["MOC", {
    data: {
      decks: [{
        sealedProductUuids: ["deck"],
        mainBoard: [{ uuid: "fixed-card" }]
      }]
    }
  }]]);
  assert.equal(isDirectProductSource(wrapper, { uuid: "random-card", setCode: "MUL", number: "1" }, new Set(["deck", "sample-pack"]), deckCards), false);
  assert.equal(isDirectProductSource(wrapper, { uuid: "fixed-card", setCode: "MOC", number: "1" }, new Set(["deck", "sample-pack"]), deckCards), true);
});

test("outer bundles are omitted unless they directly contain the exact printing", () => {
  const wrapper = {
    uuid: "bundle",
    category: "box_set",
    contents: {
      card: [{ set: "SLP", number: "11" }],
      sealed: [{ uuid: "draft-pack" }]
    }
  };
  assert.equal(isDirectProductSource(wrapper, { uuid: "random-card", setCode: "MUL", number: "1" }, new Set(["bundle", "draft-pack"])), false);
  assert.equal(isDirectProductSource(wrapper, { uuid: "direct-card", setCode: "SLP", number: "11" }, new Set(["bundle", "draft-pack"])), true);
});

test("foil selection includes traditional and etched sources without mixing nonfoil", () => {
  const shared = product("shared", "Collector Booster Pack", "booster_pack", "collector");
  const entry = {
    sources: {
      foil: [shared],
      etched: [shared],
      nonfoil: [product("draft", "Draft Booster Pack", "booster_pack", "draft")]
    }
  };
  const products = selectProductSources(entry, "foil");
  assert.equal(products.length, 1);
  assert.deepEqual(products[0].finishLabels, ["Foil", "Etched Foil"]);
});

test("compact indexes resolve shared product records by UUID", () => {
  const products = selectProductSources(
    { sources: { foil: ["pack"] } },
    "foil",
    { pack: product("pack", "Collector Booster Pack", "booster_pack", "collector") }
  );
  assert.equal(products[0].name, "Collector Booster Pack");
});

test("catalog caches and validates the generated index", async () => {
  let requests = 0;
  const payload = {
    format: "arcana-cube-product-sources",
    version: 1,
    source: { name: "MTGJSON", version: "5.3.0" },
    products: {
      pack: product("pack", "Collector Booster Pack", "booster_pack", "collector")
    },
    cards: {
      card: {
        sources: {
          foil: ["pack"]
        }
      }
    }
  };
  const catalog = createProductSourceCatalog({
    fetchImpl: async () => {
      requests += 1;
      return { ok: true, json: async () => payload };
    }
  });
  const [first, second] = await Promise.all([
    catalog.lookup({ scryfallId: "card", finish: "foil" }),
    catalog.lookup({ scryfallId: "card", finish: "foil" })
  ]);
  assert.equal(requests, 1);
  assert.equal(first.products[0].type, "collector");
  assert.equal(second.products[0].uuid, "pack");
  assert.equal(validateIndex(payload), true);
});

test("catalog prefers a local script index for direct file pages", async () => {
  let fetches = 0;
  let fallbacks = 0;
  const payload = {
    format: "arcana-cube-product-sources",
    version: 1,
    products: {},
    cards: {}
  };
  const catalog = createProductSourceCatalog({
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("Failed to fetch");
    },
    preferFallback: true,
    loadFallback: async () => {
      fallbacks += 1;
      return payload;
    }
  });
  await catalog.loadIndex();
  assert.equal(fetches, 0);
  assert.equal(fallbacks, 1);
});

test("generated script indexes expose the same payload without fetch", () => {
  const vm = require("node:vm");
  const payload = {
    format: "arcana-cube-product-sources",
    version: 1,
    products: {},
    cards: { "line-separator": { note: "\u2028" } }
  };
  const context = {};
  vm.runInNewContext(buildIndexScript(payload), context);
  assert.equal(context.CubeProductSourceIndex.cards["line-separator"].note, "\u2028");
});
