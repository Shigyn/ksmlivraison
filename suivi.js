// Carte en direct : position du camion (polling toutes les 8s, lecture
// publique RLS sur camion_position) + si une commande est en cours (stockée
// en localStorage après validation dans commande.js), destination + ETA
// calculé via OSRM (serveur de démo public — volume d'un seul camion,
// suffisant pour un MVP ; à remplacer par une instance dédiée si le trafic
// grossit un jour).
(function () {
  const config = window.LOCWEB_CONFIG;
  if (!config || !config.supabaseUrl || !config.clientId || !window.L) return;

  const STORAGE_COMMANDE = `locweb_camion_commande_${config.clientId}`;
  const POSITION_ENDPOINT =
    `${config.supabaseUrl}/rest/v1/camion_position?client_id=eq.${encodeURIComponent(config.clientId)}&select=latitude,longitude,maj_a`;
  const STATUT_ENDPOINT = `${config.supabaseUrl}/functions/v1/commande-statut`;
  const LABEL_STATUT_COMMANDE = {
    recue: 'Commande reçue, en attente de préparation.',
    en_preparation: 'Votre commande est en préparation.',
    en_livraison: 'Le camion est en route vers vous !',
    livree: 'Commande livrée — bon appétit !',
    annulee: 'Commande annulée.'
  };

  let map, marqueurCamion, marqueurDestination, ligneTrajet;
  let dernierePosition = null;

  function initCarte() {
    map = L.map('carte-suivi', { zoomControl: true, attributionControl: true }).setView([46.1667, 4.6667], 12); // Fleurie, Beaujolais
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    const iconeCamion = L.divIcon({
      html: '🚚', className: 'icone-camion', iconSize: [32, 32], iconAnchor: [16, 16]
    });
    marqueurCamion = L.marker([46.1667, 4.6667], { icon: iconeCamion, opacity: 0 }).addTo(map);
  }

  async function majPositionCamion() {
    try {
      const res = await fetch(POSITION_ENDPOINT, {
        headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}` }
      });
      if (!res.ok) throw new Error(`Supabase ${res.status}`);
      const rows = await res.json();
      const pos = rows[0];

      const dot = document.getElementById('nav-dot');
      const navStatut = document.getElementById('nav-statut');
      const suiviTexte = document.getElementById('suivi-statut-texte');

      if (!pos) {
        dot?.classList.remove('on');
        if (navStatut) navStatut.textContent = 'Camion pas encore en tournée';
        if (suiviTexte) suiviTexte.textContent = 'Le camion n\'est pas encore en tournée.';
        return;
      }

      // Position jugée obsolète si pas de mise à jour depuis > 3 min (chauffeur arrêté / app fermée)
      const recente = (Date.now() - new Date(pos.maj_a).getTime()) < 3 * 60 * 1000;

      dot?.classList.toggle('on', recente);
      if (navStatut) navStatut.textContent = recente ? 'Camion en tournée' : 'Dernière position il y a un moment';
      if (suiviTexte) suiviTexte.textContent = recente ? 'Position en direct du camion.' : 'Le camion semble à l\'arrêt (position non actualisée récemment).';

      dernierePosition = { latitude: pos.latitude, longitude: pos.longitude };
      marqueurCamion.setLatLng([pos.latitude, pos.longitude]);
      marqueurCamion.setOpacity(1);

      recadrer();
      await majEta();
    } catch (err) {
      console.warn('Position camion indisponible.', err);
    }
  }

  function commandeEnCours() {
    try { return JSON.parse(localStorage.getItem(STORAGE_COMMANDE)); } catch { return null; }
  }

  async function majStatutCommande() {
    const commande = commandeEnCours();
    const suiviTexte = document.getElementById('suivi-statut-texte');
    if (!commande) return;

    try {
      const res = await fetch(STATUT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${config.supabaseAnonKey}`
        },
        body: JSON.stringify({ commande_id: commande.commande_id })
      });
      if (!res.ok) throw new Error(`commande-statut ${res.status}`);
      const data = await res.json();

      if (suiviTexte && LABEL_STATUT_COMMANDE[data.statut]) {
        suiviTexte.textContent = LABEL_STATUT_COMMANDE[data.statut];
      }

      if (data.statut === 'livree' || data.statut === 'annulee') {
        localStorage.removeItem(STORAGE_COMMANDE);
        if (marqueurDestination) { map.removeLayer(marqueurDestination); marqueurDestination = null; }
        if (ligneTrajet) { map.removeLayer(ligneTrajet); ligneTrajet = null; }
        const etaEl = document.getElementById('suivi-eta');
        if (etaEl) etaEl.textContent = '';
      }
    } catch (err) {
      console.warn('Statut commande indisponible.', err);
    }
  }

  async function majEta() {
    const commande = commandeEnCours();
    const etaEl = document.getElementById('suivi-eta');
    if (!commande || !dernierePosition) { if (etaEl) etaEl.textContent = ''; return; }

    if (!marqueurDestination) {
      const iconeMaison = L.divIcon({ html: '📍', className: 'icone-destination', iconSize: [28, 28], iconAnchor: [14, 28] });
      marqueurDestination = L.marker([commande.latitude, commande.longitude], { icon: iconeMaison }).addTo(map);
    }

    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${dernierePosition.longitude},${dernierePosition.latitude};${commande.longitude},${commande.latitude}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('OSRM indisponible');
      const data = await res.json();
      const route = data.routes?.[0];
      if (!route) { if (etaEl) etaEl.textContent = ''; return; }

      const minutes = Math.round(route.duration / 60);
      if (etaEl) etaEl.textContent = minutes <= 1 ? 'Arrivée imminente' : `Arrivée estimée dans ${minutes} min`;

      const coords = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
      if (ligneTrajet) map.removeLayer(ligneTrajet);
      ligneTrajet = L.polyline(coords, { color: '#F5C518', weight: 4, opacity: 0.85 }).addTo(map);
    } catch (err) {
      console.warn('ETA indisponible.', err);
      if (etaEl) etaEl.textContent = '';
    }

    recadrer();
  }

  function recadrer() {
    const points = [marqueurCamion.getLatLng()];
    if (marqueurDestination) points.push(marqueurDestination.getLatLng());
    if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
    else map.setView(points[0], 14);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initCarte();
    majPositionCamion();
    majStatutCommande();
    setInterval(majPositionCamion, 8000);
    setInterval(majStatutCommande, 10000);
  });
  document.addEventListener('locweb-commande-creee', () => {
    majPositionCamion();
    majStatutCommande();
  });
})();
