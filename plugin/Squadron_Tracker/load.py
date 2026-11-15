"""Plugin EDMC : envoie les mérites Powerplay du commandant au tableau du squadron.

Seuls quatre champs quittent le PC, voir build_payload. Tout le reste du journal est ignoré.
Aucune mise à jour automatique, aucune écriture de fichier, aucun identifiant Frontier.
"""

import base64
import json
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

__version__ = '0.3.0'

# Serveur par défaut. Chaque escadron peut mettre le sien dans les réglages du plugin : c'est alors l'unique
# destination, affichée dans ces réglages.
SERVER_URL = 'https://squadron-tracker-api.cronisos.workers.dev'

TOKEN_KEY = 'squadron_tracker_token'
SERVER_KEY = 'squadron_tracker_server'
# https, un nom public (pas d'adresse IP), sans chemin, port ni paramètre
SERVER_FORMAT = re.compile(r'^https://(?=[^/]*[A-Za-z])[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$')
MAX_QUEUED = 200
RETRY_SECONDS = 60
TOKEN_FORMAT = re.compile(r'^[A-Za-z0-9_-]{43}$')

plugin_name = os.path.basename(os.path.dirname(__file__))
logger = logging.getLogger(f'{appname}.{plugin_name}')

outbox: 'queue.Queue[Optional[dict[str, Any]]]' = queue.Queue(MAX_QUEUED)
stopping = threading.Event()
thread: Optional[threading.Thread] = None
token_var: Optional[tk.StringVar] = None
server_var: Optional[tk.StringVar] = None
password_var: Optional[tk.StringVar] = None
join_status_var: Optional[tk.StringVar] = None
prefs_cmdr = ''
last_status = 'Aucun envoi pour le moment'


def clean_server(value: str) -> str:
    """Adresse du serveur nettoyée (sans / final ni /v1/merits), ou '' si elle n'est pas acceptable."""
    value = (value or '').strip().rstrip('/')
    if value.endswith('/v1/merits'):
        value = value[: -len('/v1/merits')]
    return value if SERVER_FORMAT.match(value) else ''


def server_url() -> str:
    """Le serveur choisi dans les réglages, sinon celui par défaut ; '' si aucun n'est valable."""
    return clean_server(config.get_str(SERVER_KEY, default='') or SERVER_URL)


CODE_PREFIX = 'ESC1.'


