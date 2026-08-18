// Panier + commande livrée (sans Stripe, paiement à la livraison). Géocode
// l'adresse via l'API Adresse du gouvernement (gratuite, sans clé), puis
// envoie la commande à l'Edge Function create-commande-livraison.
(function () {
  const config = window.LOCWEB_CONFIG;
  if (!config || !config.supabaseUrl || !config.clientId) return;

  const STORAGE_PANIER = `locweb_camion_panier_${config.clientId}`;
  const STORAGE_COMMANDE = `locweb_camion_commande_${config.clientId}`;

  function lirePanier() {
    try { return JSON.parse(localStorage.getItem(STORAGE_PANIER)) || []; } catch { return []; }
  }
  function ecrirePanier(items) {
    localStorage.setItem(STORAGE_PANIER, JSON.stringify(items));
    render();
  }

  function ajouter(produitId, nom, prix) {
    const items = lirePanier();
    const existant = items.find((i) => i.produit_id === produitId);
    if (existant) existant.quantite += 1;
    else items.push({ produit_id: produitId, nom, prix: Number(prix), quantite: 1 });
    ecrirePanier(items);
    ouvrirDrawer();
  }
  function retirer(produitId) {
    ecrirePanier(lirePanier().filter((i) => i.produit_id !== produitId));
  }
  function changerQuantite(produitId, delta) {
    const items = lirePanier();
    const item = items.find((i) => i.produit_id === produitId);
    if (!item) return;
    item.quantite = Math.max(1, item.quantite + delta);
    ecrirePanier(items);
  }
  function total() {
    return lirePanier().reduce((sum, i) => sum + i.prix * i.quantite, 0);
  }

  function construireUI() {
    const bouton = document.createElement('button');
    bouton.id = 'panier-bouton';
    bouton.innerHTML = '🛒 <span id="panier-count">0</span>';
    bouton.addEventListener('click', ouvrirDrawer);

    const overlay = document.createElement('div');
    overlay.id = 'panier-overlay';
    overlay.addEventListener('click', fermerDrawer);

    const drawer = document.createElement('div');
    drawer.id = 'panier-drawer';
    drawer.innerHTML = `
      <div class="pd-head">
        <strong>Votre commande</strong>
        <button class="pd-fermer" id="pd-fermer">×</button>
      </div>
      <div id="panier-items"></div>
      <div class="pd-foot" id="pd-foot">
        <div class="pd-total"><span>Total</span><span id="panier-total">0,00€</span></div>
        <input type="text" id="cmd-nom" placeholder="Nom">
        <input type="tel" id="cmd-tel" placeholder="Téléphone">
        <input type="text" id="cmd-adresse" placeholder="Adresse de livraison complète (n°, rue, code postal, ville)">
        <button class="pd-valider" id="pd-valider">Commander — paiement à la livraison</button>
        <p id="panier-erreur"></p>
      </div>
      <div id="panier-confirmation" style="display:none;"></div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(bouton);
    document.body.appendChild(drawer);

    document.getElementById('pd-fermer').addEventListener('click', fermerDrawer);
    document.getElementById('pd-valider').addEventListener('click', valider);
  }

  function ouvrirDrawer() {
    document.getElementById('panier-drawer').classList.add('ouvert');
    document.getElementById('panier-overlay').classList.add('ouvert');
  }
  function fermerDrawer() {
    document.getElementById('panier-drawer').classList.remove('ouvert');
    document.getElementById('panier-overlay').classList.remove('ouvert');
  }

  function render() {
    const items = lirePanier();
    const countEl = document.getElementById('panier-count');
    if (countEl) countEl.textContent = items.reduce((s, i) => s + i.quantite, 0);

    const itemsEl = document.getElementById('panier-items');
    if (!itemsEl) return;

    if (items.length === 0) {
      itemsEl.innerHTML = '<p style="color:var(--t3);font-size:.85rem;padding:1rem 0;">Panier vide — ajoutez des produits depuis le menu.</p>';
    } else {
      itemsEl.innerHTML = items.map((i) => `
        <div class="pi-ligne">
          <div>
            <div class="pi-nom">${i.nom}</div>
            <div class="pi-sous">${i.prix.toFixed(2)}€ × ${i.quantite}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <button class="pi-btn" data-moins="${i.produit_id}">−</button>
            <button class="pi-btn" data-plus="${i.produit_id}">+</button>
            <button class="pi-x" data-retirer="${i.produit_id}">✕</button>
          </div>
        </div>
      `).join('');

      itemsEl.querySelectorAll('[data-moins]').forEach((b) => b.addEventListener('click', () => changerQuantite(b.dataset.moins, -1)));
      itemsEl.querySelectorAll('[data-plus]').forEach((b) => b.addEventListener('click', () => changerQuantite(b.dataset.plus, 1)));
      itemsEl.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => retirer(b.dataset.retirer)));
    }

    const totalEl = document.getElementById('panier-total');
    if (totalEl) totalEl.textContent = `${total().toFixed(2)}€`;
  }

  async function geocoder(adresse) {
    const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(adresse)}&limit=1`);
    if (!res.ok) throw new Error('geocodage indisponible');
    const data = await res.json();
    const feature = data.features?.[0];
    if (!feature) return null;
    const [longitude, latitude] = feature.geometry.coordinates;
    return { latitude, longitude, label: feature.properties.label };
  }

  async function valider() {
    const items = lirePanier();
    const erreurEl = document.getElementById('panier-erreur');
    erreurEl.textContent = '';

    if (items.length === 0) { erreurEl.textContent = 'Votre panier est vide.'; return; }

    const nom = document.getElementById('cmd-nom').value.trim();
    const telephone = document.getElementById('cmd-tel').value.trim();
    const adresse = document.getElementById('cmd-adresse').value.trim();

    if (!nom || !telephone || !adresse) {
      erreurEl.textContent = 'Nom, téléphone et adresse sont requis.';
      return;
    }

    const boutonValider = document.getElementById('pd-valider');
    boutonValider.disabled = true;
    boutonValider.textContent = 'Localisation de l\'adresse…';

    try {
      const position = await geocoder(adresse);
      if (!position) {
        erreurEl.textContent = "Adresse introuvable — vérifiez le numéro, la rue et le code postal.";
        boutonValider.disabled = false;
        boutonValider.textContent = 'Commander — paiement à la livraison';
        return;
      }

      boutonValider.textContent = 'Envoi de la commande…';

      const res = await fetch(`${config.supabaseUrl}/functions/v1/create-commande-livraison`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${config.supabaseAnonKey}`
        },
        body: JSON.stringify({
          client_id: config.clientId,
          panier: items.map((i) => ({ produit_id: i.produit_id, quantite: i.quantite })),
          nom_client: nom,
          telephone_client: telephone,
          adresse_livraison: position.label,
          latitude: position.latitude,
          longitude: position.longitude
        })
      });

      const data = await res.json();
      if (!res.ok || !data.commande_id) {
        erreurEl.textContent = data.error || 'Erreur lors de la création de la commande.';
        boutonValider.disabled = false;
        boutonValider.textContent = 'Commander — paiement à la livraison';
        return;
      }

      localStorage.setItem(STORAGE_COMMANDE, JSON.stringify({
        commande_id: data.commande_id,
        latitude: position.latitude,
        longitude: position.longitude
      }));
      localStorage.removeItem(STORAGE_PANIER);

      document.getElementById('pd-foot').style.display = 'none';
      const conf = document.getElementById('panier-confirmation');
      conf.style.display = 'block';
      conf.innerHTML = `
        <div class="ok">✓</div>
        <p style="font-weight:700;margin-bottom:6px;">Commande envoyée !</p>
        <p style="color:var(--t2);font-size:.88rem;">Le camion prépare votre commande. Suivez-le en direct plus bas sur la page.</p>
      `;
      render();
      document.dispatchEvent(new CustomEvent('locweb-commande-creee'));
      setTimeout(() => {
        fermerDrawer();
        document.getElementById('suivi')?.scrollIntoView({ behavior: 'smooth' });
      }, 1400);
    } catch (err) {
      erreurEl.textContent = 'Erreur réseau, réessayez.';
      boutonValider.disabled = false;
      boutonValider.textContent = 'Commander — paiement à la livraison';
      console.error(err);
    }
  }

  window.LocwebCommande = { ajouter, retirer };

  document.addEventListener('DOMContentLoaded', () => {
    construireUI();
    render();
  });
})();
