# Remote Smart Trackpad — UX

Référence actuelle : refonte du 28 septembre 2026 et [maquettes Figma](https://www.figma.com/design/IwpOo2N0yhqFFIFqEHERPH/Untitled?node-id=0-1). Elle remplace l’ancien modèle de sélection seule, brouillon persistant et résolution manuelle des divergences. Installation, architecture et limites vérifiées : [README](README.md).

## Répartition

- **Ordinateur :** serveur local, pont Windows, appairage et liste des accès. Chaque token conserve un nom et une date de première connexion. Révoquer un token déconnecte immédiatement l’appareil.
- **Smartphone :** contrôle du pointeur, défilement, touches et miroir du texte. À la première arrivée, demander le nom. Aucun bouton pour supprimer ou gérer les accès.
- **Windows :** icône en zone de notification, console consultable, arrêt du serveur, démarrage automatique coché au premier lancement puis conservé selon le choix. Aucun flash de console à l’ouverture de session.

## Écrans

Respecter les mesures des trois frames Figma : `1:2` (375 × 711), `6:552` (menu), `2:120` (édition, zone visible 375 × 405 au-dessus du clavier). L’interface utilise des Web Components, des tokens de couleur/espacement et des unités rem/em. Lucide et Inter sont servis localement.

- En haut : état discret et menu ; pendant l’édition, remplacer le menu par la fermeture explicite.
- Zone pointeur extensible, motif de points déplacé avec le geste. Boutons gauche/droit dessous, défilement vertical à droite, horizontal dessous, clic milieu dans l’angle.
- Rails réellement scrollables : mouvement du motif, inertie du navigateur, recentrage après la fin du mouvement. Ne pas recréer la vélocité en JavaScript.
- Menu : lignes fonctions, média, édition, modificateurs ; option modificateurs persistants. Les fonctions vont jusqu’à F14 dans la maquette, malgré le libellé F1–F12 du menu original.
- En bas : ouverture du texte. Pendant l’édition, champ au-dessus de la seule ligne de modificateurs, si activée. Les autres lignes disparaissent sans perdre leurs préférences.
- État compact : clics de 24 au lieu de 28 unités Figma, rail horizontal de 28 au lieu de 36, touches de 32 au lieu de 40, marges basses de 8 au lieu de 16. Animer les changements et respecter la réduction des animations du système.

## Miroir du texte

L’ouverture mobile démarre la lecture du champ PC complet. Le contenu et la sélection se synchronisent ; le changement de focus PC remplace directement le miroir. Le champ reste ouvert jusqu’à la fermeture volontaire, même si le clavier se masque, si le PC perd son champ éditable ou si la connexion tombe.

Une composition IME ne s’envoie qu’après validation. Un changement de champ invalide les événements et réponses de l’ancien champ. Chaque modification contient une identité de champ et une révision ; une modification périmée est refusée et remplacée par l’état PC. Après reconnexion, relire le PC, sans réinjecter un ancien brouillon.

Ne jamais deviner une position de curseur inaccessible. Un champ protégé, non éditable ou non pris en charge rend le miroir indisponible sans fermer le panneau. Accents, caractères combinés, emoji, remplacement de sélection, collage long et sélection mobile doivent être vérifiés contre les applications Windows visées.

## Validation d’usage

Vérifier sur téléphone : ouverture/fermeture répétée du clavier, rotation, saisie prédictive et IME, scroll inertiel interrompu/repris, appui souris maintenu pendant déplacement, modificateurs, déconnexion/reconnexion, changement de champ pendant une saisie en attente. Les contrôles bas restent dans le viewport visible. Une interruption relâche les entrées maintenues. Le rendu et le protocole doivent rester testables séparément.
