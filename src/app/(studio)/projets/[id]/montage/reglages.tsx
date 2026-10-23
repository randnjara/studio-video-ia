"use client";

import { DUREE_MIN, type Element, type Fondu, type Piste, type Place, type Timeline, type Zoom } from "@/lib/montage";
import { deplacerDansPiste, majElement } from "./edition";

// Réglages de l'élément choisi : durée, coupe, transitions, zoom lent, volume
export function Reglages({
  timeline,
  piste,
  element,
  place,
  modifiable,
  aSon,
  modifier,
  onCouper,
  onDupliquer,
  onSupprimer,
}: {
  timeline: Timeline;
  piste?: Piste;
  element?: Element;
  place?: Place;
  modifiable: boolean;
  aSon: boolean;
  modifier: (fn: (t: Timeline) => Timeline, historique?: boolean) => void;
  onCouper: () => void;
  onDupliquer: () => void;
  onSupprimer: () => void;
}) {
  if (!piste || !element || !place) {
    return (
      <p className="text-sm text-sourdine">
        Cliquez sur un bloc dans les pistes pour régler sa durée, ses transitions, son zoom ou son volume.
      </p>
    );
  }
  const principale = piste === timeline.pistes[0];
  const index = piste.elements.findIndex((e) => e.id === element.id);
  const dernier = index === piste.elements.length - 1;
  const visuel = element.nature !== "audio";
  const maj = (patch: Partial<Element>, historique = true) => modifier((t) => majElement(t, piste.id, element.id, patch), historique);
  const maxLongueur = element.nature === "image" ? 600 : Math.max(DUREE_MIN, (element.duree ?? 600) - element.coupeDebut);
  const nombre = (v: string, min: number, max: number) => Math.max(min, Math.min(max, Number(v.replace(",", ".")) || 0));

  return (
    <fieldset disabled={!modifiable} className="flex flex-col gap-3 text-sm">
      <div>
        <p className="font-bold">{element.nom}</p>
        <p className="text-xs text-sourdine">
          {element.nature === "video" ? "Vidéo" : element.nature === "image" ? "Image fixe" : "Son"} · piste « {piste.nom} » · de{" "}
          {place.debut.toFixed(1)} s à {place.fin.toFixed(1)} s
        </p>
      </div>

      {/* Durée et coupe */}
      <div className="grid grid-cols-2 gap-2">
        {element.nature !== "image" && (
          <label className="flex flex-col gap-1">
            <span className="etiquette mb-0 text-xs">Début coupé (s)</span>
            <input
              type="number"
              step={0.1}
              min={0}
              value={Number(element.coupeDebut.toFixed(2))}
              onChange={(e) => {
                const coupe = nombre(e.target.value, 0, Math.max(0, (element.duree ?? 600) - DUREE_MIN));
                maj({ coupeDebut: coupe, longueur: Math.min(element.longueur, (element.duree ?? 600) - coupe) });
              }}
              className="champ py-1 text-sm"
            />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="etiquette mb-0 text-xs">{element.nature === "image" ? "Durée de l'image (s)" : "Durée gardée (s)"}</span>
          <input
            type="number"
            step={0.1}
            min={DUREE_MIN}
            value={Number(element.longueur.toFixed(2))}
            onChange={(e) => maj({ longueur: nombre(e.target.value, DUREE_MIN, maxLongueur) })}
            className="champ py-1 text-sm"
          />
        </label>
        {!principale && (
          <label className="flex flex-col gap-1">
            <span className="etiquette mb-0 text-xs">Commence à (s)</span>
            <input
              type="number"
              step={0.1}
              min={0}
              value={Number(element.debut.toFixed(2))}
              onChange={(e) => maj({ debut: nombre(e.target.value, 0, 3600) })}
              className="champ py-1 text-sm"
            />
          </label>
        )}
      </div>
      {element.nature === "image" && (
        <div className="flex gap-1">
          {[2, 3, 5, 8].map((s) => (
            <button key={s} type="button" className="bouton-discret px-2 py-0.5 text-xs" onClick={() => maj({ longueur: s })}>
              {s} s
            </button>
          ))}
        </div>
      )}
      {element.nature !== "image" && element.duree && (
        <p className="text-xs text-sourdine">Fichier complet : {element.duree.toFixed(1)} s. Tirez aussi les bords du bloc pour raccourcir.</p>
      )}

      {/* Transitions et effets */}
      {visuel ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="etiquette mb-0 text-xs">{principale ? "Transition d'entrée" : "Apparition"}</span>
            <select value={element.entree} onChange={(e) => maj({ entree: e.target.value as Fondu })} className="champ py-1 text-sm">
              <option value="coupe">Coupe nette</option>
              <option value="fondu">{principale && index > 0 ? "Fondu enchaîné (avec le plan d'avant)" : "Fondu"}</option>
              {principale && <option value="noir">Fondu au noir</option>}
            </select>
          </label>
          {(!principale || dernier) && (
            <label className="flex flex-col gap-1">
              <span className="etiquette mb-0 text-xs">{principale ? "Fin du film" : "Disparition"}</span>
              <select value={element.sortie} onChange={(e) => maj({ sortie: e.target.value as Fondu })} className="champ py-1 text-sm">
                <option value="coupe">Coupe nette</option>
                <option value={principale ? "noir" : "fondu"}>{principale ? "Fondu au noir" : "Fondu"}</option>
              </select>
            </label>
          )}
          {(element.entree !== "coupe" || element.sortie !== "coupe") && (
            <label className="flex flex-col gap-1">
              <span className="etiquette mb-0 text-xs">Durée du fondu : {element.transition.toFixed(1)} s</span>
              <input
                type="range"
                min={0.2}
                max={2}
                step={0.1}
                value={element.transition}
                onChange={(e) => maj({ transition: Number(e.target.value) }, false)}
                className="accent-[var(--accent)]"
              />
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="etiquette mb-0 text-xs">Zoom lent</span>
            <select value={element.zoom} onChange={(e) => maj({ zoom: e.target.value as Zoom })} className="champ py-1 text-sm">
              <option value="aucun">Aucun</option>
              <option value="avant">Zoom avant (on s'approche)</option>
              <option value="arriere">Zoom arrière (on s'éloigne)</option>
            </select>
          </label>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="etiquette mb-0 text-xs">Montée du son</span>
            <select value={element.entree} onChange={(e) => maj({ entree: e.target.value as Fondu })} className="champ py-1 text-sm">
              <option value="coupe">Directe</option>
              <option value="fondu">Fondu</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="etiquette mb-0 text-xs">Fin du son</span>
            <select value={element.sortie} onChange={(e) => maj({ sortie: e.target.value as Fondu })} className="champ py-1 text-sm">
              <option value="coupe">Directe</option>
              <option value="fondu">Fondu</option>
            </select>
          </label>
          {(element.entree !== "coupe" || element.sortie !== "coupe") && (
            <label className="col-span-2 flex flex-col gap-1">
              <span className="etiquette mb-0 text-xs">Durée des fondus : {element.transition.toFixed(1)} s</span>
              <input
                type="range"
                min={0.2}
                max={5}
                step={0.1}
                value={element.transition}
                onChange={(e) => maj({ transition: Number(e.target.value) }, false)}
                className="accent-[var(--accent)]"
              />
            </label>
          )}
        </div>
      )}

      {(element.nature === "audio" || aSon) && (
        <label className="flex flex-col gap-1">
          <span className="etiquette mb-0 text-xs">Volume : {Math.round(element.volume * 100)} %</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={element.volume}
            onChange={(e) => maj({ volume: Number(e.target.value) }, false)}
            className="accent-[var(--accent)]"
          />
        </label>
      )}
      {element.nature === "video" && element.takeId && (
        <p className="text-xs text-sourdine">Les clips générés n'ont pas de son : ajoutez la voix off et la musique sur les pistes audio.</p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-ligne pt-3">
        {principale && index > 0 && (
          <button type="button" className="bouton-discret px-2 py-1 text-xs" onClick={() => modifier((t) => deplacerDansPiste(t, piste.id, element.id, index - 1))}>
            ← Avant
          </button>
        )}
        {principale && !dernier && (
          <button type="button" className="bouton-discret px-2 py-1 text-xs" onClick={() => modifier((t) => deplacerDansPiste(t, piste.id, element.id, index + 1))}>
            Après →
          </button>
        )}
        <button type="button" className="bouton-discret px-2 py-1 text-xs" onClick={onCouper}>
          ✂ Couper au curseur
        </button>
        <button type="button" className="bouton-discret px-2 py-1 text-xs" onClick={onDupliquer}>
          Dupliquer
        </button>
        <button type="button" className="bouton-danger px-2 py-1 text-xs" onClick={onSupprimer}>
          Supprimer
        </button>
      </div>
    </fieldset>
  );
}
