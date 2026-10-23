# YouTube → ChatGPT

Userscript que añade un botón **ChatGPT ↗** a las tarjetas de vídeo de YouTube. Al pulsarlo, abre una nueva pestaña de ChatGPT con el texto `Resume URL_DEL_VIDEO` en el parámetro `q`.

## Instalación

Necesitas Tampermonkey o Violentmonkey.

**[Instalar o actualizar el userscript](https://raw.githubusercontent.com/alexx-ftw/youtube-chatgpt/main/youtube-chatgpt.user.js)**

1. Abre el enlace de instalación y confirma la instalación o actualización en tu gestor de userscripts.
2. Recarga YouTube.
3. Pulsa **ChatGPT ↗** a la derecha de los datos del vídeo, en la misma fila.

Si el navegador muestra el código, cópialo en un script nuevo de tu gestor y guárdalo.

## Funcionamiento

- Abre `https://chatgpt.com/?q=Resume%20URL_DEL_VIDEO`, con todo el texto codificado correctamente.
- Envía como valor de `q` el texto `Resume https://www.youtube.com/watch?v=ID`, usando la URL canónica del vídeo.
- Añade el botón a las tarjetas `ytd-rich-item-renderer` con el diseño moderno de YouTube y algunos diseños anteriores.
- Sitúa el botón compacto en la misma fila que los metadatos y conserva todo el ancho del título.
- Detecta los vídeos que se cargan al hacer scroll, las tarjetas reutilizadas y la navegación interna de YouTube.
- Toma los colores del tema de YouTube y mantiene el comportamiento habitual de los enlaces al abrir pestañas.

## Actualizaciones automáticas

La versión publicada incluye `@updateURL` y `@downloadURL` apuntando al archivo de la rama `main`. El gestor comprueba las actualizaciones según su configuración y utiliza `@version` para detectar las nuevas versiones.

Si instalaste la versión `1.0.0` pegando el código, instala una vez desde el enlace de arriba para incorporar las direcciones de actualización. El nombre y el namespace se conservan para que el gestor pueda reconocer el script existente.

Para publicar una actualización:

1. Modifica `youtube-chatgpt.user.js`.
2. Aumenta `@version`.
3. Publica el cambio en `main`.

Documentación: [Tampermonkey](https://www.tampermonkey.net/documentation.php#meta:updateURL) · [Violentmonkey](https://violentmonkey.github.io/api/metadata-block/)

## Historial

### 1.0.3

- Añade `Resume ` delante de la URL del vídeo al abrir ChatGPT.
- Actualiza el texto de ayuda del botón para indicar que solicita un resumen.

### 1.0.2

- Botón compacto junto a los metadatos del vídeo, sin una fila adicional para el botón.
- El título conserva todo su ancho y las tarjetas reutilizadas recuperan su diseño original cuando el botón deja de corresponder.

### 1.0.1

- Publicación en GitHub.
- Direcciones de instalación y actualización automática.
- Enlaces al repositorio y a incidencias.

### 1.0.0

- Versión inicial: botón en las tarjetas y apertura de ChatGPT con la URL del vídeo.
