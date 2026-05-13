/**
 * Vizit Destesi — çoklu deste, JSON içe aktarma, kart düzenleme, yerel görsel.
 */
import {
  openDb,
  getAllDecks,
  putDeck,
  deleteDeck,
  getMeta,
  setMeta,
} from "./idb.js";

const META_ACTIVE = "activeDeckId";

const VISIBLE_STACK = 8;
const STACK_OFFSET_Y = 2;
const STACK_OFFSET_X = 1.2;

const MAX_IMAGE_BYTES = 600 * 1024;

const DECK_EL = document.getElementById("deck");
const ACTIVE_EL = document.getElementById("active-slot");
const REMAINING_EL = document.getElementById("remaining");
const DRAWN_EL = document.getElementById("drawn-count");
const TOTAL_EL = document.getElementById("total");
const BTN_DRAW = document.getElementById("btn-draw");
const BTN_SHUFFLE = document.getElementById("btn-shuffle");
const BTN_RESET = document.getElementById("btn-reset");
const BTN_OPEN_EDITOR = document.getElementById("btn-open-editor");
const HINT_EL = document.getElementById("hint");
const STATUS_EL = document.getElementById("status-msg");
const ACTIVE_DECK_LABEL = document.getElementById("active-deck-label");
const DECK_LIST_EL = document.getElementById("deck-list");
const BTN_IMPORT_JSON = document.getElementById("btn-import-json");
const FILE_JSON = document.getElementById("file-json-import");
const BTN_NEW_EMPTY = document.getElementById("btn-new-empty");
const BTN_EXPORT_JSON = document.getElementById("btn-export-json");
const BTN_DELETE_DECK = document.getElementById("btn-delete-deck");

const MOD_DECK = document.getElementById("modal-deck-editor");
const MOD_DECK_CLOSE = document.getElementById("deck-editor-close");
const MOD_DECK_CANCEL = document.getElementById("deck-editor-cancel");
const MOD_DECK_SAVE = document.getElementById("deck-editor-save");
const DECK_SEARCH = document.getElementById("deck-editor-search");
const DECK_TBODY = document.getElementById("deck-editor-tbody");
const CHECK_MASTER = document.getElementById("check-master");
const BTN_SEL_ALL = document.getElementById("btn-select-all");
const BTN_SEL_NONE = document.getElementById("btn-select-none");
const BTN_RM_SEL = document.getElementById("btn-remove-selected");
const BTN_ADD_CARD = document.getElementById("btn-add-card");

const MOD_CARD = document.getElementById("modal-card-editor");
const MOD_CARD_CLOSE = document.getElementById("card-editor-close");
const MOD_CARD_CANCEL = document.getElementById("card-editor-cancel");
const MOD_CARD_SAVE = document.getElementById("card-editor-save");
const CARD_EDIT_ID = document.getElementById("card-edit-id");
const CARD_EDIT_Q = document.getElementById("card-edit-question");
const CARD_EDIT_A = document.getElementById("card-edit-answer");
const CARD_EDIT_FILE = document.getElementById("card-edit-image");
const CARD_EDIT_CLR = document.getElementById("card-edit-image-clear");
const CARD_PREVIEW_WRAP = document.getElementById("card-edit-preview-wrap");
const CARD_PREVIEW_IMG = document.getElementById("card-edit-preview");

let db = null;
let decks = [];
let activeDeckId = null;
let activeDeck = null;

let sessionRemaining = [];
let drawn = [];
let activeCardEl = null;
let isAnimating = false;

let editingCardUid = null;
let pendingImageData = null;

