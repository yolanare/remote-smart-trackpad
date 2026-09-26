# Phone Text Remote --- Handoff technique

## 0. Résumé

Projet open-source pour Windows + Android, sans application Android.

Le téléphone ouvre une **webapp locale** servie par le PC. La webapp
fournit :

1.  un éditeur de texte utilisant le clavier natif Android (Gboard,
    etc.) ;
2.  une zone de touches spéciales configurable ;
3.  un trackpad ;
4.  des boutons souris, dont clic gauche, milieu et droit ;
5.  une connexion temps réel PC ↔ téléphone par WebSocket.

### Principe fondamental

> Le focus PC seul ne déclenche aucune copie de texte.

Le PC ne commence à synchroniser le contenu textuel que lorsque le
téléphone a explicitement ouvert le clavier/éditeur.

Cela évite les transferts inutiles de très gros champs, les snapshots
coûteux et les changements inattendus dans l'éditeur mobile.

------------------------------------------------------------------------

## 1. UX cible

### 1.1 État normal

Le téléphone affiche :

-   trackpad ;
-   boutons souris ;
-   barre de touches spéciales ;
-   état de connexion.

Aucun contenu texte PC n'est chargé.

### 1.2 Ouverture du clavier

Quand l'utilisateur appuie sur `Keyboard` :

``` text
PHONE
  ↓
keyboard_session.open
  ↓
SERVER
  ↓
focused text control + selection
```

### 1.3 Si du texte est sélectionné

Le serveur récupère **uniquement le texte sélectionné** et l'envoie au
téléphone.

Windows UI Automation expose directement la sélection d'un contrôle via
`IUIAutomationTextPattern::GetSelection`. Une sélection absente peut
être représentée par une plage dégénérée au point d'insertion.

### 1.4 Aucun texte sélectionné

Le serveur **ne récupère pas le contenu complet du champ**.

La session mobile démarre avec un buffer local vide :

``` text
PC:       [ énorme document ... | caret ]
PHONE:    [ ]

User types: "bonjour"

PHONE:    [bonjour]
PC:       [ énorme document ... bonjour| ]
```

Les caractères saisis depuis le téléphone sont envoyés au PC comme
entrée utilisateur normale et restent dans l'éditeur mobile.

### 1.5 Synchronisation temps réel

Pour les caractères injectés depuis le téléphone, privilégier les
opérations locales connues et leurs accusés de réception plutôt que de
recharger le champ complet.

------------------------------------------------------------------------

## 2. Règle anti-perte

### Ne jamais faire

``` text
PC TextChanged
    ↓
GET ENTIRE FIELD
    ↓
replace phone editor
```

Cela pourrait détruire du texte en cours, remplacer une composition IME,
provoquer des sauts de curseur et transférer plusieurs mégaoctets.

### Faire

Maintenir un modèle de session :

``` text
Session {
    focused_control
    selected_text
    local_buffer
    local_cursor
    local_selection
    pending_operations[]
    generation
}
```

Toute modification locale possède un `op_id`.

``` json
{
  "type": "text.insert",
  "op_id": 1842,
  "text": "bonjour"
}
```

Accusé :

``` json
{
  "type": "text.ack",
  "op_id": 1842
}
```

------------------------------------------------------------------------

## 3. Fin de session

Le buffer mobile est conservé tant que le contexte PC reste le même.

Réinitialisation uniquement lorsque :

1.  le contrôle texte actif change ;
2.  l'utilisateur fait une nouvelle sélection sur le PC ;
3.  la session est explicitement fermée ;
4.  une divergence ne peut pas être réconciliée de façon sûre.

Une simple notification `TextChanged` ne doit pas automatiquement
réinitialiser l'éditeur.

------------------------------------------------------------------------

## 4. Nouvelle sélection PC

Exemple :

``` text
PC:
"Le chat est très long..."

User selects:
"très long"
```

Le serveur envoie :

``` json
{
  "type": "text.selection",
  "text": "très long",
  "revision": 52
}
```

