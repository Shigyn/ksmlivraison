// Espace conducteur : partage de la position GPS en direct + gestion des
// commandes en cours. Protégé par un code d'accès partagé (pas de compte
// pour le MVP — un seul camion, un seul chauffeur), vérifié côté serveur par
// l'Edge Function conducteur-camion (jamais de clé service_role côté client).
(function () {
  const config = window.LOCWEB_CONFIG;
  const STORAGE_TOKEN = `locweb_camion_token_${config.clientId}`;
  const FONCTION_URL = `${config.supabaseUrl}/functions/v1/conducteur-camion`;

  let token = localStorage.getItem(STORAGE_TOKEN) || '';
  let suiviId = null;
  let dernierEnvoi = 0;

  async function appel(action, params = {}) {
    const res = await fetch(FONCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${config.supabaseAnonKey}`
      },
      body: JSON.stringify({ token, client_id: config.clientId, action, ...params })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    return data;
  }

  function afficherApp() {
    document.getElementById('ecran-token').style.display = 'none';
    document.getElementById('ecran-app').style.display = 'block';
    rafraichirCommandes();
    chargerProduits();
    setInterval(rafraichirCommandes, 10000);
  }

  async function validerToken() {
    const saisi = document.getElementById('token-input').value.trim();
    const erreurEl = document.getElementById('token-erreur');
    if (!saisi) return;
    token = saisi;
    try {
      await appel('lister_commandes');
      localStorage.setItem(STORAGE_TOKEN, token);
      afficherApp();
    } catch (err) {
      erreurEl.textContent = 'Code incorrect.';
      token = '';
    }
  }

  // GPS
  function basculerTournee() {
    if (suiviId) {
      navigator.geolocation.clearWatch(suiviId);
      suiviId = null;
      document.getElementById('btn-tournee').textContent = 'Démarrer la tournée';
      document.getElementById('btn-tournee').classList.remove('actif');
      document.getElementById('gps-dot').classList.remove('on');
      document.getElementById('gps-texte').textContent = 'Position non partagée';
      return;
    }

    if (!navigator.geolocation) {
      document.getElementById('gps-texte').textContent = "GPS non supporté par cet appareil.";
      return;
    }

    suiviId = navigator.geolocation.watchPosition(
      (pos) => {
        document.getElementById('gps-dot').classList.add('on');
        document.getElementById('gps-dot').classList.remove('err');
        document.getElementById('gps-texte').textContent = 'Position partagée en direct';

        // envoi throttled : au plus une fois toutes les 8s, pas à chaque callback GPS
        const maintenant = Date.now();
        if (maintenant - dernierEnvoi < 8000) return;
        dernierEnvoi = maintenant;

        appel('maj_position', { latitude: pos.coords.latitude, longitude: pos.coords.longitude })
          .catch((err) => console.warn('Envoi position échoué', err));
      },
      (err) => {
        document.getElementById('gps-dot').classList.add('err');
        document.getElementById('gps-texte').textContent = "Erreur GPS — vérifiez l'autorisation de localisation.";
        console.warn(err);
      },
      { enableHighAccuracy: true, maximumAge: 5000 }
    );

    document.getElementById('btn-tournee').textContent = 'Arrêter la tournée';
    document.getElementById('btn-tournee').classList.add('actif');
  }

  // Commandes
  const PROCHAIN_STATUT = { recue: 'en_preparation', en_preparation: 'en_livraison', en_livraison: 'livree' };
  const LABEL_ACTION = { recue: 'Préparer', en_preparation: 'Partir en livraison', en_livraison: 'Marquer livrée' };
  const LABEL_STATUT = { recue: 'Reçue', en_preparation: 'En préparation', en_livraison: 'En livraison' };

  async function rafraichirCommandes() {
    try {
      const { commandes } = await appel('lister_commandes');
      const liste = document.getElementById('liste-commandes');

      if (!commandes || commandes.length === 0) {
        liste.innerHTML = '<p id="vide">Aucune commande pour le moment.</p>';
        return;
      }

      liste.innerHTML = commandes.map((c) => `
        <div class="cmd-card">
          <span class="cmd-statut ${c.statut}">${LABEL_STATUT[c.statut] || c.statut}</span>
          <div class="cmd-head"><span class="cmd-nom">${escapeHtml(c.nom_client)}</span><span class="cmd-total">${Number(c.total).toFixed(2)}€</span></div>
          <div class="cmd-adresse">${escapeHtml(c.adresse_livraison)}</div>
          <div class="cmd-tel"><a href="tel:${c.telephone_client}">${c.telephone_client}</a></div>
          <div class="cmd-actions">
            ${PROCHAIN_STATUT[c.statut] ? `<button class="cmd-btn" data-avancer="${c.id}" data-vers="${PROCHAIN_STATUT[c.statut]}">${LABEL_ACTION[c.statut]}</button>` : ''}
            ${c.statut === 'recue' ? `<button class="cmd-btn annuler" data-annuler="${c.id}">Annuler</button>` : ''}
          </div>
        </div>
      `).join('');

      liste.querySelectorAll('[data-avancer]').forEach((btn) => {
        btn.addEventListener('click', () => majStatut(btn.dataset.avancer, btn.dataset.vers));
      });
      liste.querySelectorAll('[data-annuler]').forEach((btn) => {
        btn.addEventListener('click', () => majStatut(btn.dataset.annuler, 'annulee'));
      });
    } catch (err) {
      console.warn('Liste commandes indisponible.', err);
    }
  }

  async function majStatut(commandeId, statut) {
    try {
      await appel('maj_statut_commande', { commande_id: commandeId, statut });
      rafraichirCommandes();
    } catch (err) {
      alert('Erreur : ' + err.message);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Onglets
  function initOnglets() {
    document.querySelectorAll('.onglet-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.onglet-btn').forEach((b) => b.classList.remove('actif'));
        document.querySelectorAll('.onglet-panneau').forEach((p) => p.classList.remove('actif'));
        btn.classList.add('actif');
        document.getElementById(`panneau-${btn.dataset.onglet}`).classList.add('actif');
      });
    });
  }

  // Stock — juste le nom et la quantité, rien d'autre (édition complète du
  // catalogue : prix/photo/description/catégorie restent dans locweb-editeur)
  async function chargerProduits() {
    try {
      const { produits } = await appel('lister_produits');
      const conteneur = document.getElementById('liste-produits');

      if (!produits || produits.length === 0) {
        conteneur.innerHTML = '<p id="produits-vide">Aucun produit.</p>';
        return;
      }

      const parCategorie = {};
      produits.forEach((p) => (parCategorie[p.categorie || 'Sans catégorie'] ??= []).push(p));

      conteneur.innerHTML = Object.entries(parCategorie).map(([cat, items]) => `
        <div class="cat-groupe-titre">${escapeHtml(cat)}</div>
        ${items.map((p) => ligneStock(p)).join('')}
      `).join('');

      cablerLignesStock();
    } catch (err) {
      console.warn('Produits indisponibles.', err);
    }
  }

  function ligneStock(p) {
    return `
      <div class="p-ligne" data-produit="${p.id}">
        <span class="p-nom">${escapeHtml(p.nom ?? '')}</span>
        <div class="p-stock-zone">
          <button class="p-stock-btn" data-moins="${p.id}">−</button>
          <input type="number" class="p-stock-input" value="${p.stock ?? 0}" data-id="${p.id}">
          <button class="p-stock-btn" data-plus="${p.id}">+</button>
        </div>
      </div>
    `;
  }

  function cablerLignesStock() {
    document.querySelectorAll('#liste-produits .p-stock-input').forEach((input) => {
      input.addEventListener('change', () => sauverStock(input.dataset.id, Number(input.value) || 0));
    });
    document.querySelectorAll('#liste-produits [data-moins]').forEach((btn) => {
      btn.addEventListener('click', () => ajusterStock(btn.dataset.moins, -1));
    });
    document.querySelectorAll('#liste-produits [data-plus]').forEach((btn) => {
      btn.addEventListener('click', () => ajusterStock(btn.dataset.plus, 1));
    });
  }

  function ajusterStock(id, delta) {
    const input = document.querySelector(`.p-stock-input[data-id="${id}"]`);
    const valeur = Math.max(0, (Number(input.value) || 0) + delta);
    input.value = valeur;
    sauverStock(id, valeur);
  }

  async function sauverStock(id, valeur) {
    try {
      await appel('maj_produit', { produit_id: id, champs: { stock: valeur } });
    } catch (err) {
      alert('Erreur enregistrement : ' + err.message);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('token-valider').addEventListener('click', validerToken);
    document.getElementById('token-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') validerToken(); });
    document.getElementById('btn-tournee').addEventListener('click', basculerTournee);
    initOnglets();

    if (token) {
      appel('lister_commandes').then(afficherApp).catch(() => { localStorage.removeItem(STORAGE_TOKEN); token = ''; });
    }
  });
})();
