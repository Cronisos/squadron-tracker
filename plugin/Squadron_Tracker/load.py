"""Plugin EDMC : envoie les mérites Powerplay du commandant au tableau du squadron.

Seuls quatre champs quittent le PC, voir build_payload. Tout le reste du journal est ignoré.
Aucune mise à jour automatique, aucune écriture de fichier, aucun identifiant Frontier.
"""

import logging
import os
import queue
import re
import threading
import tkinter as tk
from typing import Any, Optional

import myNotebook as nb
import requests
from config import appname, config
from monitor import monitor
from timeout_session import new_session

__version__ = '0.1.0'

# L'unique destination du plugin. Vide : rien n'est envoyé.
SERVER_URL = ''

TOKEN_KEY = 'squadron_tracker_token'
MAX_QUEUED = 200
RETRY_SECONDS = 60
TOKEN_FORMAT = re.compile(r'^[A-Za-z0-9_-]{43}$')

plugin_name = os.path.basename(os.path.dirname(__file__))
logger = logging.getLogger(f'{appname}.{plugin_name}')

outbox: 'queue.Queue[Optional[dict[str, Any]]]' = queue.Queue(MAX_QUEUED)
stopping = threading.Event()
thread: Optional[threading.Thread] = None
token_var: Optional[tk.StringVar] = None
last_status = 'Aucun envoi pour le moment'


def build_payload(cmdr: str, system: Optional[str], entry: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Construit le message envoyé : ces quatre champs et rien d'autre."""
    merits = entry.get('MeritsGained')
    timestamp = entry.get('timestamp')
    if type(merits) is not int or merits <= 0 or not isinstance(timestamp, str) or not cmdr:
        return None
    return {'cmdr': cmdr, 'system': system or '', 'merits': merits, 'at': timestamp}


def deliver(session: Any, url: str, token: str, payload: dict[str, Any]) -> str:
    """Envoie un message et renvoie 'ok', 'drop' (refus définitif) ou 'retry'."""
    global last_status
    try:
        # Sans redirection : le jeton ne peut pas partir vers une autre adresse
        response = session.post(
            url, json=payload, headers={'Authorization': f'Bearer {token}'}, allow_redirects=False
        )
    except requests.RequestException as error:
        last_status = 'Serveur injoignable, nouvel essai plus tard'
        logger.warning(f'Envoi impossible : {type(error).__name__}')
        return 'retry'
    if response.status_code == 200:
        last_status = 'Dernier envoi réussi'
        return 'ok'
    if response.status_code in (400, 401, 403, 413):
        last_status = f'Envoi refusé (erreur {response.status_code}) : vérifie ton jeton'
        logger.warning(f'Envoi refusé : {response.status_code}')
        return 'drop'
    last_status = f'Serveur indisponible (erreur {response.status_code})'
    return 'retry'


def worker() -> None:
    session = new_session()
    url = f'{SERVER_URL}/v1/merits'
    while True:
        payload = outbox.get()
        if payload is None:
            return
        while not stopping.is_set():
            token = config.get_str(TOKEN_KEY, default='')
            if deliver(session, url, token, payload) != 'retry':
                break
            stopping.wait(RETRY_SECONDS)


def plugin_start3(plugin_dir: str) -> str:
    global thread
    if SERVER_URL.startswith('https://'):
        thread = threading.Thread(target=worker, name='Squadron Tracker', daemon=True)
        thread.start()
    else:
        thread = None
        logger.info('Aucune adresse de serveur : plugin inactif')
    return 'Squadron Tracker'


def plugin_stop() -> None:
    stopping.set()
    if thread is None:
        return
    try:
        outbox.put_nowait(None)
    except queue.Full:
        pass
    thread.join(timeout=5)


def journal_entry(
    cmdr: str, is_beta: bool, system: str, station: str, entry: dict[str, Any], state: dict[str, Any]
) -> Optional[str]:
    if entry.get('event') != 'PowerplayMerits' or is_beta or not monitor.is_live_galaxy():
        return None
    if thread is None or not TOKEN_FORMAT.match(config.get_str(TOKEN_KEY, default='')):
        return None
    payload = build_payload(cmdr, system, entry)
    if payload is None:
        return None
    try:
        outbox.put_nowait(payload)
    except queue.Full:
        logger.warning("File d'envoi pleine : mérites non envoyés")
    return None


def plugin_prefs(parent: nb.Notebook, cmdr: str, is_beta: bool) -> Optional[tk.Frame]:
    global token_var
    frame = nb.Frame(parent)
    token_var = tk.StringVar(value=config.get_str(TOKEN_KEY, default=''))
    nb.Label(frame, text='Jeton du squadron').grid(row=0, column=0, padx=10, pady=4, sticky=tk.W)
    nb.Entry(frame, textvariable=token_var, show='*', width=46).grid(row=0, column=1, padx=10, pady=4)
    nb.Label(frame, text=f'Destination : {SERVER_URL or "aucune"}').grid(
        row=1, column=0, columnspan=2, padx=10, sticky=tk.W
    )
    nb.Label(frame, text=f'État : {last_status}').grid(row=2, column=0, columnspan=2, padx=10, sticky=tk.W)
    return frame


def prefs_changed(cmdr: str, is_beta: bool) -> None:
    if token_var is not None:
        config.set(TOKEN_KEY, token_var.get().strip())
