// ==UserScript==
// @name         1 - Amazon Vine ITEM HIGHLIGHTER + Rocket + Telegram Notify + Category Monitor Incremental
// @namespace    http://tampermonkey.net/
// @version      2.9.2
// @description  Evidenzia nuovi item, target blu, aggiunge razzo e invia messaggi Telegram. Monitor incrementale per CSI e Alimentari con unico popup.
// @match        https://www.amazon.it/vine/vine-items*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // ---------- CONFIG ----------
  const SEEN_RECOMMENDATIONS_KEY = 'seen_recommendations';
  const MAX_ITEMS = 200000;
  const RECENT_MS = 60 * 1000; // 1 minuto
  const MONITORED_CATEGORIES = [
    { name: "Commercio, Industria e Scienza", emoji: "🤖" },
    { nameStart: "Alimentari", emoji: "🍏" }
  ];

  const targetBrands = ["Amazon", "Sony", "MAONO", "Moulinex", "SoundPEATS", "Bose", "Neewer", "Godox", "FeiyuTech", "Smallrig", "ZHIYUN", "BOYA", "OutIn", "DJI", "Osmo", "pla", "petg", "abs", "tpu", "shark", "geeekpi", "tineco", "Marley"];
  const targetAsins = ["B0YYYYYYX", "B0YYYYYYY"];
  const url = window.location.href;
  const enableRocket = url.includes("queue=encore") || url.includes("queue=last_chance") || url.includes("queue=potluck");

  // ---------- TELEGRAM ----------
  const botToken = '8317261377:AAGYuN5kW4ssFEfwe97ts28Iwm_vwDQ1N8Q';
  const chatID = '-5014430330';

  function send(text) {
    if (!text.toString().trim()) return;
    fetch(`https://api.telegram.org/bot${botToken}/sendMessage?chat_id=${chatID}&text=${encodeURIComponent(text)}`)
      .then(r => r.json())
      .then(data => console.log("Messaggio Telegram inviato:", data))
      .catch(err => console.error("Errore Telegram:", err));
  }

  function getPageLabel() {
    if (url.includes("queue=potluck")) return "🚀Razzato in RFY";
    if (url.includes("queue=last_chance")) return "🚀Razzato in AFA";
    if (url.includes("queue=encore")) return "🚀Razzato in AI";
    return "Razzato";
  }

  // ---------- UTILITY ----------
  const trimOldEntries = (obj) => {
    const keys = Object.keys(obj);
    if (keys.length > MAX_ITEMS) {
      keys.sort((a, b) => obj[a] - obj[b]);
      for (let i = 0; i < keys.length - MAX_ITEMS; i++) delete obj[keys[i]];
    }
  };

  // ---------- POPUP NUOVI ITEM ----------
  const createPopup = (newCount, blueCount) => {
    let popup = document.getElementById('new-items-popup');
    if (popup) popup.remove();

    const totalCount = newCount + blueCount;
    if (totalCount > 0) {
      popup = document.createElement('div');
      popup.id = 'new-items-popup';
      Object.assign(popup.style, {
        position: 'absolute',
        top: '270px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#38FEA7',
        color: '#000',
        padding: '15px 20px',
        borderRadius: '12px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        fontSize: '20px',
        fontWeight: 'bold',
        zIndex: '9999',
        display: 'flex',
        gap: '10px',
        alignItems: 'center'
      });
      popup.textContent = '';
      if (newCount > 0) popup.textContent += `🟩 ${newCount} `;
      if (blueCount > 0) popup.textContent += `🟦 ${blueCount}`;
      document.body.appendChild(popup);
    }
  };

  // ---------- POPUP CATEGORIE MONITORATE ----------
  const createCategoriesPopup = (increments) => {
    if (Object.values(increments).every(v => v <= 0)) return;
    let popup = document.getElementById('categories-popup');
    if (popup) popup.remove();
    popup = document.createElement('div');
    popup.id = 'categories-popup';
    Object.assign(popup.style, {
      position: 'absolute',
      top: '330px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#ffa8f7',
      color: '#000',
      padding: '10px 15px',
      borderRadius: '10px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      fontSize: '20px',
      fontWeight: 'bold',
      zIndex: '9998',
      display: 'flex',
      gap: '10px',
    });

    let text = '';
    MONITORED_CATEGORIES.forEach(cat => {
      const value = increments[cat.emoji] || 0;
      if (value > 0) text += `${cat.emoji} ${value} `;
    });

    popup.textContent = text.trim();
    document.body.appendChild(popup);
  };

  // ---------- NOTIFICA VISIVA ----------
  function showNotification(text, duration = 5000) {
    let notification = document.getElementById("notification-popup");
    if (!notification) {
      notification = document.createElement("div");
      notification.id = "notification-popup";
      Object.assign(notification.style, {
        display: "none",
        position: "fixed",
        bottom: "20px",
        right: "20px",
        backgroundColor: "#333",
        color: "#fff",
        padding: "15px 20px",
        borderRadius: "8px",
        boxShadow: "0 4px 8px rgba(0, 0, 0, 0.2)",
        maxWidth: "400px",
        zIndex: "10000",
        fontSize: "14px",
        whiteSpace: "pre-wrap",
        fontFamily: "Arial, sans-serif"
      });
      document.body.appendChild(notification);
    }
    notification.textContent = text;
    notification.style.display = "block";
    setTimeout(() => (notification.style.display = "none"), duration);
  }

  // ---------- ADDRESS DROPDOWN ----------
  let selectedAddressId = localStorage.getItem("selectedAddressId");
  let selectedLegacyAddressId = localStorage.getItem("selectedLegacyAddressId");

  function createAddressDropdown() {
    const addressElements = document.body.querySelectorAll(".vvp-address-option");
    if (!addressElements.length) return;
    if (document.getElementById("address-selector")) return;

    const dropdown = document.createElement("select");
    dropdown.style.marginRight = "10px";
    dropdown.id = "address-selector";

    addressElements.forEach((element) => {
      const addressId = element.getAttribute("data-address-id");
      const legacyAddressId = element.getAttribute("data-legacy-address-id");
      const streetAddress = element.querySelector(".a-radio-label > span:nth-of-type(1)")?.textContent.trim();
      if (streetAddress) {
        const option = document.createElement("option");
        option.value = addressId;
        option.textContent = streetAddress;
        option.dataset.legacyAddressId = legacyAddressId;
        dropdown.appendChild(option);
      }
    });

    if (dropdown.options.length > 0) {
      if (selectedAddressId) {
        const has = Array.from(dropdown.options).some(o => o.value === selectedAddressId);
        if (has) dropdown.value = selectedAddressId;
        else {
          selectedAddressId = dropdown.options[0].value;
          selectedLegacyAddressId = dropdown.options[0].dataset.legacyAddressId;
        }
      } else {
        selectedAddressId = dropdown.options[0].value;
        selectedLegacyAddressId = dropdown.options[0].dataset.legacyAddressId;
      }
    }

    dropdown.onchange = function () {
      selectedAddressId = this.value;
      selectedLegacyAddressId = this.options[this.selectedIndex].dataset.legacyAddressId;
      localStorage.setItem("selectedAddressId", selectedAddressId);
      localStorage.setItem("selectedLegacyAddressId", selectedLegacyAddressId);
    };

    document.body.querySelector(".a-section.vvp-container-right-align")?.prepend(dropdown);
  }

  // ---------- ACQUISTO (RAZZO) ----------
  async function cartPurchase(recommendationId, asin, isParent, csrfToken, titleText) {
    if (isParent) {
      const encodedId = encodeURIComponent(recommendationId);
      const urlRec = `https://www.amazon.it/vine/api/recommendations/${encodedId}`;
      try {
        const response = await fetch(urlRec);
        const data = await response.json();
        asin = data.result?.variations?.[0]?.asin || asin;
      } catch (error) {
        showNotification("Errore nel recupero della variazione ASIN");
        return;
      }
    }

    if (!recommendationId || !asin || !selectedAddressId || !selectedLegacyAddressId || !csrfToken) {
      showNotification("Impossibile completare l'acquisto: dati mancanti");
      return;
    }

    const payload = JSON.stringify({
      recommendationId,
      recommendationType: "SEARCH",
      itemAsin: asin,
      addressId: selectedAddressId,
      legacyAddressId: selectedLegacyAddressId
    });

    try {
      const req = await fetch("https://www.amazon.it/vine/api/voiceOrders", {
        method: "POST",
        body: payload,
        headers: {
          "anti-csrftoken-a2z": csrfToken,
          "content-type": "application/json"
        }
      });

      const response = await req.json();

      // Mostra popup locale completo
      showNotification("Acquisto inviato:\n" + (response ? JSON.stringify(response, null, 2) : "no response"));

      // Controlla se la risposta contiene orderId
      const responseText = JSON.stringify(response);
      const orderResult = responseText.includes('"orderId"') ? "✅ Preso!" : "❌ Errore, non ordinato";

      const shortTitle = (titleText || "").split(/\s+/).slice(0, 4).join(" ");
      const msg = `${getPageLabel()} – ${shortTitle} – https://www.amazon.it/dp/${asin} – ${orderResult}`;
      send(msg);

    } catch (error) {
      showNotification("Acquisto fallito");
    }
  }

  // ---------- BOTTONE RAZZO ----------
  function createCartPurchaseButton(tile, csrfToken) {
    if (!enableRocket) return;
    if (tile.querySelector('.cartOverlayButton')) return;

    const isParent = tile.querySelector("input")?.getAttribute("data-is-parent-asin") === "true";
    const asin = tile.querySelector(".vvp-details-btn .a-button-input")?.dataset.asin ||
                 tile.querySelector(".a-button-input")?.dataset.asin ||
                 (tile.getAttribute('data-recommendation-id') || '').split('#')[1] || '';
    const recommendationId = tile.getAttribute("data-recommendation-id");
    const titleText = tile.querySelector('.a-truncate-full')?.textContent.trim() || '';

    const buttonDiv = document.createElement("div");
    buttonDiv.className = "cartOverlayButton";
    Object.assign(buttonDiv.style, {
      position: "absolute",
      top: "10px",
      right: "10px",
      width: "35px",
      height: "35px",
      borderRadius: "50%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      zIndex: "10",
      transition: "all 0.2s ease",
      boxShadow: "0 0 6px rgba(0, 255, 255, 0.5)",
      fontSize: "18px",
      background: isParent ? "#f5a52f" : "#d7f540",
      border: isParent ? "2px solid #f5a52f" : "2px solid #d7f540",
      color: "#000"
    });
    buttonDiv.textContent = "🚀";

    buttonDiv.addEventListener("click", (e) => {
      e.stopPropagation();
      cartPurchase(recommendationId, asin, isParent, csrfToken, titleText);
    });

    const tileContent = tile.querySelector(".vvp-item-tile-content");
    if (tileContent) {
      tileContent.style.position = "relative";
      tileContent.appendChild(buttonDiv);
    }
  }

  // ---------- HIGHLIGHT + TELEGRAM ----------
  const applyNotSeenRecommendationsStyle = (items) => {
    const seenRecommendations = GM_getValue(SEEN_RECOMMENDATIONS_KEY, {});
    let newCount = 0;
    let blueCount = 0;
    const now = Date.now();

    const csrfToken = document.body.querySelector('input[name="csrf-token"]')?.value ||
      (JSON.parse(document.querySelector(".vvp-body > [type='a-state']")?.innerText || "{}").csrfToken);

    items.forEach(item => {
      const recommendationId = item.getAttribute('data-recommendation-id');
      if (!recommendationId) return;

      const storedTimestamp = seenRecommendations[recommendationId];
      const titleElement = item.querySelector('.a-truncate-full');
      const title = titleElement ? titleElement.textContent.trim() : '';
      const shortTitle = title.split(/\s+/).slice(0, 4).join(" ");
      const asinFromRec = (recommendationId.split('#')[1] || '').trim();
      const asin = item.querySelector(".vvp-details-btn .a-button-input")?.dataset.asin ||
                   item.querySelector(".a-button-input")?.dataset.asin ||
                   asinFromRec || '';

      const brandWords = title.split(/\s+/).slice(0, 3).join(' ').toLowerCase();
      const isBrandTarget = targetBrands.some(b => brandWords.startsWith(b.toLowerCase()));
      const isAsinTarget = targetAsins.includes(asin);
      const isTarget = isBrandTarget || isAsinTarget;

      if (!storedTimestamp) {
        seenRecommendations[recommendationId] = now;
        if (isTarget) {
            GM_addStyle(`div.vvp-item-tile[data-recommendation-id="${recommendationId}"] { background-color: #00BFFF !important; }`);
            blueCount++;

            const label = getPageLabel().replace("🚀Razzato in", "🔵Trovato in");
            const msg = `${label} – ${shortTitle} – https://www.amazon.it/dp/${asin}`;
            send(msg);
        } else {
          GM_addStyle(`div.vvp-item-tile[data-recommendation-id="${recommendationId}"] { background-color: #38FEA7 !important; }`);
          newCount++;
        }
      } else {
        if (now - storedTimestamp < RECENT_MS) {
          GM_addStyle(`div.vvp-item-tile[data-recommendation-id="${recommendationId}"] { background-color: #FFF44D !important; }`);
        }
      }

      if (enableRocket) createCartPurchaseButton(item, csrfToken);
    });

    trimOldEntries(seenRecommendations);
    GM_setValue(SEEN_RECOMMENDATIONS_KEY, seenRecommendations);
    createPopup(newCount, blueCount);
  };

  // ---------- CATEGORIE MONITOR INCREMENTALE ----------
  const runCategoriesMonitor = () => {
    if (!url.includes("queue=encore")) return;

    const parentNodes = document.querySelectorAll('.parent-node');
    const increments = {};

    MONITORED_CATEGORIES.forEach(cat => {
      let currentValue = 0;
      parentNodes.forEach(node => {
        const catName = node.querySelector('a.a-link-normal')?.textContent.trim();
        const value = parseInt(node.querySelector('span')?.textContent.replace(/[^\d]/g,'')) || 0;

        if ((cat.name && catName === cat.name) || (cat.nameStart && catName?.startsWith(cat.nameStart))) {
          currentValue += value;
        }
      });

      const prevValue = parseInt(localStorage.getItem(`cat-prev-${cat.emoji}`) || '0');
      const diff = currentValue - prevValue;
      if (diff > 0) increments[cat.emoji] = diff;

      localStorage.setItem(`cat-prev-${cat.emoji}`, currentValue.toString());
    });

    createCategoriesPopup(increments);
  };

  // ---------- INIT ----------
  createAddressDropdown();
  const items = document.querySelectorAll('#vvp-items-grid .vvp-item-tile');
  applyNotSeenRecommendationsStyle(items);
  runCategoriesMonitor();

})();