function uuid() {
  return crypto.randomUUID();
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function normalizeCard(raw, index) {
  const uid = raw.uid && typeof raw.uid === "string" ? raw.uid : uuid();
  const id = Number.isFinite(Number(raw.id)) ? Number(raw.id) : index + 1;
  return {
    uid,
    id,
    question: String(raw.question ?? "").trim(),
    answer: String(raw.answer ?? "").trim(),
    imageData:
      raw.imageData && typeof raw.imageData === "string"
        ? raw.imageData
        : raw.image && typeof raw.image === "string"
          ? raw.image
          : null,
  };
}

function normalizeImportedPayload(data) {
  if (Array.isArray(data)) {
    return {
      name: `İçe aktarılan (${new Date().toLocaleString("tr-TR")})`,
      category: "",
      builtIn: false,
      cards: data.map((c, i) => normalizeCard(c, i)),
    };
  }
  if (data && Array.isArray(data.cards)) {
    return {
      name: String(data.name || "Adsız deste").trim() || "Adsız deste",
      category: String(data.category || "").trim(),
      builtIn: false,
      cards: data.cards.map((c, i) => normalizeCard(c, i)),
    };
  }
  throw new Error("JSON: kök dizi veya { name?, category?, cards: [...] } olmalı.");
}

async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file, "UTF-8");
  });
}

async function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function setStatus(msg, type = "info") {
  STATUS_EL.textContent = msg;
  STATUS_EL.style.color =
    type === "warn" ? "var(--danger)" : type === "ok" ? "var(--forest)" : "";
}