Le téléphone remplace alors volontairement le contenu de l'éditeur par
`très long`.

------------------------------------------------------------------------

## 5. Détection du contrôle actif

Le serveur Windows doit suivre :

-   fenêtre active ;
-   contrôle ayant le focus ;
-   support du TextPattern ;
-   sélection ;
-   position du caret lorsque disponible ;
-   événements de changement de texte/sélection/focus.

Windows UI Automation fournit `TextPattern`/`TextRange` ainsi que des
événements `TextChanged` pour les contrôles qui les exposent.

Prévoir des capacités détectées :

``` text
FOCUS
SELECTION
READ_TEXT
TEXT_CHANGED
CARET
EDIT
```

Tous les logiciels Windows ne fournissent pas les mêmes capacités.

------------------------------------------------------------------------

## 6. Architecture

``` text
┌────────────────────────────────────────────┐
│                 WINDOWS PC                 │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │ Local server                         │  │
│  │                                      │  │
│  │ HTTP server                          │  │
│  │ WebSocket server                     │  │
│  │ Session manager                      │  │
│  │ UI Automation watcher                │  │
│  │ Input injector                       │  │
│  │ Mouse controller                     │  │
│  └───────────────┬──────────────────────┘  │
└──────────────────┼────────────────────────┘
                   │ LAN
                   ▼
┌────────────────────────────────────────────┐
│                 ANDROID                    │
│                                            │
│  Browser / PWA shortcut                    │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │ Text editor + native Android IME     │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  Special-key bar                           │
│  Trackpad                                  │
│  Mouse buttons                             │
└────────────────────────────────────────────┘
```

------------------------------------------------------------------------

## 7. Stack recommandée

### Windows server

**Rust** :

-   `tokio`
-   `axum`
-   `serde`
-   `serde_json`
-   `windows`
-   `tracing`
-   `thiserror`
-   `uuid`

Pourquoi Rust : binaire unique, faible consommation, bon support
Windows/COM/Win32 et bon modèle de concurrence.

### HTTP/WebSocket

`axum` + Tokio.

Routes :

``` text
GET /
GET /assets/*
GET /ws
```

Le navigateur ouvre :

``` text
http://PC:PORT/
```

puis :

``` text
ws://PC:PORT/ws
```

WebSocket est adapté à la communication bidirectionnelle temps réel et
est largement supporté par les navigateurs modernes. L'API WebSocket
classique n'offre toutefois pas de backpressure ; les messages doivent
donc rester petits et les files d'attente doivent être surveillées.

### Frontend

Commencer avec :

-   TypeScript
-   Vite
-   HTML/CSS

Pas de framework obligatoire.

Optionnel :

``` text
vite-plugin-pwa
```

------------------------------------------------------------------------

## 8. Éditeur mobile

Ne pas recréer le clavier Android.

Commencer avec :

``` html
<textarea id="editor"></textarea>
```

Le clavier Android natif doit pouvoir gérer :

-   accents ;
-   autocorrection ;
-   prédiction ;
-   emoji ;
-   langues ;
-   composition IME.

Passer à `contenteditable` uniquement si les besoins l'exigent.

------------------------------------------------------------------------

## 9. Modèle de synchronisation

Types de messages :

``` text
text.session.open
text.session.close
text.snapshot
text.selection
text.insert
text.delete
text.replace
text.cursor
text.ack
text.resync
```

Insertion :

``` json
{
  "type": "text.insert",
  "session": "abc123",
  "op_id": 1004,
  "position": 15,
  "text": "bonjour"
}
```

Suppression :

``` json
{
  "type": "text.delete",
  "session": "abc123",
  "op_id": 1005,
  "position": 10,
  "length": 5
}
```

Remplacement :

``` json
{
  "type": "text.replace",
  "session": "abc123",
  "op_id": 1006,
  "start": 10,
  "end": 20,
  "text": "nouveau"
}
```

------------------------------------------------------------------------

## 10. Composition IME

Le frontend doit distinguer :

