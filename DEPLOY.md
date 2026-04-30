# Deploying the Cookbook PWA

GitHub Pages is the simplest free host for this app because it serves plain static files over HTTPS.

## GitHub Pages

1. Create a GitHub repository for this folder.
2. Commit and push all files, including `.nojekyll`, `index.html`, `script.js`, `styles.css`, `manifest.json`, `service-worker.js`, and the icon files.
3. In GitHub, open the repository settings.
4. Go to Pages.
5. Set the source to deploy from the `main` branch and the repository root.
6. Open the generated `https://<username>.github.io/<repo-name>/` URL.
7. On the phone, open that HTTPS URL once while online, then install it from the browser share/menu options.

The app stores cookbook data locally in the browser with IndexedDB. Deploying updates the app shell, but it does not sync recipe data between devices.