function updateStats() {
  REMAINING_EL.textContent = sessionRemaining.length;
  DRAWN_EL.textContent = drawn.length;
  TOTAL_EL.textContent = activeDeck ? activeDeck.cards.length : 0;
  BTN_DRAW.disabled = sessionRemaining.length === 0 || isAnimating;
  BTN_SHUFFLE.disabled = sessionRemaining.length < 2 || isAnimating;
  BTN_RESET.disabled = drawn.length === 0 || isAnimating;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function createCardEl(card, withFront, categoryLabel) {
  const el = document.createElement("div");
  el.className = "card";
  el.dataset.uid = card.uid;
  el.dataset.id = String(card.id);
  const imgHtml = card.imageData
    ? `<div class="front-img-wrap"><img class="front-img" src="${escapeHtml(card.imageData)}" alt="" /></div>`
    : `<div class="front-img-wrap hidden"><img class="front-img" src="" alt="" /></div>`;
  const emptyAns = !card.answer;
  el.innerHTML = `
    <div class="face back">
      <div class="back-emblem">?</div>
      <div class="back-sub">Soru</div>
    </div>
    ${
      withFront
        ? `
    <div class="face front">
      <div class="front-head">
        <span class="front-id">#${card.id}</span>
        <span class="front-sub">${escapeHtml(categoryLabel || "")}</span>
      </div>
      ${imgHtml}
      <div class="front-question">${escapeHtml(card.question)}</div>
      <div class="front-answer hidden ${emptyAns ? "empty" : ""}">
        ${emptyAns ? "Cevap eklenmemiş." : escapeHtml(card.answer)}
      </div>
      <div class="front-actions">
        <button type="button" class="btn-mini primary full" data-act="toggle-answer">Cevabı Göster</button>
        <div class="front-actions-row">
          <button type="button" class="btn-mini danger" data-act="remove-permanent" title="Bu kart bir daha gelmesin">Desteden çıkar</button>
          <button type="button" class="btn-mini" data-act="put-back" title="Bu kartı havuza geri at, tekrar gelsin">Desteye tekrar ekle</button>
        </div>
      </div>
    </div>`
        : ""
    }
  `;
  if (!withFront) el.setAttribute("aria-hidden", "true");
  return el;
}

function attachFrontFace(cardEl, card, categoryLabel) {
  if (cardEl.querySelector(".front")) return;
  const emptyAns = !card.answer;
  const imgWrapClass = card.imageData ? "front-img-wrap" : "front-img-wrap hidden";
  const imgSrc = card.imageData ? escapeHtml(card.imageData) : "";
  const front = document.createElement("div");
  front.className = "face front";
  front.innerHTML = `
    <div class="front-head">
      <span class="front-id">#${card.id}</span>
      <span class="front-sub">${escapeHtml(categoryLabel || "")}</span>
    </div>
    <div class="${imgWrapClass}">
      <img class="front-img" src="${imgSrc}" alt="" />
    </div>
    <div class="front-question">${escapeHtml(card.question)}</div>
    <div class="front-answer hidden ${emptyAns ? "empty" : ""}">
      ${emptyAns ? "Cevap eklenmemiş." : escapeHtml(card.answer)}
    </div>
    <div class="front-actions">
      <button type="button" class="btn-mini primary full" data-act="toggle-answer">Cevabı Göster</button>
      <div class="front-actions-row">
        <button type="button" class="btn-mini danger" data-act="remove-permanent" title="Bu kart bir daha gelmesin">Desteden çıkar</button>
        <button type="button" class="btn-mini" data-act="put-back" title="Bu kartı havuza geri at, tekrar gelsin">Desteye tekrar ekle</button>
      </div>
    </div>
  `;
  cardEl.appendChild(front);
  cardEl.removeAttribute("aria-hidden");
}

function renderVisualDeck() {
  DECK_EL.innerHTML = "";
  const top = sessionRemaining.slice(-VISIBLE_STACK);
  const cat = activeDeck?.category || "";
  top.forEach((c, idx) => {
    const el = createCardEl(c, false, cat);
    const depth = top.length - 1 - idx;
    const jitter = (Math.random() - 0.5) * 1.2;
    el.style.transform =
      `translate(${-depth * STACK_OFFSET_X + jitter}px, ${-depth * STACK_OFFSET_Y}px) ` +
      `rotate(${jitter * 0.4}deg)`;
    el.style.zIndex = String(idx + 1);
    el.style.transition = "none";
    DECK_EL.appendChild(el);
  });
  requestAnimationFrame(() => {
    Array.from(DECK_EL.children).forEach((node) => (node.style.transition = ""));
  });
}

function clearActive() {
  if (activeCardEl) {
    activeCardEl.remove();
    activeCardEl = null;
  }
}

function resetSession() {
  clearActive();
  if (!activeDeck) {
    sessionRemaining = [];
    drawn = [];
  } else {
    sessionRemaining = shuffle(activeDeck.cards.slice());
    drawn = [];
  }
  renderVisualDeck();
  updateStats();
}

function flyOutCard(cardEl, direction, onDone) {
  cardEl.style.transition = "transform 500ms ease, opacity 500ms ease";
  const x = direction === "left" ? "-160%" : direction === "right" ? "60%" : "-50%";
  const y = direction === "up" ? "-180%" : "-50%";
  const rot = direction === "left" ? -14 : direction === "right" ? 14 : 0;
  cardEl.style.transform =
    `translate(${x}, ${y}) scale(0.85) rotate(${rot}deg) rotateY(180deg)`;
  cardEl.style.opacity = "0";
  setTimeout(() => {
    if (typeof onDone === "function") onDone();
  }, 500);
}

function toggleAnswerOnCard(cardEl) {
  const ans = cardEl.querySelector(".front-answer");
  const btn = cardEl.querySelector('[data-act="toggle-answer"]');
  if (!ans || !btn) return;
  const isHidden = ans.classList.contains("hidden");
  ans.classList.toggle("hidden");
  btn.textContent = isHidden ? "Cevabı Gizle" : "Cevabı Göster";
}

function bindCardActions(cardEl) {
  cardEl.addEventListener("click", async (e) => {
    const target = e.target.closest("[data-act]");

    if (!target) {
      if (cardEl.querySelector(".front-answer")) toggleAnswerOnCard(cardEl);
      return;
    }

    const act = target.dataset.act;

    if (act === "toggle-answer") {
      toggleAnswerOnCard(cardEl);
      return;
    }

    if (act === "put-aside") {
      flyOutCard(cardEl, "up", () => {
        clearActive();
        setStatus("Hazır. Yeni bir kart çekebilirsin.");
      });
      return;
    }

    const uid = cardEl.dataset.uid;
    if (!uid || !activeDeck) return;

    if (act === "remove-permanent") {
      activeDeck.cards = activeDeck.cards.filter((c) => c.uid !== uid);
      sessionRemaining = sessionRemaining.filter((c) => c.uid !== uid);
      drawn = drawn.filter((c) => c.uid !== uid);
      try {
        await persistDeck(activeDeck);
      } catch (err) {
        console.error(err);
      }
      flyOutCard(cardEl, "left", () => {
        clearActive();
        renderVisualDeck();
        renderDeckSidebar();
        updateActiveLabel();
        updateStats();
        setStatus("Kart desteden kalıcı olarak çıkarıldı.", "ok");
      });
      return;
    }

    if (act === "put-back") {
      const card = drawn.find((c) => c.uid === uid);
      drawn = drawn.filter((c) => c.uid !== uid);
      if (card) {
        const minGap = Math.min(3, sessionRemaining.length);
        const maxIdx = sessionRemaining.length;
        const idx = minGap + Math.floor(Math.random() * Math.max(1, maxIdx - minGap + 1));
        sessionRemaining.splice(Math.min(idx, sessionRemaining.length), 0, card);
      }
      flyOutCard(cardEl, "right", () => {
        clearActive();
        renderVisualDeck();
        updateStats();
        setStatus("Kart desteye geri eklendi, tekrar karşına çıkacak.", "ok");
      });
      return;
    }
  });
}

async function animateShuffle() {
  if (sessionRemaining.length < 2 || isAnimating) return;
  isAnimating = true;
  updateStats();
  setStatus("Karıştırılıyor…");
  const cards = Array.from(DECK_EL.children);
  cards.forEach((c) => {
    const rx = (Math.random() - 0.5) * 220;
    const ry = (Math.random() - 0.5) * 80 - 40;
    const rot = (Math.random() - 0.5) * 40;
    c.style.transform = `translate(${rx}px, ${ry}px) rotate(${rot}deg)`;
  });
  await delay(420);
  cards.forEach((c) => {
    const rx = (Math.random() - 0.5) * 260;
    const ry = (Math.random() - 0.5) * 100 - 20;
    const rot = (Math.random() - 0.5) * 50;
    c.style.transform = `translate(${rx}px, ${ry}px) rotate(${rot}deg)`;
  });
  await delay(420);
  sessionRemaining = shuffle(sessionRemaining);
  renderVisualDeck();
  await delay(320);
  isAnimating = false;
  updateStats();
  setStatus(`Deste karıştırıldı. ${sessionRemaining.length} kart hazır.`, "ok");
}

async function drawCard() {
  if (isAnimating || sessionRemaining.length === 0) return;
  isAnimating = true;
  setStatus("Kart çekiliyor…");
  clearActive();
  const card = sessionRemaining.pop();
  drawn.push(card);
  const topEl = DECK_EL.lastElementChild;
  let movingEl;
  const cat = activeDeck?.category || "";
  if (topEl) {
    movingEl = topEl;
    DECK_EL.removeChild(movingEl);
    attachFrontFace(movingEl, card, cat);
  } else {
    movingEl = createCardEl(card, true, cat);
  }
  movingEl.classList.add("drawn");
  ACTIVE_EL.appendChild(movingEl);
  movingEl.style.position = "absolute";
  movingEl.style.left = "50%";
  movingEl.style.top = "50%";
  movingEl.style.transition = "none";
  movingEl.style.transform = "translate(-50%, -50%) scale(0.94) rotate(0deg)";
  requestAnimationFrame(() => {
    movingEl.style.transition =
      "transform 700ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 700ms ease";
    movingEl.style.transform =
      "translate(-50%, -50%) scale(1.05) rotateY(180deg)";
    movingEl.style.boxShadow = "0 32px 64px -20px rgba(44,51,56,0.25)";
  });
  bindCardActions(movingEl);
  activeCardEl = movingEl;
  renderVisualDeck();
  await delay(780);
  isAnimating = false;
  updateStats();
  setStatus(
    sessionRemaining.length === 0
      ? "Havuz boşaldı. Sıfırla veya başka deste seç."
      : `Kart #${card.id} çekildi. (Kalan: ${sessionRemaining.length})`,
    sessionRemaining.length === 0 ? "warn" : "ok"
  );
}

async function resetDrawn() {
  if (isAnimating || !activeDeck) return;
  isAnimating = true;
  setStatus("Deste oyunu sıfırlanıyor…");
  clearActive();
  sessionRemaining = shuffle(activeDeck.cards.slice());
  drawn = [];
  renderVisualDeck();
  await delay(180);
  const cards = Array.from(DECK_EL.children);
  cards.forEach((c, idx) => {
    c.style.transition = "none";
    c.style.transform = "translateY(-120vh) rotate(16deg)";
    c.style.opacity = "0";
    setTimeout(() => {
      c.style.transition = "";
      const depth = cards.length - 1 - idx;
      const jitter = (Math.random() - 0.5) * 1.2;
      c.style.transform =
        `translate(${-depth * STACK_OFFSET_X + jitter}px, ${-depth * STACK_OFFSET_Y}px) ` +
        `rotate(${jitter * 0.4}deg)`;
      c.style.opacity = "1";
    }, idx * 28);
  });
  await delay(cards.length * 28 + 480);
  isAnimating = false;
  updateStats();
  setStatus(`Oturum sıfırlandı. ${sessionRemaining.length} kart havuzda.`, "ok");
}

async function persistDeck(deck) {
  deck.updatedAt = Date.now();
  await putDeck(db, deck);
}

function renderDeckSidebar() {
  DECK_LIST_EL.innerHTML = "";
  decks
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .forEach((d) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "deck-row" + (d.id === activeDeckId ? " active" : "");
      btn.innerHTML = `
        <span class="deck-row-name">${escapeHtml(d.name)}</span>
        <span class="deck-row-meta">${d.cards.length}</span>
      `;
      btn.addEventListener("click", () => selectDeck(d.id));
      DECK_LIST_EL.appendChild(btn);
    });
}