``` text
compositionstart
compositionupdate
compositionend
```

d'une insertion définitive.

Ne pas envoyer chaque état de composition comme une suite de touches
Windows indépendantes.

Le serveur doit pouvoir recevoir une composition puis une insertion
finale.

------------------------------------------------------------------------

## 11. Injection clavier Windows

Utiliser `SendInput`.

Windows documente `SendInput` comme l'API permettant de synthétiser des
événements clavier et souris dans le flux d'entrée Windows.

Mapping de base :

``` text
Ctrl       VK_CONTROL
Shift      VK_SHIFT
Alt        VK_MENU
Win        VK_LWIN / VK_RWIN

Tab        VK_TAB
Escape     VK_ESCAPE
Enter      VK_RETURN
Backspace  VK_BACK
Delete     VK_DELETE

Insert     VK_INSERT
Home       VK_HOME
End        VK_END
PageUp     VK_PRIOR
PageDown   VK_NEXT

Left       VK_LEFT
Right      VK_RIGHT
Up         VK_UP
Down       VK_DOWN

F1..F24
```

### AltGr

Ne pas traiter AltGr comme du simple texte. Le comportement dépend du
layout Windows. Tester explicitement avec AZERTY français.

### Fn

`Fn` n'est généralement pas une touche Windows virtuelle classique. La
traiter comme une touche virtuelle **interne à l'application**.

Exemple :

``` text
Fn + F1
Fn + ←
Fn + →
```

peuvent être configurables.

------------------------------------------------------------------------

## 12. Combinaisons sticky

### Normal

``` text
tap Ctrl
tap C
```

Produit :

``` text
Ctrl+C
```

### Sticky

``` text
tap Ctrl
```

Ctrl devient `armed`.

Puis :

``` text
tap C
```

Produit Ctrl+C et désarme Ctrl.

### Lock

Double tap :

``` text
Ctrl → locked
```

Nouveau tap :

``` text
Ctrl → unlocked
```

------------------------------------------------------------------------

## 13. Barre de touches

Deux lignes visibles par défaut :

``` text
[Esc] [Tab] [Ctrl] [Shift] [Alt] [Win] [←] [↑] [↓] [→]

[Fn] [AltGr] [Home] [End] [Del] [PgUp] [PgDn] [Ins]
```

La deuxième ligne est extensible.

Groupes :

``` text
Navigation
F1–F12
Editing
Media
System
Custom
```

Navigation horizontale ou pages.

------------------------------------------------------------------------

## 14. Trackpad

``` text
┌─────────────────────────────────┐
│                                 │
│             TRACKPAD            │
│                                 │
└─────────────────────────────────┘

       [ L ] [ M ] [ R ]
```

Gestes :

``` text
1 doigt       → mouvement souris
tap           → clic gauche
double tap    → double clic
long press    → drag

2 doigts      → scroll
2-finger tap  → clic droit
3-finger tap  → clic milieu
```

------------------------------------------------------------------------

## 15. Protocole souris

``` json
{
  "type": "mouse.move",
  "dx": 12,
  "dy": -4
}
```

``` json
{
  "type": "mouse.button",
  "button": "middle",
  "action": "down"
}
```

``` json
{
  "type": "mouse.button",
  "button": "middle",
  "action": "up"
}
```

``` json
{
  "type": "mouse.scroll",
  "dx": 0,
  "dy": -4
}
```

Regrouper les mouvements rapides pour éviter de saturer le WebSocket.

------------------------------------------------------------------------

## 16. Sécurité

Par défaut :

``` text
LAN only
```

Ne jamais exposer le serveur directement sur Internet.

Prévoir un pairing initial :

``` text
QR code / code court
        ↓
random token
        ↓
WebSocket authentifié
```

Le téléphone mémorise le token.

------------------------------------------------------------------------

## 17. Découverte

Premier appairage :

``` text
QR code
```

Ensuite :

-   mDNS/Bonjour ;
-   mémorisation du dernier endpoint ;
-   reconnexion automatique.