def parse_code(code: str) -> tuple[str, str]:
    """Code de l'escadron : « ESC1.<base64url de {"u": serveur, "p": mot de passe}> », ou le mot de passe seul.

    Renvoie (serveur ou '', mot de passe). Un code illisible donne ('', '') : rien ne part."""
    code = (code or '').strip()
    if not code.startswith(CODE_PREFIX):
        return '', code
    try:
        raw = code[len(CODE_PREFIX):]
        data = json.loads(base64.urlsafe_b64decode(raw + '=' * (-len(raw) % 4)).decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return '', ''
    if not isinstance(data, dict) or not isinstance(data.get('p'), str):
        return '', ''
    server = clean_server(data['u']) if isinstance(data.get('u'), str) else ''
    if data.get('u') and not server:
        return '', ''
    return server, data['p']


JOIN_MESSAGES = {
    401: "Code de l'escadron refusé",
    404: 'Inscriptions fermées sur ce serveur',
    409: 'Ce commandant est déjà inscrit : demande un nouveau jeton au chef',
    429: "Trop d'essais : attends une minute",
}


def join(session: Any, server: str, cmdr: str, password: str) -> tuple[Optional[str], str]:
    """Inscription avec le mot de passe de l'escadron. Renvoie (jeton ou None, message)."""
    if not server:
        return None, 'Adresse du serveur invalide'
    if not cmdr:
        return None, "Lance le jeu une fois : EDMC doit connaître ton commandant"
    if not password:
        return None, "Colle le code de l'escadron"
    try:
        response = session.post(
            f'{server}/v1/join', json={'cmdr': cmdr, 'password': password}, allow_redirects=False
        )
    except requests.RequestException as error:
        logger.warning(f'Inscription impossible : {type(error).__name__}')
        return None, 'Serveur injoignable'
    if response.status_code != 200:
        return None, JOIN_MESSAGES.get(response.status_code, f'Serveur indisponible (erreur {response.status_code})')
    try:
        token = response.json().get('token', '')
    except ValueError:
        token = ''
    if not TOKEN_FORMAT.match(token or ''):
        return None, 'Réponse inattendue du serveur'
    return token, f'Inscrit : {cmdr}'


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
    while True:
        payload = outbox.get()
        if payload is None:
            return
        while not stopping.is_set():
            token = config.get_str(TOKEN_KEY, default='')
            server = server_url()
            if server and deliver(session, f'{server}/v1/merits', token, payload) != 'retry':
                break
            stopping.wait(RETRY_SECONDS)


def plugin_start3(plugin_dir: str) -> str:
    global thread
    thread = threading.Thread(target=worker, name='Squadron Tracker', daemon=True)
    thread.start()
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
    if thread is None or not server_url() or not TOKEN_FORMAT.match(config.get_str(TOKEN_KEY, default='')):
        return None
    payload = build_payload(cmdr, system, entry)
    if payload is None:
        return None
    try:
        outbox.put_nowait(payload)
    except queue.Full:
        logger.warning("File d'envoi pleine : mérites non envoyés")
    return None


def on_join() -> None:
    """Bouton « Rejoindre » : inscrit le commandant d'EDMC avec le mot de passe, et garde le jeton reçu."""
    if server_var is None or password_var is None or token_var is None or join_status_var is None:
        return
    code_server, password = parse_code(password_var.get())
    if password_var.get().strip() and not password:
        join_status_var.set("Code de l'escadron illisible : recopie-le en entier")
        return
    server = code_server or clean_server(server_var.get())
    token, message = join(new_session(), server, prefs_cmdr, password)
    join_status_var.set(message)
    if token:
        token_var.set(token)
        server_var.set(server)
        password_var.set('')  # le code n'est jamais gardé
        config.set(SERVER_KEY, server)
        config.set(TOKEN_KEY, token)


def plugin_prefs(parent: nb.Notebook, cmdr: str, is_beta: bool) -> Optional[tk.Frame]:
    global token_var, server_var, password_var, join_status_var, prefs_cmdr
    prefs_cmdr = cmdr or ''
    frame = nb.Frame(parent)
    server_var = tk.StringVar(value=config.get_str(SERVER_KEY, default='') or SERVER_URL)
    password_var = tk.StringVar(value='')
    join_status_var = tk.StringVar(value='')
    token_var = tk.StringVar(value=config.get_str(TOKEN_KEY, default=''))
    nb.Label(frame, text='Serveur de l\'escadron').grid(row=0, column=0, padx=10, pady=4, sticky=tk.W)
    nb.EntryMenu(frame, textvariable=server_var, width=46).grid(row=0, column=1, padx=10, pady=4)
    nb.Label(frame, text="Code de l'escadron").grid(row=1, column=0, padx=10, pady=4, sticky=tk.W)
    nb.EntryMenu(frame, textvariable=password_var, show='*', width=46).grid(row=1, column=1, padx=10, pady=4)
    nb.Button(frame, text=f'Rejoindre en tant que {prefs_cmdr or "?"}', command=on_join).grid(
        row=2, column=1, padx=10, pady=4, sticky=tk.W
    )
    nb.Label(frame, textvariable=join_status_var).grid(row=3, column=1, padx=10, sticky=tk.W)
    nb.Label(frame, text='Jeton du squadron').grid(row=4, column=0, padx=10, pady=4, sticky=tk.W)
    nb.EntryMenu(frame, textvariable=token_var, show='*', width=46).grid(row=4, column=1, padx=10, pady=4)
    nb.Label(frame, text=f'Destination : {server_url() or "aucune (adresse invalide)"}').grid(
        row=5, column=0, columnspan=2, padx=10, sticky=tk.W
    )
    nb.Label(frame, text=f'État : {last_status}').grid(row=6, column=0, columnspan=2, padx=10, sticky=tk.W)
    return frame


def prefs_changed(cmdr: str, is_beta: bool) -> None:
    if token_var is None or server_var is None:
        return
    old_server = server_url()
    old_token = config.get_str(TOKEN_KEY, default='')
    server = clean_server(server_var.get())
    token = token_var.get().strip()
    config.set(SERVER_KEY, server)
    # Un jeton n'a été donné que par son serveur : changer de serveur l'efface, sauf s'il vient d'être collé
    if server != old_server and token == old_token:
        token = ''
    config.set(TOKEN_KEY, token)
