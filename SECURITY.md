# Sécurité

Le plugin s'exécute sur le PC des joueurs, avec les mêmes droits qu'EDMC. Il doit donc pouvoir être relu et vérifié par n'importe qui avant installation.

## Ce que fait le plugin

- Il ne réagit qu'à l'événement `PowerplayMerits` du jeu, en galaxie Live.
- Il envoie seulement quatre champs : nom du commandant, système, mérites gagnés et heure. Voir `build_payload` dans `plugin/Squadron_Tracker/load.py`.
- Il ne parle qu'à une seule adresse HTTPS : le serveur de l'escadron choisi dans ses réglages (aucun par défaut : rien ne part tant qu’il n’est pas réglé), affiché en clair. Un nom public seulement : ni adresse IP, ni port, ni chemin. Changer de serveur efface le jeton, qui n'a été donné que par l'ancien.
- Il ne suit pas les redirections, pour que le jeton ne parte jamais ailleurs.

## Ce qu'il ne fait pas

- Pas de mise à jour automatique : chaque version est installée à la main.
- Pas d'exécutable : uniquement un fichier Python lisible, sans dépendance ajoutée.
- Pas d'identifiant Frontier. Le code de l'escadron ne sert qu'à l'inscription : il part une fois vers le serveur de l'escadron, avec le nom du commandant, et n'est jamais gardé.
- Aucune lecture de fichier ni écriture sur le disque en dehors du jeton, conservé dans les réglages d'EDMC.
- Le journal complet n'est jamais envoyé.

## Côté serveur

- Chaque membre a son propre jeton, aléatoire et révocable. Seule son empreinte SHA-256 est stockée.
- L'inscription demande le code de l'escadron (son mot de passe, comparé à durée constante), le même pour tous. Dix essais par minute et par adresse au plus. Sans mot de passe configuré, les inscriptions sont fermées.
- Un nom peut rejoindre plusieurs fois (app et plugin, PC réinstallé) : chaque installation a son jeton, au plus 10 par commandant. Au-delà, l'inscription est refusée : on ne peut pas chasser les jetons d'un membre en s'inscrivant à sa place. Le chef coupe les installations d'un membre (ses mérites restent) et peut fermer les inscriptions.
- Les noms inscrits par le code sont filtrés : lettres, chiffres, espace et . _ ' - seulement (ni @, ni retour à la ligne, ni caractère de contrôle).
- La route se lit avec la clé du suivi, la clé de chef ou un jeton de membre, et ne se modifie qu'avec la clé de chef.
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
- Le code est partagé (par exemple sur Discord) : il ne prouve pas qu'on est le commandant qu'on dit. Quiconque l'a peut s'inscrire sous n'importe quel nom et envoyer des mérites à ce nom. C'est le choix d'un escadron qui se fait confiance, comme pour les chiffres envoyés. En cas d'abus, change le mot de passe, puis retire les noms douteux avec `members.mjs` ou la page du chef.
- Cloudflare, GitHub et Spansh sont des services tiers. Spansh n'offre aucune garantie de stabilité sur les adresses utilisées.

## Signaler un problème

Ouvre un signalement privé depuis l'onglet Security du dépôt GitHub, sans publier les détails en clair.
