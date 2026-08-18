// Affiche le catalogue réel (Supabase, table produits, disponible=true —
// lecture publique) avec un bouton "Ajouter" par produit, câblé sur le panier
// (commande.js, exposé via window.LocwebCommande.ajouter).
(function () {
  const config = window.LOCWEB_CONFIG;
  if (!config || !config.supabaseUrl || !config.clientId) return;

  const endpoint =
    `${config.supabaseUrl}/rest/v1/produits` +
    `?client_id=eq.${encodeURIComponent(config.clientId)}&disponible=eq.true` +
    `&select=id,nom,prix,description,image_url,categorie,stock&order=nom`;

  fetch(endpoint, {
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${config.supabaseAnonKey}`
    }
  })
    .then((res) => {
      if (!res.ok) throw new Error(`Supabase ${res.status}`);
      return res.json();
    })
    .then((produits) => {
      const parCategorie = {};
      produits.forEach((p) => {
        (parCategorie[p.categorie] ??= []).push(p);
      });

      document.querySelectorAll('[data-produits-categorie]').forEach((container) => {
        const cle = container.getAttribute('data-produits-categorie');
        const items = parCategorie[cle];
        const bloc = container.closest('.cat-bloc');
        if (!items || items.length === 0) {
          if (bloc) bloc.style.display = 'none'; // masque une catégorie vide (ex: en rupture totale)
          return;
        }

        container.innerHTML = items.map((p) => {
          const stockSuivi = p.stock !== null && p.stock !== undefined;
          const epuise = stockSuivi && Number(p.stock) <= 0;
          return `
          <div class="prod-card${epuise ? ' prod-epuise' : ''}">
            ${p.image_url ? `<img src="${p.image_url}" alt="${escapeHtml(p.nom)}" loading="lazy">` : ''}
            ${epuise ? '<span class="prod-badge-indispo">Indisponible</span>' : ''}
            <div class="prod-body">
              <div class="prod-nom">${escapeHtml(p.nom)}</div>
              ${p.description ? `<div class="prod-desc">${escapeHtml(p.description)}</div>` : ''}
              ${stockSuivi && !epuise ? `<div class="prod-stock">${Number(p.stock)} en stock</div>` : ''}
              <div class="prod-bas">
                <span class="prod-prix">${formatPrix(p.prix)}</span>
                ${epuise
                  ? `<button class="prod-ajouter" disabled>Indisponible</button>`
                  : `<button class="prod-ajouter" data-produit-id="${p.id}" data-produit-nom="${escapeHtml(p.nom)}" data-produit-prix="${p.prix}">Ajouter</button>`}
              </div>
            </div>
          </div>
        `;
        }).join('');

        container.querySelectorAll('.prod-ajouter:not([disabled])').forEach((btn) => {
          btn.addEventListener('click', () => {
            window.LocwebCommande?.ajouter(btn.dataset.produitId, btn.dataset.produitNom, btn.dataset.produitPrix);
          });
        });
      });
    })
    .catch((err) => {
      console.warn('Produits Supabase indisponibles.', err);
    });

  function formatPrix(prix) {
    const s = Number(prix).toFixed(2).replace(/\.?0+$/, '');
    return `${s.replace('.', ',')}€`;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
