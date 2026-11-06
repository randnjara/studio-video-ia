"""Plans calés sur la voix off audio (l'audio est la référence, comme sur ElevenLabs).

Whisper donne chaque mot prononcé avec son horodatage. Chaque plan (sa réplique, colonne « voix ») est aligné sur ces mots
(alignement de séquences sur les mots normalisés, tolérant aux mots mal reconnus), puis :
- le plan commence dans le silence qui le sépare du plan d'avant et finit dans celui qui le sépare du suivant ; le premier
  plan commence à 0 s, le dernier finit à la fin de la voix : les plans couvrent la voix sans trou ni chevauchement ;
- un plan dont aucun mot n'est trouvé reçoit sa part du silence entre ses voisins (au prorata de sa réplique) ;
- un plan de plus de 5 s reçoit une proposition de coupure à une pause (fin de phrase de préférence).

Aucune dépendance au modèle ici : la fonction aligner() est testée avec des mots inventés.
"""

import difflib
import math
import re
import unicodedata

DUREE_MAX = 5.0
# Pause minimale entre deux mots pour y couper un plan trop long
PAUSE_MIN = 0.12
# Un mot reconnu de travers (malgache…) compte comme trouvé s'il ressemble assez au mot attendu
RESSEMBLANCE_MIN = 0.6


def normaliser(mot):
    t = unicodedata.normalize("NFD", mot.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "", t)


def jetons(texte):
    """Mots d'une réplique avec leur place dans le texte : [(mot normalisé, début, fin)]."""
    return [(normaliser(m.group()), m.start(), m.end()) for m in re.finditer(r"[^\s]+", texte or "") if normaliser(m.group())]


def _correspondances(attendus, entendus):
    """Pour chaque mot attendu, l'indice du mot entendu qui lui correspond (ou None), et s'il est exact."""
    corr = [None] * len(attendus)
    exact = [False] * len(attendus)
    sm = difflib.SequenceMatcher(None, attendus, entendus, autojunk=False)
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            for k in range(i2 - i1):
                corr[i1 + k], exact[i1 + k] = j1 + k, True
        elif op == "replace":
            # Mots reconnus de travers : appariés dans l'ordre, gardés s'ils se ressemblent assez
            for k in range(i2 - i1):
                j = j1 + min(j2 - j1 - 1, round(k * (j2 - j1) / (i2 - i1)))
                if difflib.SequenceMatcher(None, attendus[i1 + k], entendus[j]).ratio() >= RESSEMBLANCE_MIN:
                    corr[i1 + k] = j
    return corr, exact


def _coupure(fin_avant, debut_apres):
    """Instant de coupure entre deux plans : au milieu du silence qui les sépare."""
    return (fin_avant + debut_apres) / 2 if debut_apres >= fin_avant else debut_apres


def proposer_scission(texte, toks, corr, mots, debut, fin, duree_max=DUREE_MAX):
    """Coupures proposées pour un plan trop long : aux pauses entre deux mots, le plus près des points de partage
    idéaux, de préférence après une fin de phrase ou une virgule. Renvoie [{"coupe", "textes": [...]}] ou []."""
    duree = fin - debut
    if duree <= duree_max:
        return []
    parties = math.ceil(duree / duree_max - 1e-9)
    candidats = []
    for k in range(len(toks) - 1):
        a, b = corr[k], corr[k + 1]
        if a is None or b is None or b <= a:
            continue
        pause = mots[b]["debut"] - mots[a]["fin"]
        if pause < PAUSE_MIN:
            continue
        ponctue = bool(re.search(r"[.!?…;:,]$", texte[toks[k][1]:toks[k][2]]))
        candidats.append({"t": (mots[a]["fin"] + mots[b]["debut"]) / 2, "pause": pause, "ponctue": ponctue, "car": toks[k][2]})
    choisis = []
    for i in range(1, parties):
        cible = debut + duree * i / parties
        libres = [c for c in candidats if c not in choisis]
        if not libres:
            break
        choisis.append(min(libres, key=lambda c: abs(c["t"] - cible) - 0.6 * c["pause"] - (0.5 if c["ponctue"] else 0)))
    if not choisis:
        return []
    choisis.sort(key=lambda c: c["t"])
    bornes = [0] + [c["car"] for c in choisis] + [len(texte)]
    textes = [texte[a:b].strip() for a, b in zip(bornes, bornes[1:])]
    return [{"coupes": [round(c["t"], 3) for c in choisis], "textes": textes}]


