# Sécurité

Le plugin s'exécute sur le PC des joueurs, avec les mêmes droits qu'EDMC. Il doit donc pouvoir être relu et vérifié par n'importe qui avant installation.

## Ce que fait le plugin

- Il ne réagit qu'à l'événement `PowerplayMerits` du jeu, en galaxie Live.
- Il envoie seulement quatre champs : nom du commandant, système, mérites gagnés et heure. Voir `build_payload` dans `plugin/Squadron_Tracker/load.py`.
- Il ne parle qu'à une seule adresse HTTPS, écrite en clair dans `SERVER_URL`, affichée dans ses réglages.
- Il ne suit pas les redirections, pour que le jeton ne parte jamais ailleurs.

## Ce qu'il ne fait pas

- Pas de mise à jour automatique : chaque version est installée à la main.
- Pas d'exécutable : uniquement un fichier Python lisible, sans dépendance ajoutée.
- Pas d'identifiant Frontier, pas de mot de passe.
- Aucune lecture de fichier ni écriture sur le disque en dehors du jeton, conservé dans les réglages d'EDMC.
- Le journal complet n'est jamais envoyé.

## Côté serveur

- Chaque membre a son propre jeton, aléatoire et révocable. Seule son empreinte SHA-256 est stockée.
- Un jeton est lié à un commandant et ne peut pas créditer quelqu'un d'autre.
- Les valeurs sont vérifiées et plafonnées, et le nombre de requêtes est limité.
- Les seules données conservées sont le nom du commandant, le système, les mérites et l'heure. Retirer un membre les efface.
- Les réponses d'erreur ne donnent aucun détail interne.
- Les secrets et la route restent dans les réglages chiffrés de Cloudflare et de GitHub, jamais dans le code ni les journaux.
- Discord : les mentions sont interdites dans les messages publiés.
- Les dépendances sont figées par `package-lock.json` et installées sans script. Les actions GitHub sont figées par commit.

## Limites à connaître

- Aucune sécurité n'est totale. Une fois installé, tout plugin EDMC peut techniquement lire les fichiers de l'utilisateur, d'où l'importance de relire `load.py` et de vérifier l'empreinte à chaque version.
- Le classement repose sur la confiance : un membre peut modifier son plugin pour envoyer de faux chiffres. La barre du système, issue de Spansh, sert de contrôle global, pas individuel.
- Un jeton qui fuite permet d'envoyer de faux mérites pour ce commandant, jusqu'à sa révocation.
- Cloudflare, GitHub et Spansh sont des services tiers. Spansh n'offre aucune garantie de stabilité sur les adresses utilisées.

## Signaler un problème

Ouvre un signalement privé depuis l'onglet Security du dépôt GitHub, sans publier les détails en clair.