Exemple :

``` text
PC-DE-BUREAU.local
```

------------------------------------------------------------------------

## 18. Cycle de vie

``` text
NORMAL
  │
  │ tap Keyboard
  ▼
OPENING
  │
  ├── focused text control + selection
  │
  ▼
EDITING
  │
  ├── no selection
  │      └── local session buffer
  │
  └── selection
         └── selected text snapshot
```

À la fermeture :

``` text
EDITING → NORMAL
```

Ne pas supprimer immédiatement le buffer si cela risque de provoquer une
perte visible.

------------------------------------------------------------------------

## 19. Très gros textes

Règle stricte :

> Ne jamais synchroniser le contenu complet d'un champ uniquement parce
> qu'il reçoit le focus.

Pour une sélection :

``` text
MAX_SELECTION_SIZE = 1 MiB
```

Au-delà :

``` text
Selection too large.

[Use anyway]
[Cancel]
```

Pour un champ sans sélection :

``` text
NEVER snapshot entire field
```

------------------------------------------------------------------------

## 20. Divergences

Si :

``` text
Phone:
bonjour

PC:
bonsoir
```

ne jamais écraser silencieusement.

Afficher :

``` text
⚠ Text changed on PC

[Keep phone text]
[Use PC text]
[Compare]
```

Pour le MVP, un bouton `Resync` est acceptable.

------------------------------------------------------------------------

## 21. Permissions / privilèges

`SendInput` est soumis à UIPI. Un processus normal ne peut pas injecter
librement dans une application de niveau d'intégrité supérieur.

Ne pas demander de privilèges administrateur par défaut.

Documenter le comportement avec les applications élevées.

------------------------------------------------------------------------

## 22. Structure de projet

``` text
phone-text-remote/
│
├── server/
│   ├── src/
│   │   ├── main.rs
│   │   ├── http.rs
│   │   ├── websocket.rs
│   │   ├── protocol.rs
│   │   ├── session.rs
│   │   ├── text/
│   │   │   ├── mod.rs
│   │   │   ├── uia.rs
│   │   │   ├── selection.rs
│   │   │   └── reconcile.rs
│   │   ├── input/
│   │   │   ├── keyboard.rs
│   │   │   ├── mouse.rs
│   │   │   └── keymap.rs
│   │   └── discovery.rs
│   └── Cargo.toml
│
├── web/
│   ├── src/
│   │   ├── main.ts
│   │   ├── ws.ts
│   │   ├── state.ts
│   │   ├── editor.ts
│   │   ├── keyboard.ts
│   │   ├── special-keys.ts
│   │   ├── trackpad.ts
│   │   └── settings.ts
│   ├── index.html
│   └── package.json
│
├── protocol/
│   └── protocol.md
│
└── README.md
```

------------------------------------------------------------------------

## 23. Dépendances initiales

### Rust

``` toml
[dependencies]
tokio = { version = "1", features = ["full"] }
axum = { version = "0.8", features = ["ws"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
windows = "0.62"
tracing = "0.1"
tracing-subscriber = "0.3"
thiserror = "2"
uuid = { version = "1", features = ["v4", "serde"] }
```

À ajouter uniquement si nécessaire :

``` text
tower-http
qrcode
mdns-sd
```

### Frontend

``` json
{
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5",
    "vite": "^7"
  }
}
```

Optionnel :

``` text
vite-plugin-pwa
```

------------------------------------------------------------------------

## 24. PWA

La webapp doit pouvoir être installée depuis Chrome :

``` text
Chrome
→ Add to Home Screen
```

Pas d'APK obligatoire.

Le mode standalone est souhaitable.

------------------------------------------------------------------------

## 25. Priorités

### Phase 1 --- connexion

-   [ ] HTTP
-   [ ] WebSocket
-   [ ] page mobile
-   [ ] pairing token
-   [ ] reconnexion
-   [ ] LAN only

### Phase 2 --- souris

