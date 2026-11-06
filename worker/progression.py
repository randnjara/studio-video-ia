"""Nouvelles envoyées au studio pendant un travail (runpod.serverless.progress_update), lues par sa frise en direct :
{"etape": demarrage | telechargement | calcul | envoi, "pct": 0-100 ou None, "message": "…"}.
Au plus une nouvelle toutes les 2 s pour une même étape (une nouvelle étape part tout de suite). Ne fait jamais échouer
le travail. (Même fichier dans worker/, worker-voix/ et worker-lipsync/.)"""

import time

import runpod

INTERVALLE_S = 2.0
_ETAT = {"job": None, "dernier": 0.0, "etape": None}


def commencer(job):
    _ETAT.update(job=job, dernier=0.0, etape=None)


def signaler(etape, pct=None, message="", forcer=False):
    job = _ETAT["job"]
    if not job:
        return False
    maintenant = time.time()
    if not forcer and etape == _ETAT["etape"] and maintenant - _ETAT["dernier"] < INTERVALLE_S:
        return False
    _ETAT.update(dernier=maintenant, etape=etape)
    nouvelle = {"etape": etape, "pct": None if pct is None else round(max(0.0, min(100.0, float(pct))), 1), "message": str(message)[:200]}
    try:
        runpod.serverless.progress_update(job, nouvelle)
    except Exception as e:  # le suivi ne bloque jamais le calcul
        print(f"Nouvelle non envoyée : {e}")
        return False
    return True
