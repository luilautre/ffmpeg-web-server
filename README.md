# FFmpeg Web Converter

Application Vite statique : Vercel héberge l'interface et FFmpeg.wasm convertit directement dans le navigateur. Aucun serveur Node permanent ni processus FFmpeg côté Vercel.

## Déploiement
Vercel : commande `npm run build`, dossier de sortie `dist`.

## Fonctions
- Convertit les fichiers locaux en MP4.
- Accepte les URL vidéo et les playlists HLS MPEG-TS.
- Remux sans réencodage lorsque les codecs sont compatibles.

## Limites
- Les URL distantes doivent autoriser CORS depuis le domaine du site.
- HLS chiffré/DRM et HLS fMP4 ne sont pas pris en charge.
- Traitement en mémoire : les gros fichiers peuvent dépasser les limites du navigateur.
- Le moteur FFmpeg (~30 Mo) est chargé depuis jsDelivr au premier lancement.

Utilise uniquement des contenus que tu es autorisé à télécharger.