function updateActiveLabel() {
  if (!activeDeck) {
    ACTIVE_DECK_LABEL.textContent = "Deste seçilmedi";
    return;
  }
  const n = activeDeck.cards.length;
  ACTIVE_DECK_LABEL.textContent = `${activeDeck.name} · ${n} kart${
    activeDeck.category ? " · " + activeDeck.category : ""
  }`;
}

async function selectDeck(id) {
  const d = decks.find((x) => x.id === id);
  if (!d) return;
  activeDeckId = id;
  activeDeck = d;
  await setMeta(db, META_ACTIVE, id);
  updateActiveLabel();
  resetSession();
  renderDeckSidebar();
  setStatus(`"${d.name}" seçildi.`, "ok");
}

async function ensureDefaultDeck() {
  const res = await fetch("default_deck.json");
  if (!res.ok) throw new Error("default_deck.json bulunamadı");
  const raw = await res.json();
  const payload = normalizeImportedPayload(raw);
  payload.id = uuid();
  payload.builtIn = true;
  payload.updatedAt = Date.now();
  await putDeck(db, payload);
  decks = [payload];
  await setMeta(db, META_ACTIVE, payload.id);
}

async function initDbAndDecks() {
  db = await openDb();
  decks = await getAllDecks(db);
  if (!decks.length) {
    await ensureDefaultDeck();
    decks = await getAllDecks(db);
  }
  activeDeckId = (await getMeta(db, META_ACTIVE)) || decks[0]?.id || null;
  activeDeck = decks.find((d) => d.id === activeDeckId) || decks[0] || null;
  if (activeDeck) activeDeckId = activeDeck.id;
  if (activeDeckId) await setMeta(db, META_ACTIVE, activeDeckId);
  updateActiveLabel();
  resetSession();
  renderDeckSidebar();
}

