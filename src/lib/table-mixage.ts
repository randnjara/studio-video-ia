// Table de mixage du studio voix, calculée par le navigateur (gratuit) :
// - hauteur et vitesse séparées : étirement WSOLA puis rééchantillonnage, recalculés quand le bouton est relâché ;
// - le reste passe par Web Audio (égaliseur, chevrotement, effets, écho, réverbération, compresseur, volume),
//   réglable en direct pendant l'écoute ; l'export rejoue exactement la même chaîne hors ligne.

import type { Reglages } from "@/lib/voix";

// ---------------------------------------------------------------------------
// Hauteur et vitesse
// ---------------------------------------------------------------------------

// Étire le son sans changer sa hauteur (WSOLA : morceaux de 40 ms recollés là où ils se ressemblent le plus)
function etirer(x: Float32Array, facteur: number, frequence: number): Float32Array {
  if (Math.abs(facteur - 1) < 1e-3 || x.length === 0) return x.slice();
  const n = 2 * Math.round(frequence * 0.02); // 40 ms
  const pasSortie = n / 2;
  const pasEntree = pasSortie / facteur;
  const marge = Math.round(frequence * 0.008);
  const fenetre = new Float32Array(n);
  for (let i = 0; i < n; i++) fenetre[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  const longueur = Math.round(x.length * facteur);
  const y = new Float32Array(longueur + n);
  const poids = new Float32Array(longueur + n);
  let precedent = 0;
  for (let k = 0; ; k++) {
    const sortie = k * pasSortie;
    if (sortie >= longueur) break;
    const nominal = Math.round(k * pasEntree);
    let debut = Math.min(nominal, x.length - n);
    if (debut < 0) break;
    if (k > 0) {
      // Cherche autour de la position prévue le morceau qui prolonge le mieux le précédent
      const suite = precedent + pasSortie;
      let meilleur = -Infinity;
      for (let d = -marge; d <= marge; d += 2) {
        const p = nominal + d;
        if (p < 0 || p + n > x.length || suite + n > x.length) continue;
        let c = 0;
        for (let i = 0; i < n; i += 4) c += x[suite + i] * x[p + i];
        if (c > meilleur) (meilleur = c), (debut = p);
      }
    }
    for (let i = 0; i < n; i++) {
      y[sortie + i] += x[debut + i] * fenetre[i];
      poids[sortie + i] += fenetre[i];
    }
    precedent = debut;
  }
  const z = new Float32Array(longueur);
  for (let i = 0; i < longueur; i++) z[i] = poids[i] > 1e-3 ? y[i] / poids[i] : 0;
  return z;
}

// Lit le son plus vite ou plus lentement (change hauteur et durée ensemble)
function reechantillonner(x: Float32Array, rapport: number): Float32Array {
  if (Math.abs(rapport - 1) < 1e-3) return x;
  const longueur = Math.max(1, Math.floor((x.length - 1) / rapport));
  const y = new Float32Array(longueur);
  for (let i = 0; i < longueur; i++) {
    const p = i * rapport;
    const a = Math.floor(p);
    const f = p - a;
    y[i] = x[a] * (1 - f) + (x[a + 1] ?? x[a]) * f;
  }
  return y;
}

// Nouvelle hauteur (demi-tons) et nouvelle vitesse, indépendantes l'une de l'autre
export function hauteurEtVitesse(ctx: BaseAudioContext, son: AudioBuffer, demiTons: number, vitesse: number): AudioBuffer {
  if (Math.abs(demiTons) < 0.01 && Math.abs(vitesse - 1) < 0.001) return son;
  const rapport = 2 ** (demiTons / 12);
  const canaux: Float32Array[] = [];
  for (let c = 0; c < son.numberOfChannels; c++)
    canaux.push(reechantillonner(etirer(son.getChannelData(c), rapport / vitesse, son.sampleRate), rapport));
  const sortie = ctx.createBuffer(son.numberOfChannels, canaux[0].length, son.sampleRate);
  canaux.forEach((c, i) => sortie.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return sortie;
}

// ---------------------------------------------------------------------------
// Chaîne d'effets
// ---------------------------------------------------------------------------

function distorsion(ctx: BaseAudioContext, force: number) {
  const courbe = new Float32Array(1024);
  for (let i = 0; i < courbe.length; i++) {
    const x = (i * 2) / courbe.length - 1;
    courbe[i] = ((1 + force) * x) / (1 + force * Math.abs(x));
  }
  const n = ctx.createWaveShaper();
  n.curve = courbe;
  n.oversample = "2x";
  return n;
}

function filtre(ctx: BaseAudioContext, type: BiquadFilterType, frequence: number, q = 0.7, gain = 0) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequence;
  f.Q.value = q;
  f.gain.value = gain;
  return f;
}

// Réverbération : bruit qui s'éteint doucement (salle) ou longuement (grotte)
function reponseSalle(ctx: BaseAudioContext, duree: number) {
  const longueur = Math.round(ctx.sampleRate * duree);
  const ir = ctx.createBuffer(2, longueur, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    // Valeurs fixes (pas de hasard) : l'écoute et l'export donnent exactement le même son
    let graine = 12345 + c * 777;
    for (let i = 0; i < longueur; i++) {
      graine = (graine * 1103515245 + 12345) & 0x7fffffff;
      d[i] = ((graine / 0x7fffffff) * 2 - 1) * (1 - i / longueur) ** 3;
    }
  }
  return ir;
}

// Partie de la chaîne qui dépend de l'effet choisi : entrée → sortie
function brancherEffet(ctx: BaseAudioContext, effet: Reglages["effet"], depart: number): [AudioNode, AudioNode] {
  const chainer = (...noeuds: AudioNode[]) => {
    for (let i = 0; i < noeuds.length - 1; i++) noeuds[i].connect(noeuds[i + 1]);
    return [noeuds[0], noeuds[noeuds.length - 1]] as [AudioNode, AudioNode];
  };
  switch (effet) {
    case "radio":
      return chainer(filtre(ctx, "highpass", 450), filtre(ctx, "lowpass", 3800), distorsion(ctx, 4));
    case "telephone":
      return chainer(filtre(ctx, "highpass", 320, 1.2), filtre(ctx, "lowpass", 3200, 1.2), distorsion(ctx, 2));
    case "megaphone":
      return chainer(filtre(ctx, "bandpass", 1600, 0.8), distorsion(ctx, 25), filtre(ctx, "lowpass", 4500));
    case "robot": {
      // Modulation en anneau : la voix multipliée par une onde à 55 Hz
      const entree = ctx.createGain();
      const anneau = ctx.createGain();
      anneau.gain.value = 0;
      const onde = ctx.createOscillator();
      onde.frequency.value = 55;
      onde.connect(anneau.gain);
      onde.start(depart);
      const sortie = ctx.createGain();
      const sec = ctx.createGain();
      sec.gain.value = 0.25;
      entree.connect(anneau).connect(sortie);
      entree.connect(sec).connect(sortie);
      return [entree, sortie];
    }
    default: {
      const passe = ctx.createGain();
      return [passe, passe];
    }
  }
}

export type Chaine = {
  source: AudioBufferSourceNode;
  // Met à jour les réglages qui changent en direct (pas l'effet ni le compresseur, qui reconstruisent la chaîne)
  regler: (r: Reglages) => void;
  arreter: () => void;
};

// Branche son → table de mixage → destination, et démarre la lecture à « position » (s) au temps « quand »
export function brancher(ctx: BaseAudioContext, son: AudioBuffer, r: Reglages, destination: AudioNode, position = 0, quand = 0): Chaine {
  const source = ctx.createBufferSource();
  source.buffer = son;

  // Chevrotement : petite variation de hauteur (retard modulé) et de volume, à 5,5 Hz
  const retard = ctx.createDelay(0.05);
  retard.delayTime.value = 0.006;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.5;
  const profondeurHauteur = ctx.createGain();
  const tremolo = ctx.createGain();
  const profondeurVolume = ctx.createGain();
  lfo.connect(profondeurHauteur).connect(retard.delayTime);
  lfo.connect(profondeurVolume).connect(tremolo.gain);

  const grave = filtre(ctx, "lowshelf", 220);
  const medium = filtre(ctx, "peaking", 1500, 0.8);
  const aigu = filtre(ctx, "highshelf", 4500);
  const [entreeEffet, sortieEffet] = brancherEffet(ctx, r.effet, quand);

  source.connect(retard).connect(tremolo).connect(grave).connect(medium).connect(aigu).connect(entreeEffet);

  const melange = ctx.createGain();
  sortieEffet.connect(melange);
  // Écho : retard de 0,32 s qui se répète en s'affaiblissant
  const echo = ctx.createDelay(1);
  echo.delayTime.value = 0.32;
  const retour = ctx.createGain();
  retour.gain.value = 0.38;
  const echoNiveau = ctx.createGain();
  sortieEffet.connect(echo);
  echo.connect(retour).connect(echo);
  echo.connect(echoNiveau).connect(melange);
  // Réverbération (plus longue pour la grotte)
  const salle = ctx.createConvolver();
  salle.buffer = reponseSalle(ctx, r.effet === "grotte" ? 4.5 : 2.2);
  const salleNiveau = ctx.createGain();
  sortieEffet.connect(salle).connect(salleNiveau).connect(melange);

  const volume = ctx.createGain();
  if (r.compresseur) {
    const compresseur = ctx.createDynamicsCompressor();
    compresseur.threshold.value = -22;
    compresseur.ratio.value = 3;
    compresseur.attack.value = 0.005;
    compresseur.release.value = 0.2;
    melange.connect(compresseur).connect(volume);
  } else melange.connect(volume);
  volume.connect(destination);

  const regler = (n: Reglages) => {
    profondeurHauteur.gain.value = n.chevrotement * 0.0018;
    profondeurVolume.gain.value = n.chevrotement * 0.22;
    tremolo.gain.value = 1 - n.chevrotement * 0.22;
    grave.gain.value = n.grave;
    medium.gain.value = n.medium;
    aigu.gain.value = n.aigu;
    echoNiveau.gain.value = n.echo * 0.55;
    salleNiveau.gain.value = (n.effet === "grotte" ? Math.max(n.reverb, 0.6) : n.reverb) * 0.8;
    volume.gain.value = n.volume;
  };
  regler(r);
  lfo.start(quand);
  source.start(quand, Math.min(position, son.duration));

  return {
    source,
    regler,
    arreter: () => {
      try {
        source.stop();
        lfo.stop();
      } catch {
        // déjà arrêté
      }
      volume.disconnect();
    },
  };
}

// Calcule le son final (avec la traîne de l'écho et de la réverbération), comme à l'écoute
export async function rendre(son: AudioBuffer, r: Reglages): Promise<AudioBuffer> {
  const brouillon = new OfflineAudioContext(1, 1, son.sampleRate);
  const modifie = hauteurEtVitesse(brouillon, son, r.hauteur, r.vitesse);
  const traine = r.echo > 0 || r.reverb > 0 || r.effet === "grotte" ? 3 : 0.1;
  const ctx = new OfflineAudioContext(2, Math.ceil((modifie.duration + traine) * son.sampleRate), son.sampleRate);
  brancher(ctx, modifie, r, ctx.destination);
  return ctx.startRendering();
}

// WAV 16 bits, lisible partout (et par le montage)
export function enWav(son: AudioBuffer): Blob {
  const canaux = son.numberOfChannels;
  const n = son.length;
  const donnees = new DataView(new ArrayBuffer(44 + n * canaux * 2));
  const ecrire = (p: number, t: string) => [...t].forEach((c, i) => donnees.setUint8(p + i, c.charCodeAt(0)));
  ecrire(0, "RIFF");
  donnees.setUint32(4, 36 + n * canaux * 2, true);
  ecrire(8, "WAVE");
  ecrire(12, "fmt ");
  donnees.setUint32(16, 16, true);
  donnees.setUint16(20, 1, true);
  donnees.setUint16(22, canaux, true);
  donnees.setUint32(24, son.sampleRate, true);
  donnees.setUint32(28, son.sampleRate * canaux * 2, true);
  donnees.setUint16(32, canaux * 2, true);
  donnees.setUint16(34, 16, true);
  ecrire(36, "data");
  donnees.setUint32(40, n * canaux * 2, true);
  const lus = Array.from({ length: canaux }, (_, c) => son.getChannelData(c));
  let p = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < canaux; c++) {
      const v = Math.max(-1, Math.min(1, lus[c][i]));
      donnees.setInt16(p, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      p += 2;
    }
  return new Blob([donnees.buffer], { type: "audio/wav" });
}
