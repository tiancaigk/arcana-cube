const effects = [
  { name: "Basic", file: "basic.css", rarity: "common", note: "基础径向高光，没有额外箔面纹理。" },
  { name: "Reverse Holo", file: "reverse-holo.css", rarity: "common reverse holo", note: "反转箔：画面外区域获得明暗金属反射。" },
  { name: "Regular Holo", file: "regular-holo.css", rarity: "rare holo", note: "经典窗口闪，彩色扫描线集中在画面区域。" },
  { name: "Cosmos Holo", file: "cosmos-holo.css", rarity: "rare holo cosmos", note: "宇宙星点纹理叠加连续彩虹色带。" },
  { name: "Amazing Rare", file: "amazing-rare.css", rarity: "amazing rare", note: "高亮颗粒、径向亮斑与多层柔光。" },
  { name: "Radiant Holo", file: "radiant-holo.css", rarity: "radiant rare", note: "细密交叉斜纹形成放射状金属网格。" },
  { name: "V Regular", file: "v-regular.css", rarity: "rare holo v", note: "颗粒底纹上的对角光谱与深色金属带。" },
  { name: "V Full Art", file: "v-full-art.css", rarity: "rare ultra", note: "更完整的全卡金属纹理与光谱分色。" },
  { name: "V Max", file: "v-max.css", rarity: "rare holo vmax", note: "大尺度、慢变化的深色光谱和 VMAX 纹理。" },
  { name: "V Star", file: "v-star.css", rarity: "rare holo vstar", note: "偏亮的粉彩斜纹，反射比 VMAX 更轻。" },
  { name: "Trainer Full Art", file: "trainer-full-art.css", rarity: "rare ultra", supertype: "trainer", subtypes: "supporter", note: "继承全图金属层，并强化白色聚光与对比。" },
  { name: "Rainbow Holo", file: "rainbow-holo.css", rarity: "rare rainbow", note: "柔和彩虹底色配合细颗粒闪粉。" },
  { name: "Rainbow Alt", file: "rainbow-alt.css", rarity: "rare rainbow alt", note: "更深、更强烈的彩虹色带与闪粉纹理。" },
  { name: "Secret Rare Gold", file: "secret-rare.css", rarity: "rare secret", note: "双层闪粉、锥形色谱与金色高对比反射。" },
  { name: "Trainer Gallery Holo", file: "trainer-gallery-holo.css", rarity: "trainer gallery rare holo", note: "大面积金属虹彩，保留相对干净的卡缘。" },
  { name: "Trainer Gallery V", file: "trainer-gallery-v-regular.css", rarity: "rare holo v", trainerGallery: true, note: "Full Art 金属层配合更克制的表面眩光。" },
  { name: "Trainer Gallery V Max", file: "trainer-gallery-v-max.css", rarity: "rare holo vmax", trainerGallery: true, note: "彩虹 Alt 材质配合柔和的中心径向眩光。" },
  { name: "Trainer Gallery Secret", file: "trainer-gallery-secret-rare.css", rarity: "rare secret", trainerGallery: true, note: "黑金几何纹理与三层错位反射。" },
  { name: "Shiny Rare", file: "shiny-rare.css", rarity: "rare shiny", note: "局部银箔、低饱和光谱与细密金属条纹。" },
  { name: "Shiny V", file: "shiny-v.css", rarity: "rare shiny v", note: "全卡银色金属箔与高对比斜向纹理。" },
  { name: "Shiny V Max", file: "shiny-vmax.css", rarity: "rare shiny vmax", note: "银黑底色上叠加双层闪粉和彩虹反射。" },
  { name: "SWSH Pikachu", file: "swsh-pikachu.css", rarity: "rare secret", set: "swsh12pt5", number: "160", note: "专属彩虹 Secret 变体，色带和眩光参数独立。" }
];

const grid = document.querySelector("#effect-grid");
const toggle = document.querySelector("#cruise-toggle");
const imageUrl = "images/fca-4-counterspell.png";
let cruising = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let animationFrame = 0;