async function addDeckFromPayload(payload) {
  const deck = {
    id: uuid(),
    name: payload.name,
    category: payload.category || "",
    builtIn: !!payload.builtIn,
    updatedAt: Date.now(),
    cards: payload.cards,
  };
  decks.push(deck);
  await putDeck(db, deck);
  await selectDeck(deck.id);
  renderDeckSidebar();
}

async function handleJsonFile(file) {
  const text = await readFileAsText(file);
  const data = JSON.parse(text);
  const payload = normalizeImportedPayload(data);
  await addDeckFromPayload(payload);
  setStatus(`"${payload.name}" destesi eklendi (${payload.cards.length} kart).`, "ok");
}

async function handleNewEmptyDeck() {
  const name = prompt("Yeni deste adı:", "Yeni deste");
  if (name === null) return;
  await addDeckFromPayload({
    name: name.trim() || "Yeni deste",
    category: "",
    cards: [],
  });
  setStatus("Boş deste oluşturuldu. Desteyi düzenle ile kart ekleyebilirsin.", "ok");
}

function exportActiveDeckJson() {
  if (!activeDeck) return;
  const payload = {
    name: activeDeck.name,
    category: activeDeck.category || "",
    cards: activeDeck.cards.map((c) => ({
      uid: c.uid,
      id: c.id,
      question: c.question,
      answer: c.answer,
      image: c.imageData || undefined,
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const a = document.createElement("a");
  const safe = activeDeck.name.replace(/[^\w\u00C0-\u024f-]+/gi, "_").slice(0, 48);
  a.href = URL.createObjectURL(blob);
  a.download = `deste-${safe || "export"}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus("JSON indirildi.", "ok");
}

async function addBlankCardToDeck() {
  if (!activeDeck) return;
  const maxId = activeDeck.cards.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0);
  activeDeck.cards.push({
    uid: uuid(),
    id: maxId + 1,
    question: "Yeni soru metnini yazın.",
    answer: "",
    imageData: null,
  });
  await persistDeck(activeDeck);
  renderDeckEditorTable();
  syncMasterCheck();
  renderDeckSidebar();
  updateActiveLabel();
  setStatus("Yeni kart eklendi.", "ok");
}

async function handleDeleteDeck() {
  if (!activeDeck) return;
  if (decks.length <= 1) {
    alert("Son kalan deste silinemez. Önce başka bir deste ekleyin.");
    return;
  }
  if (!confirm(`"${activeDeck.name}" silinsin mi?`)) return;
  const id = activeDeck.id;
  await deleteDeck(db, id);
  decks = decks.filter((d) => d.id !== id);
  const next = decks[0];
  await selectDeck(next.id);
  renderDeckSidebar();
  setStatus("Deste silindi.", "ok");
}

function openModal(el) {
  el.classList.remove("hidden");
}

function closeModal(el) {
  el.classList.add("hidden");
}

function renderDeckEditorTable() {
  const q = DECK_SEARCH.value.trim().toLowerCase();
  DECK_TBODY.innerHTML = "";
  if (!activeDeck) return;
  const rows = activeDeck.cards
    .map((c, idx) => ({ c, idx }))
    .filter(
      ({ c }) =>
        !q || c.question.toLowerCase().includes(q) || String(c.id).includes(q)
    );

  rows.forEach(({ c }) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="col-check"><input type="checkbox" data-uid="${escapeHtml(c.uid)}" /></td>
      <td>${c.id}</td>
      <td>${escapeHtml(c.question.slice(0, 120))}${c.question.length > 120 ? "…" : ""}</td>
      <td class="col-actions">
        <button type="button" class="btn btn-small" data-edit="${escapeHtml(c.uid)}">Düzenle</button>
      </td>
    `;
    DECK_TBODY.appendChild(tr);
  });

  DECK_TBODY.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () =>
      openCardEditor(btn.getAttribute("data-edit"))
    );
  });
}

