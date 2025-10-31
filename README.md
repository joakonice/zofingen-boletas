# Extractor de Boletas (ZOFINGEN)

App web estática (compatible con GitHub Pages) que permite subir PDFs de boletas ZOFINGEN y descargar CSV/XLSX con los datos extraídos.

## Uso local
1. Abrí `index.html` en tu navegador (doble click) o serví la carpeta con cualquier servidor estático.
2. Seleccioná uno o varios PDF y presioná "Procesar".
3. Descargá `boletas.csv` o `boletas.xlsx`.

## Publicar en GitHub Pages
Este repositorio ya incluye un workflow para desplegar en Pages.

### Pasos
1. Crear repo en GitHub (por ejemplo `zofingen-boletas`).
2. En PowerShell dentro de esta carpeta:
```powershell
git init
git add .
git commit -m "feat: app web extractor ZOFINGEN"
git branch -M main
git remote add origin https://github.com/<tu-usuario>/zofingen-boletas.git
git push -u origin main
```
3. En GitHub → Settings → Pages verificá que el Source sea "GitHub Actions".
4. El workflow `.github/workflows/pages.yml` publicará automáticamente en unos minutos.

## Estructura
- `index.html`, `styles.css`, `app.js`: app web (frontend puro)
- `input-examples/`: PDFs de ejemplo (no necesarios para producción)
- `.github/workflows/pages.yml`: deploy a GitHub Pages
- `.nojekyll`: desactiva Jekyll en Pages
- `extract_boletas.py`: script original en Python (opcional)

## Extensibilidad
El archivo `app.js` define un parser `ZOFINGEN`. Para sumar otras financieras, agregá un nuevo parser y sumalo al selector en `index.html`.
