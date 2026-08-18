// Remplace le contenu par défaut des zones balisées par le contenu stocké dans
// Supabase (table contenu_site), sans jamais toucher au HTML/JS déployé.
(function () {
  const config = window.LOCWEB_CONFIG;
  if (!config || !config.supabaseUrl || !config.clientId) {
    console.warn('LOCWEB_CONFIG manquant — contenu par défaut conservé.');
    return;
  }

  const endpoint =
    `${config.supabaseUrl}/rest/v1/contenu_site` +
    `?client_id=eq.${encodeURIComponent(config.clientId)}&select=cle_bloc,valeur`;

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
    .then((rows) => {
      const valeurs = Object.fromEntries(rows.map((r) => [r.cle_bloc, r.valeur]));
      document.querySelectorAll('[data-editable-zone]').forEach((el) => {
        const cle = el.getAttribute('data-editable-zone');
        if (valeurs[cle] !== undefined && valeurs[cle] !== null && valeurs[cle] !== '') {
          if (el.tagName === 'IMG') {
            el.src = valeurs[cle];
          } else {
            el.textContent = valeurs[cle];
          }
        }
      });
    })
    .catch((err) => {
      console.warn('Contenu Supabase indisponible, fallback statique conservé.', err);
    });
})();
