# Squadron Tracker

Suivi Powerplay d'une route de squadron dans un salon Discord : une carte animée où un vaisseau avance de système en système, avec la progression de l'objectif, l'avancement global et un classement des membres.

État actuel : le code et les tests fonctionnent en local. L'API, GitHub Actions et le plugin n'ont pas encore tourné en conditions réelles.

## Les parties du projet

| Dossier | Rôle | Où ça tourne |
|---|---|---|
| [plugin/](plugin/) | Plugin EDMC : envoie les mérites gagnés | PC des membres |
| [api/](api/) | Reçoit les mérites et sert le classement | Cloudflare Workers |
| [tracker/](tracker/) | Lit Spansh, dessine le GIF et publie dans Discord | GitHub Actions |
| [config/](config/) | Exemple de route. La vraie route reste privée | Secret GitHub |

La progression des systèmes vient des données publiques de [Spansh](https://spansh.co.uk). Les mérites individuels viennent uniquement du plugin. Le plugin ne parle qu'à l'API, et ne connaît ni Discord ni Spansh.

## Sécurité

Le fonctionnement et les limites sont décrits dans [SECURITY.md](SECURITY.md).

## Installer le plugin

1. Installe [EDMarketConnector](https://github.com/EDCD/EDMarketConnector).
2. Télécharge l'archive du plugin depuis les versions publiées du dépôt.
3. Vérifie son empreinte dans PowerShell : `Get-FileHash Squadron_Tracker.zip -Algorithm SHA256`. Elle doit correspondre à celle de la version publiée.
4. Lis `load.py` : il est court, et c'est le seul code qui tourne sur ton PC.
5. Copie le dossier `Squadron_Tracker` dans `%LOCALAPPDATA%\EDMarketConnector\plugins`.
6. Relance EDMC, puis colle ton jeton dans Fichier, Paramètres, Squadron Tracker.

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

Le déploiement n'a pas encore été essayé : ces étapes sont à valider au premier lancement.

**API**

```
cd api
npx wrangler d1 create squadron-tracker
npx wrangler d1 execute squadron-tracker --remote --file=schema.sql
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put TRACKER_TOKEN
npx wrangler deploy
```

Reporte l'identifiant de la base dans `wrangler.toml` avant de déployer. Pour les deux secrets, génère de longues valeurs aléatoires.

**Suivi**

Dans le dépôt GitHub, va dans Settings, Secrets and variables, Actions, et ajoute :

| Secret | Contenu |
|---|---|
| `ROUTE_JSON` | Le contenu de ta route, sur le modèle de `config/route.example.json` |
| `DISCORD_WEBHOOK_URL` | L'adresse du webhook du salon |
| `API_URL` | L'adresse de l'API, sans `/` final |
| `TRACKER_TOKEN` | La même valeur que côté API |

**Plugin**

Indique l'adresse de l'API dans `SERVER_URL` de `load.py`, puis publie une version avec l'empreinte de son archive.

**Membres**

```
API_URL=... ADMIN_TOKEN=... node api/scripts/members.mjs add "Nom CMDR"
API_URL=... ADMIN_TOKEN=... node api/scripts/members.mjs remove "Nom CMDR"
```

Retirer un membre coupe son jeton et efface ses mérites.

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
