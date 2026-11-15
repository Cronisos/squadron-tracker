# Squadron Tracker

Suivi Powerplay d'une route de squadron dans un salon Discord : une carte animée où un vaisseau avance de système en système, avec la progression de l'objectif, l'avancement global et un classement des membres. Chaque jeudi, un rapport figé résume la semaine.

État actuel : l'API et le suivi tournent. Le plugin reste à essayer avec le vrai EDMC avant d'être distribué.

## Les parties du projet

| Dossier | Rôle | Où ça tourne |
|---|---|---|
| [plugin/](plugin/) | Plugin EDMC : envoie les mérites gagnés | PC des membres |
| [api/](api/) | Reçoit les mérites et sert le classement | Cloudflare Workers |
| [tracker/](tracker/) | Lit Spansh, dessine le GIF et publie dans Discord | GitHub Actions |
| [config/](config/) | Exemple de route. La vraie route reste privée | Secret GitHub |

La progression des systèmes vient des données publiques de [Spansh](https://spansh.co.uk). Les mérites individuels viennent uniquement du plugin. Le plugin ne parle qu'à l'API, et ne connaît ni Discord ni Spansh.

## Salon Discord

Réserve le salon au bot, en lecture seule pour les joueurs. La carte est modifiée sur place à chaque mise à jour. Quand une bannière ou un rapport est publié, elle est republiée dessous pour rester le dernier message.

Le rapport part le jeudi après 9 h UTC. Le premier passage enregistre seulement un relevé de départ : le premier rapport arrive le jeudi suivant.

## Sécurité

Le fonctionnement et les limites sont décrits dans [SECURITY.md](SECURITY.md).

## Installer le plugin

1. Installe [EDMarketConnector](https://github.com/EDCD/EDMarketConnector).
2. Télécharge l'archive du plugin depuis les versions publiées du dépôt.
3. Vérifie son empreinte dans PowerShell : `Get-FileHash Squadron_Tracker.zip -Algorithm SHA256`. Elle doit correspondre à celle de la version publiée.
4. Lis `load.py` : il est court, et c'est le seul code qui tourne sur ton PC.
5. Copie le dossier `Squadron_Tracker` dans `%LOCALAPPDATA%\EDMarketConnector\plugins`.
6. Relance EDMC et lance le jeu une fois, pour qu'EDMC connaisse ton commandant.
7. Dans Fichier, Paramètres, Squadron Tracker : colle l'adresse du serveur de l'escadron et le mot de passe donnés
   par le chef, puis clique « Rejoindre en tant que … ». Le plugin reçoit ton jeton et le garde ; le mot de passe,
   lui, n'est pas gardé. Si le chef t'a donné un jeton à la place, colle-le dans « Jeton du squadron ».

Elite Compagnon fait la même chose dans sa page Escadron. Les deux peuvent tourner ensemble : un même gain ne compte
qu'une fois.

Dans les réglages d'EDMC, active aussi l'envoi vers EDDN pour garder la progression à jour sur Spansh. Ces données partent alors de ton EDMC, sans passer par ce projet.

## Essai local

Il faut Node 24.

```
npm install --ignore-scripts
npm test
npm run demo
```

`npm run demo` crée `out/route.gif`, `out/route.png` et `out/valide.png` avec des données simulées. Variables utiles :

| Variable | Effet |
|---|---|
| `ROUTE_FILE` | Fichier de route à utiliser, par exemple `config/route.local.json` |
| `DEMO_STEP` | Étape simulée, à partir de 0 |
| `DEMO_THEME` | `orange` ou `prism` |
| `DISCORD_WEBHOOK_URL` | Publie aussi le résultat dans ce salon |

Tests du plugin, avec Python 3.9 ou plus : `python plugin/tests/test_load.py`.

## Déploiement


**API**

```
cd api
npx wrangler d1 create squadron-tracker
npx wrangler d1 execute squadron-tracker --remote --file=schema.sql
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put TRACKER_TOKEN
npx wrangler secret put JOIN_PASSWORD
npx wrangler deploy
```

Reporte l'identifiant de la base dans `wrangler.toml` avant de déployer. Pour `ADMIN_TOKEN` et `TRACKER_TOKEN`, génère de longues valeurs aléatoires. `JOIN_PASSWORD` est le mot de passe de l'escadron, que tu donnes aux membres : sans lui, les inscriptions sont fermées et seul `members.mjs add` crée des membres. Pour en changer, relance `npx wrangler secret put JOIN_PASSWORD` : les membres déjà inscrits gardent leur jeton.

**Suivi**

Dans le dépôt GitHub, va dans Settings, Secrets and variables, Actions, et ajoute :

| Secret | Contenu |
|---|---|
| `ROUTE_JSON` | Le contenu de ta route, sur le modèle de `config/route.example.json` |
| `DISCORD_WEBHOOK_URL` | L'adresse du webhook du salon |
| `API_URL` | L'adresse de l'API, sans `/` final |
| `TRACKER_TOKEN` | La même valeur que côté API |

**Plugin**

`SERVER_URL` de `load.py` est seulement le serveur proposé par défaut : chaque membre peut coller celui de son escadron dans les réglages du plugin. Publie une version avec l'empreinte de son archive.

**Membres**

Avec le mot de passe, chaque membre s'inscrit seul, depuis le plugin ou Elite Compagnon. Un nom déjà inscrit est
refusé : le mot de passe ne permet pas de prendre la place de quelqu'un. Pour le reste :

```
API_URL=... ADMIN_TOKEN=... node api/scripts/members.mjs list
API_URL=... ADMIN_TOKEN=... node api/scripts/members.mjs add "Nom CMDR"
API_URL=... ADMIN_TOKEN=... node api/scripts/members.mjs remove "Nom CMDR"
```

`list` montre les inscrits. `add` crée un membre ou lui donne un nouveau jeton (PC réinstallé, jeton perdu) : il
garde ses mérites. Retirer un membre coupe son jeton et efface ses mérites.

## Format de la route

- `power` : la puissance, écrite comme sur Spansh.
- `meritsPerPoint` : mérites par point de contrôle.
- `since` : début du classement, au format `2026-11-01T00:00:00Z`.
- `theme` : `orange` ou `prism`.
- `stops` : les étapes dans l'ordre, avec `name`, `goal` (`Prise`, `Consolidé` ou `Forteresse`), `merits` et, si besoin, `short` (nom raccourci sur la carte) et `noLarge: true`.

## Limites

- Les mérites gagnés quand EDMC est fermé ne sont pas comptés, ni ceux encore en attente d'envoi à sa fermeture.
- La progression d'un système ne change sur Spansh que lorsqu'un joueur y passe et envoie ses données vers EDDN. La carte affiche l'âge de la donnée.
- La barre d'un système inclut le travail des joueurs hors squadron, alors que le classement ne compte que les membres équipés.
- Les tâches planifiées de GitHub peuvent démarrer en retard, et GitHub les met en pause après une longue période sans activité sur le dépôt.

## Licences

Code sous [licence MIT](LICENSE). Polices sous licence SIL Open Font, voir [tracker/fonts/](tracker/fonts/).
