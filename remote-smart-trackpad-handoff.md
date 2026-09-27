# Remote Smart Trackpad — handoff

## Produit et périmètre

Projet open source : un téléphone Android contrôle un PC Windows depuis une webapp locale, sans application Android à installer. Elle regroupe un trackpad, des boutons souris, des touches spéciales configurables et un éditeur utilisant le clavier natif du téléphone. Après le premier appairage, l'accès doit être rapide et la reconnexion simple.

Ce document décrit les comportements à obtenir. Le langage, les bibliothèques, les composants Web, le transport et l'organisation du code restent à choisir selon leur compatibilité, leur maintenance et les résultats des essais sur appareils réels. Reprendre des composants tactiles existants s'ils satisfont les objectifs UX ; sinon créer ceux qui manquent.

## Objectifs UX de la webapp

- **Ressenti natif :** démarrage rapide depuis l'écran d'accueil, mode plein écran quand il est disponible, gestes fluides, retour visuel immédiat et peu de navigation entre les commandes. L'application doit aussi fonctionner dans un onglet ordinaire.
- **Page stable :** aucun zoom de la page par pincement, double tap ou focus d'un champ ; aucun défilement de la page pendant l'usage du trackpad. Les listes et panneaux prévus pour défiler doivent conserver leur défilement. Garder une taille de texte lisible et les fonctions d'agrandissement du système.
- **Adaptation mobile :** cibles tactiles confortables et espacées, états appuyé/actif lisibles, prise en compte des bords système, de l'orientation et de l'apparition du clavier virtuel. L'éditeur, les touches utiles et la commande de fermeture restent accessibles pendant la frappe.
- **Saisie fiable :** conserver le focus de l'éditeur quand une touche spéciale compatible est utilisée ; ne pas refermer le clavier ou déplacer le curseur mobile par accident. Accents, autocorrection, prédiction, emoji et langues du clavier Android doivent rester utilisables.
- **Gestes fiables :** distinguer clic, double clic, glisser et défilement sans actions parasites. Après une interruption tactile, une perte de focus ou une déconnexion, relâcher les boutons et modificateurs maintenus.
- **État compréhensible :** montrer connexion, reconnexion, commandes en attente ou refusées et mode actif du clavier. Aucune action ne doit sembler réussie alors qu'elle ne l'est pas.

Vérifier ces points sur de vrais téléphones Android, en portrait et paysage, avec le clavier affiché et masqué. Tester notamment les gestes concurrents du navigateur et les champs dont le focus provoque habituellement un zoom.

## Trackpad, souris et touches

- Un doigt déplace le pointeur ; tap = clic gauche ; double tap = double clic ; appui long puis mouvement = glisser.
- Deux doigts défilent ; tap à deux doigts = clic droit ; tap à trois doigts = clic milieu. Prévoir aussi des boutons explicites gauche, milieu et droit : les gestes complexes ne sont jamais le seul accès à un clic.
- Le glisser garde le bouton enfoncé jusqu'au relâchement. Une interruption doit l'arrêter proprement. Les mouvements rapides peuvent être regroupés pour préserver la réactivité.
- Les touches fréquentes doivent être accessibles sans ouvrir un menu : Échap, Tab, Ctrl, Shift, Alt, Win, flèches, Suppr, Home/End, Page précédente/suivante, Inser et Fn. Prévoir des groupes extensibles pour F1–F12, édition, média, système et touches personnalisées ; l'utilisateur peut réorganiser la zone.
- Un tap sur un modificateur l'arme pour la prochaine touche ; un double tap peut le verrouiller ; un nouveau tap le déverrouille. L'état armé/verrouillé doit être visible et ne jamais persister à l'insu de l'utilisateur.
- Tester les raccourcis Ctrl+C, Ctrl+Shift+Échap, Win+R, Alt+Tab et AltGr sur clavier français. AltGr dépend de la disposition du PC. Fn est une fonction interne configurable si aucune touche système équivalente n'existe.

## Session d'édition : règles et cas

**Ouverture.** Le focus d'un champ PC ne déclenche aucune copie. La synchronisation de texte commence uniquement quand l'utilisateur ouvre l'éditeur sur le téléphone.