function syncMasterCheck() {
  const boxes = DECK_TBODY.querySelectorAll('input[type="checkbox"][data-uid]');
  if (!boxes.length) {
    CHECK_MASTER.checked = false;
    CHECK_MASTER.indeterminate = false;
    return;
  }
  const checked = [...boxes].filter((b) => b.checked).length;
  CHECK_MASTER.checked = checked === boxes.length;
  CHECK_MASTER.indeterminate = checked > 0 && checked < boxes.length;
}

function openDeckEditor() {
  if (!activeDeck) return;
  DECK_SEARCH.value = "";
  renderDeckEditorTable();
  syncMasterCheck();
  openModal(MOD_DECK);
}

function closeDeckEditor() {
  closeModal(MOD_DECK);
}

async function saveDeckEditorAndClose() {
  await persistDeck(activeDeck);
  renderDeckSidebar();
  updateActiveLabel();
  resetSession();
  closeDeckEditor();
  setStatus("Deste kaydedildi.", "ok");
}

async function removeSelectedCardsFromDeck() {
  const uids = new Set(
    [...DECK_TBODY.querySelectorAll("input[data-uid]:checked")].map((i) =>
      i.getAttribute("data-uid")
    )
  );
  if (!uids.size) {
    setStatus("Önce satırları işaretleyin.", "warn");
    return;
  }
  activeDeck.cards = activeDeck.cards.filter((c) => !uids.has(c.uid));
  sessionRemaining = sessionRemaining.filter((c) => !uids.has(c.uid));
  drawn = drawn.filter((c) => !uids.has(c.uid));
  await persistDeck(activeDeck);
  renderDeckEditorTable();
  syncMasterCheck();
  renderVisualDeck();
  renderDeckSidebar();
  updateActiveLabel();
  updateStats();
  setStatus(`${uids.size} kart kaldırıldı ve kaydedildi.`, "ok");
}

