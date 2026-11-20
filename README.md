# FFmpeg Web Converter

## Prérequis
- Node.js 18 ou plus récent
- FFmpeg installé et accessible dans le PATH

## Ubuntu / Debian
```bash
sudo apt update
sudo apt install ffmpeg
```

## Windows
Installe FFmpeg et ajoute son dossier `bin` au PATH. Vérifie dans un terminal :
```powershell
ffmpeg -version
node --version
```

## Démarrer
Dans le dossier du projet :
```bash
npm start
```
Puis ouvre http://127.0.0.1:3000

Aucune dépendance npm externe n'est nécessaire.

Les MP4 générés sont enregistrés dans `downloads/`.
Le serveur écoute uniquement sur 127.0.0.1 : il n'est pas exposé sur le réseau.
Utilise uniquement des flux que tu es autorisé à télécharger. Aucun contournement DRM n'est fourni.
# ffmpeg-web-server