| Situation à l'ouverture | Comportement attendu |
| --- | --- |
| Texte sélectionné sur le PC | Charger seulement la sélection, puis permettre son remplacement depuis le téléphone. Une sélection trop grande demande une confirmation avant transfert. |
| Curseur sans sélection, même dans un très gros document | Ouvrir un buffer mobile vide au point d'insertion. Ne jamais lire ou transférer tout le champ pour remplir l'éditeur. |
| Sélection ou position du curseur indisponible | Indiquer la limite et proposer uniquement les actions réellement sûres ; ne pas inventer de position ou de texte. |
| Aucun champ texte exploitable | Signaler que l'édition synchronisée est indisponible et conserver les commandes souris/touches utilisables. |

**Pendant la saisie.** Le texte composé sur le téléphone reste visible et modifiable dans son buffer local pendant que les modifications sont appliquées au PC. Chaque opération doit pouvoir être suivie jusqu'à son application ou son échec ; une notification de changement du champ PC ne justifie jamais de recharger tout le champ ni de remplacer le buffer. Les corrections et remplacements faits par le clavier mobile comptent comme modifications de texte, pas comme une simple suite de touches. Ne transmettre la composition IME comme texte définitif qu'une fois validée.

**Limites du buffer.** Sans sélection initiale, le buffer ne représente que la saisie mobile, pas le texte déjà présent dans le champ PC. La suppression, le déplacement du curseur et la sélection dans l'éditeur mobile doivent respecter cette limite : ne pas prétendre connaître ni effacer silencieusement le texte PC situé hors du buffer.

**Changement de contexte.**

- Une nouvelle sélection volontaire sur le PC peut remplacer le contenu mobile par le texte sélectionné, avec un changement de contexte visible. Une simple notification de changement de texte ne doit pas avoir cet effet.
- Un changement de contrôle actif termine ou suspend l'ancienne session proprement ; la saisie mobile en attente doit être résolue avant de l'effacer.
- Fermer l'éditeur ne doit pas perdre immédiatement une saisie encore en attente ou non appliquée.
- En cas de modification indépendante sur le PC, de désaccord entre les deux contenus, d'échec d'injection ou de coupure réseau, préserver le texte mobile et proposer une résolution explicite. Ne jamais écraser silencieusement la version du PC ou celle du téléphone.

Le téléphone représente ce que l'utilisateur compose dans la session ; l'application Windows reste la source de vérité pour son document. Les logiciels Windows n'exposent pas tous les mêmes capacités de focus, sélection, curseur et modification : les détecter et adapter l'interface aux capacités réellement disponibles.

## Connexion et limites Windows

- Limiter l'accès au réseau local. Un nouvel appareil doit être appairé explicitement, par exemple avec un code ou un QR code ; mémoriser cet appairage pour les connexions suivantes. Ne pas exposer directement le service sur Internet.
- À la reconnexion, indiquer clairement si des commandes sont encore en attente et éviter de les appliquer deux fois. Une souris ou une touche ne doit pas rester « enfoncée » après la coupure.
- Ne pas demander de privilèges administrateur par défaut. Windows peut refuser le contrôle d'une application élevée : afficher cette limite sans faire croire que la commande a fonctionné.

## Scénarios de validation

1. **Champ volumineux :** ouvrir l'éditeur au milieu d'un document de plusieurs mégaoctets sans sélection ; aucun transfert du champ entier, éditeur vide, saisie visible sur les deux appareils.
2. **Sélection :** sélectionner « très long » sur le PC, ouvrir l'éditeur, recevoir uniquement « très long », le remplacer par « court » ; seule cette plage est modifiée sur le PC.
3. **IME et correction :** saisir « Bonjour éàç », corriger un mot, insérer un emoji puis utiliser AltGr ; le résultat final correspond sur le PC et le téléphone, sans doublon ni composition intermédiaire.
4. **Modification externe :** pendant la session, modifier le champ depuis le PC ; le buffer mobile et sa sélection ne sautent pas. Une divergence est signalée et résolue explicitement.
5. **Changement de champ et déconnexion :** passer du champ A au champ B ou couper le réseau avec une opération en attente ; aucune saisie ne disparaît silencieusement et aucun appui ne reste bloqué.
6. **Souris et raccourcis :** vérifier clics gauche/milieu/droit, double clic, glisser, défilement et modificateurs armés/verrouillés ; les boutons explicites restent utilisables.
7. **UX mobile :** répéter ces actions dans un onglet et depuis l'écran d'accueil, en portrait et paysage, clavier ouvert et fermé ; aucun zoom ou défilement involontaire de la page, commandes toujours atteignables.