def aligner(plans, mots, duree_audio, duree_max=DUREE_MAX):
    """plans : [{"scene_id", "texte"}] dans l'ordre ; mots : [{"mot", "debut", "fin"}] de Whisper.
    Renvoie [{"scene_id", "debut", "fin", "duree", "trouves", "total", "manquants", "statut", "scission"}]."""
    attendus, origine, toks_par_plan = [], [], []
    for i, p in enumerate(plans):
        toks = jetons(p.get("texte", ""))
        toks_par_plan.append(toks)
        for k, t in enumerate(toks):
            attendus.append(t[0])
            origine.append((i, k))
    entendus = [normaliser(m["mot"]) for m in mots]
    corr_globale, exact_global = _correspondances(attendus, entendus)
    corr = [[None] * len(t) for t in toks_par_plan]
    exact = [[False] * len(t) for t in toks_par_plan]
    for n, (i, k) in enumerate(origine):
        corr[i][k], exact[i][k] = corr_globale[n], exact_global[n]

    # Bornes des mots trouvés de chaque plan (les mots appariés hors de l'ordre sont ignorés)
    ancres, etendues = [], []
    dernier = -1
    for i in range(len(plans)):
        idx = sorted(j for j in corr[i] if j is not None and j > dernier)
        if idx:
            ancres.append((mots[idx[0]]["debut"], mots[idx[-1]]["fin"]))
            etendues.append((idx[0], idx[-1]))
            dernier = idx[-1]
        else:
            ancres.append(None)
            etendues.append(None)
    # Les mots entendus entre deux plans trouvés (non attendus) vont au plan qui les précède : le texte prononcé est complet
    for i in range(len(plans)):
        if etendues[i] is None:
            continue
        suivant = next((etendues[k][0] for k in range(i + 1, len(plans)) if etendues[k] is not None), len(mots))
        etendues[i] = (etendues[i][0], max(etendues[i][1], suivant - 1))

    # Plans trouvés : coupures au milieu des silences ; premier plan à 0 s, dernier jusqu'à la fin de la voix
    n = len(plans)
    debuts, fins = [0.0] * n, [0.0] * n
    for i in range(n):
        if ancres[i] is None:
            continue
        a, b = ancres[i]
        if i == 0:
            debuts[i] = 0.0
        elif ancres[i - 1] is not None:
            debuts[i] = _coupure(ancres[i - 1][1], a)
        else:
            debuts[i] = a  # le plan d'avant (non trouvé) a pris le silence qui précède
        if i == n - 1:
            fins[i] = duree_audio
        elif ancres[i + 1] is not None:
            fins[i] = _coupure(b, ancres[i + 1][0])
        else:
            fins[i] = b  # le plan suivant (non trouvé) prend le silence qui suit
    # Plans sans mot trouvé : ils se partagent l'intervalle entre leurs voisins trouvés, au prorata de leur réplique
    i = 0
    while i < n:
        if ancres[i] is not None:
            i += 1
            continue
        j = i
        while j < n and ancres[j] is None:
            j += 1
        gauche = ancres[i - 1][1] if i > 0 else 0.0
        droite = ancres[j][0] if j < n else duree_audio
        droite = max(gauche, droite)
        poids = [max(1, len(toks_par_plan[k])) for k in range(i, j)]
        t = gauche
        for k, w in zip(range(i, j), poids):
            debuts[k] = t
            t += (droite - gauche) * w / sum(poids)
            fins[k] = t
        i = j
    # Ordre et bornes
    for i in range(n):
        debuts[i] = min(max(0.0, debuts[i]), duree_audio)
        fins[i] = min(max(debuts[i], fins[i]), duree_audio)
        if i + 1 < n:
            debuts[i + 1] = max(debuts[i + 1], fins[i])

    resultat = []
    for i, p in enumerate(plans):
        toks = toks_par_plan[i]
        trouves = sum(1 for j in corr[i] if j is not None)
        manquants = [p["texte"][t[1]:t[2]] for t, j in zip(toks, corr[i]) if j is None]
        d = fins[i] - debuts[i]
        if ancres[i] is None:
            statut = "hors_voix" if debuts[i] >= duree_audio - 0.1 or d < 0.1 else ("sans_parole" if not toks else "non_trouve")
        else:
            statut = "ok" if all(exact[i]) else "approx"
        resultat.append(
            {
                "scene_id": p["scene_id"],
                "debut": round(debuts[i], 3),
                "fin": round(fins[i], 3),
                "duree": round(d, 3),
                "trouves": trouves,
                "total": len(toks),
                "manquants": manquants[:20],
                "statut": statut,
                # Texte réellement prononcé (mots de Whisper) et instants de la parole dans le plan
                "prononce": " ".join(m["mot"] for m in mots[etendues[i][0] : etendues[i][1] + 1]) if etendues[i] else "",
                "parole_debut": round(ancres[i][0], 3) if ancres[i] else None,
                "parole_fin": round(ancres[i][1], 3) if ancres[i] else None,
                "scission": proposer_scission(p.get("texte", ""), toks, corr[i], mots, debuts[i], fins[i], duree_max)
                if ancres[i] is not None
                else [],
            }
        )
    return resultat