function openCardEditor(uid) {
  const card = activeDeck.cards.find((c) => c.uid === uid);
  if (!card) return;
  editingCardUid = uid;
  pendingImageData = card.imageData || null;
  CARD_EDIT_ID.value = String(card.id);
  CARD_EDIT_Q.value = card.question;
  CARD_EDIT_A.value = card.answer;
  CARD_EDIT_FILE.value = "";
  if (pendingImageData) {
    CARD_PREVIEW_IMG.src = pendingImageData;
    CARD_PREVIEW_WRAP.classList.remove("hidden");
  } else {
    CARD_PREVIEW_IMG.removeAttribute("src");
    CARD_PREVIEW_WRAP.classList.add("hidden");
  }
  openModal(MOD_CARD);
}

function closeCardEditor() {
  editingCardUid = null;
  pendingImageData = null;
  CARD_EDIT_FILE.value = "";
  closeModal(MOD_CARD);
}

async function saveCardEditor() {
  const card = activeDeck.cards.find((c) => c.uid === editingCardUid);
  if (!card) return;
  card.id = Math.max(1, Math.min(9999, Number(CARD_EDIT_ID.value) || card.id));
  card.question = CARD_EDIT_Q.value.trim();
  card.answer = CARD_EDIT_A.value.trim();
  card.imageData = pendingImageData;
  await persistDeck(activeDeck);
  renderDeckEditorTable();
  syncMasterCheck();
  renderDeckSidebar();
  updateActiveLabel();
  closeCardEditor();
  setStatus("Kart güncellendi ve kaydedildi.", "ok");
}

BTN_DRAW.addEventListener("click", drawCard);

DECK_EL.addEventListener("click", () => {
  if (!BTN_DRAW.disabled) drawCard();
});
BTN_SHUFFLE.addEventListener("click", animateShuffle);
BTN_RESET.addEventListener("click", resetDrawn);
BTN_OPEN_EDITOR.addEventListener("click", openDeckEditor);

BTN_IMPORT_JSON.addEventListener("click", () => FILE_JSON.click());
FILE_JSON.addEventListener("change", async () => {
  const f = FILE_JSON.files?.[0];
  FILE_JSON.value = "";
  if (!f) return;
  try {
    await handleJsonFile(f);
  } catch (e) {
    console.error(e);
    setStatus("JSON okunamadı: " + (e.message || e), "warn");
  }
});

BTN_NEW_EMPTY.addEventListener("click", () => handleNewEmptyDeck());
BTN_EXPORT_JSON.addEventListener("click", () => exportActiveDeckJson());
BTN_DELETE_DECK.addEventListener("click", () => handleDeleteDeck());

MOD_DECK_CLOSE.addEventListener("click", closeDeckEditor);
MOD_DECK_CANCEL.addEventListener("click", closeDeckEditor);
MOD_DECK_SAVE.addEventListener("click", () => saveDeckEditorAndClose());
DECK_SEARCH.addEventListener("input", () => {
  renderDeckEditorTable();
  syncMasterCheck();
});

