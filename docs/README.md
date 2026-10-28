# TollAI - GitHub Pages

Esta es la página de documentación de TollAI desplegada en GitHub Pages.

## Despliegue

Para publicar en GitHub Pages:

1. Ve a Settings > Pages en tu repositorio
2. Source: Deploy from a branch
3. Branch: main / master, folder: /docs
4. Guardar

La página estará disponible en: `https://[usuario].github.io/[repositorio]/`

## Desarrollo

Para probar localmente:
```bash
python3 -m http.server 8000 -d docs
# o
npx serve docs
```

## Características

- Diseño responsive oscuro
- Protección con TollAI integrada
- Documentación interactiva
- Diagrama de arquitectura