-   [ ] mouvement
-   [ ] gauche
-   [ ] milieu
-   [ ] droite
-   [ ] scroll
-   [ ] drag

### Phase 3 --- touches

-   [ ] Ctrl
-   [ ] Shift
-   [ ] Alt
-   [ ] Win
-   [ ] Tab
-   [ ] Escape
-   [ ] arrows
-   [ ] Home/End
-   [ ] Delete
-   [ ] Insert
-   [ ] PageUp/PageDown
-   [ ] F1--F12
-   [ ] sticky modifiers

### Phase 4 --- texte

-   [ ] keyboard session
-   [ ] focused text control
-   [ ] selection retrieval
-   [ ] selected-text snapshot
-   [ ] local editor
-   [ ] IME composition
-   [ ] insertion
-   [ ] deletion
-   [ ] acknowledgements
-   [ ] selection changes
-   [ ] divergence detection

### Phase 5 --- UX

-   [ ] configurable key rows
-   [ ] settings menu
-   [ ] haptics
-   [ ] PWA
-   [ ] auto reconnect
-   [ ] mDNS
-   [ ] persistent pairing

### Phase 6 --- robustesse

-   [ ] Chrome/Edge
-   [ ] Notepad
-   [ ] VS Code
-   [ ] Word
-   [ ] Discord
-   [ ] browser address bar
-   [ ] large selections
-   [ ] elevated applications
-   [ ] French AZERTY
-   [ ] AltGr
-   [ ] Unicode
-   [ ] emoji
-   [ ] IME composition

------------------------------------------------------------------------

## 26. Tests critiques

### A --- typing

``` text
Notepad
Keyboard open
Type "Bonjour éàç"
```

Attendu : texte exact sur PC et téléphone.

### B --- champ énorme

``` text
2 MB document
Caret only
Keyboard open
```

Attendu : aucun transfert complet.

### C --- sélection

``` text
Select "hello"
Open keyboard
```

Attendu : seul `hello` est transféré.

### D --- remplacement

``` text
Phone receives "hello"
User changes it to "bonjour"
```

Attendu : la sélection PC devient `bonjour`.

### E --- modification externe

``` text
Phone session active
PC changes text independently
```

Attendu : pas de destruction silencieuse du buffer mobile.

### F --- changement de champ

``` text
Editing field A
PC focuses field B
```

Attendu : session A terminée proprement.

### G --- raccourcis

``` text
Ctrl+C
Ctrl+Shift+Esc
Win+R
Alt+Tab
AltGr+E
```

### H --- clic milieu

``` text
Browser
3-finger tap
```

Attendu : nouvelle action d'onglet selon le navigateur.

------------------------------------------------------------------------

## 27. MVP

Le MVP est réussi lorsque :

``` text
1. Le serveur Windows démarre automatiquement.

2. La webapp est ouverte sur Android.

3. La connexion est automatique après le premier pairing.

4. Le téléphone fonctionne comme trackpad.

5. L'utilisateur ouvre un champ texte.

6. Il appuie sur Keyboard.

7. Si une sélection existe :
      seul le texte sélectionné apparaît dans l'éditeur.

8. Sans sélection :
      l'éditeur démarre vide.

9. Gboard permet la saisie normale.

10. Le texte apparaît sur le PC en temps réel.

11. Le texte reste visible sur le téléphone.

12. Ctrl / Shift / Alt / Win / Tab / Esc fonctionnent.

13. Le clic milieu fonctionne.

14. Une nouvelle sélection PC remplace volontairement
    le contenu de la session mobile.

15. Un changement de champ ferme proprement l'ancienne session.

16. Aucun texte n'est perdu silencieusement.
```

------------------------------------------------------------------------

## 28. Principe architectural

> **A remote editing session layered on top of a remote input device.**

Ce n'est pas un remote desktop avec un clavier.

Le téléphone est responsable de **ce que l'utilisateur compose
actuellement**.

Windows reste responsable de **l'état réel de l'application et du
document**.

La synchronisation entre les deux est volontaire, événementielle et
sélective.