CHECK_MASTER.addEventListener("change", () => {
  const on = CHECK_MASTER.checked;
  DECK_TBODY.querySelectorAll("input[data-uid]").forEach((b) => {
    b.checked = on;
  });
});
DECK_TBODY.addEventListener("change", (e) => {
  if (e.target.matches("input[data-uid]")) syncMasterCheck();
});

BTN_SEL_ALL.addEventListener("click", () => {
  DECK_TBODY.querySelectorAll("input[data-uid]").forEach((b) => {
    b.checked = true;
  });
  syncMasterCheck();
});
BTN_SEL_NONE.addEventListener("click", () => {
  DECK_TBODY.querySelectorAll("input[data-uid]").forEach((b) => {
    b.checked = false;
  });
  syncMasterCheck();
});
BTN_RM_SEL.addEventListener("click", () => removeSelectedCardsFromDeck());
BTN_ADD_CARD.addEventListener("click", () => addBlankCardToDeck());

MOD_CARD_CLOSE.addEventListener("click", closeCardEditor);
MOD_CARD_CANCEL.addEventListener("click", closeCardEditor);
MOD_CARD_SAVE.addEventListener("click", () => saveCardEditor());

CARD_EDIT_FILE.addEventListener("change", async () => {
  const f = CARD_EDIT_FILE.files?.[0];
  if (!f) return;
  if (f.size > MAX_IMAGE_BYTES) {
    alert(
      `Dosya çok büyük (>${Math.round(MAX_IMAGE_BYTES / 1024)} KB). Daha küçük bir görsel seçin.`
    );
    CARD_EDIT_FILE.value = "";
    return;
  }
  try {
    pendingImageData = await readFileAsDataURL(f);
    CARD_PREVIEW_IMG.src = pendingImageData;
    CARD_PREVIEW_WRAP.classList.remove("hidden");
  } catch (e) {
    console.error(e);
    setStatus("Görsel okunamadı.", "warn");
  }
});

CARD_EDIT_CLR.addEventListener("click", () => {
  pendingImageData = null;
  CARD_EDIT_FILE.value = "";
  CARD_PREVIEW_IMG.removeAttribute("src");
  CARD_PREVIEW_WRAP.classList.add("hidden");
});

document.addEventListener("keydown", (e) => {
  if (
    e.target.tagName === "INPUT" ||
    e.target.tagName === "TEXTAREA" ||
    e.target.tagName === "SELECT"
  )
    return;
  const deckOpen = !MOD_DECK.classList.contains("hidden");
  const cardOpen = !MOD_CARD.classList.contains("hidden");
  if (deckOpen || cardOpen) return;
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    if (!BTN_DRAW.disabled) drawCard();
  } else if (e.key.toLowerCase() === "s") {
    if (!BTN_SHUFFLE.disabled) animateShuffle();
  } else if (e.key.toLowerCase() === "r") {
    if (!BTN_RESET.disabled) resetDrawn();
  } else if (e.key.toLowerCase() === "c" && activeCardEl) {
    const btn = activeCardEl.querySelector('[data-act="toggle-answer"]');
    if (btn) btn.click();
  }
});

async function init() {
  HINT_EL.innerHTML =
    "Kısayollar: <b>Space/Enter</b> kart çek · <b>S</b> karıştır · <b>R</b> sıfırla · <b>C</b> cevap. " +
    "JSON: <code>{ \"name\", \"category?\", \"cards\": [{ \"id\", \"question\", \"answer\", \"image\"? }] }</code> veya sadece <code>cards</code> dizisi.";
  try {
    await initDbAndDecks();
    setStatus(`Hazır. ${activeDeck?.cards.length ?? 0} kart.`, "ok");
  } catch (err) {
    console.error(err);
    setStatus(
      "Başlatılamadı. HTTP sunucusu kullanın; default_deck.json gerekli.",
      "warn"
    );
  }
}

init();