function cardMarkup(effect, index) {
  const supertype = effect.supertype ?? "pokémon";
  const subtypes = effect.subtypes ?? "basic";
  const trainerGallery = effect.trainerGallery ? "true" : "false";
  const set = effect.set ?? "fca";
  const number = effect.number ?? "4";

  return `
    <article class="effect-tile">
      <div class="effect-meta">
        <span class="effect-number">${String(index + 1).padStart(2, "0")}</span>
        <div class="effect-title">
          <strong>${effect.name}</strong>
          <span>${effect.file}</span>
        </div>
      </div>
      <div class="card-stage">
        <div
          class="card water interactive"
          data-effect-index="${index}"
          data-rarity="${effect.rarity}"
          data-supertype="${supertype}"
          data-subtypes="${subtypes}"
          data-trainer-gallery="${trainerGallery}"
          data-set="${set}"
          data-number="${number}"
        >
          <div class="card__translater">
            <div class="card__rotator" role="img" aria-label="FCA 4 Counterspell，${effect.name} 特效">
              <div class="card__front">
                <img src="${imageUrl}" alt="FCA 4 Counterspell" width="745" height="1040" draggable="false" />
                <div class="card__shine"></div>
                <div class="card__glare"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p class="effect-note">${effect.note}</p>
    </article>`;
}

grid.innerHTML = effects.map(cardMarkup).join("");

const cards = [...document.querySelectorAll(".card")];

function clamp(value, min = 0, max = 100) {
  return Math.min(Math.max(value, min), max);
}

function setLight(card, x, y, opacity = 1, tilt = true) {
  const centerX = x - 50;
  const centerY = y - 50;
  const distance = clamp(Math.hypot(centerX, centerY) / 50, 0, 1);
  const backgroundX = 37 + (x / 100) * 26;
  const backgroundY = 33 + (y / 100) * 34;

  card.style.setProperty("--pointer-x", `${x.toFixed(2)}%`);
  card.style.setProperty("--pointer-y", `${y.toFixed(2)}%`);
  card.style.setProperty("--pointer-from-center", distance.toFixed(4));
  card.style.setProperty("--pointer-from-top", (y / 100).toFixed(4));
  card.style.setProperty("--pointer-from-left", (x / 100).toFixed(4));
  card.style.setProperty("--background-x", `${backgroundX.toFixed(2)}%`);
  card.style.setProperty("--background-y", `${backgroundY.toFixed(2)}%`);
  card.style.setProperty("--card-opacity", opacity.toFixed(3));
  card.style.setProperty("--rotate-x", `${tilt ? (-centerX / 8).toFixed(2) : 0}deg`);
  card.style.setProperty("--rotate-y", `${tilt ? (centerY / 8).toFixed(2) : 0}deg`);
}

function resetCard(card) {
  card.classList.remove("is-pointing");
  if (!cruising) setLight(card, 50, 50, 0.16, false);
}

for (const card of cards) {
  const rotator = card.querySelector(".card__rotator");

  rotator.addEventListener("pointerenter", () => {
    card.classList.add("is-pointing");
  });

  rotator.addEventListener("pointermove", (event) => {
    const rect = rotator.getBoundingClientRect();
    const x = clamp(((event.clientX - rect.left) / rect.width) * 100);
    const y = clamp(((event.clientY - rect.top) / rect.height) * 100);
    setLight(card, x, y, 1, true);
  });

  rotator.addEventListener("pointerleave", () => resetCard(card));
}

function animate(time) {
  if (cruising) {
    const x = 50 + Math.sin(time / 1750) * 39;
    const y = 50 + Math.cos(time / 2300) * 34;
    for (const card of cards) {
      if (!card.classList.contains("is-pointing")) setLight(card, x, y, 0.82, false);
    }
  }
  animationFrame = requestAnimationFrame(animate);
}

function syncToggle() {
  toggle.classList.toggle("is-active", cruising);
  toggle.setAttribute("aria-pressed", String(cruising));
  toggle.lastChild.textContent = cruising ? " 同步巡光" : " 静止比较";
  if (!cruising) cards.forEach(resetCard);
}

toggle.addEventListener("click", () => {
  cruising = !cruising;
  syncToggle();
});

syncToggle();
animationFrame = requestAnimationFrame(animate);

window.addEventListener("pagehide", () => cancelAnimationFrame(animationFrame), { once: true });
