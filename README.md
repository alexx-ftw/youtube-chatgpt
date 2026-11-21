# YouTube → ChatGPT

Userscript que añade un botón **ChatGPT ↗** a las tarjetas de vídeo de YouTube y a la barra de acciones del vídeo abierto. Al pulsarlo, abre ChatGPT con el texto `Resume URL_DEL_VIDEO` en el parámetro `q` y el vídeo en otra pestaña silenciada.

## Instalación

Necesitas Tampermonkey o Violentmonkey.

**[Instalar o actualizar el userscript](https://raw.githubusercontent.com/alexx-ftw/youtube-chatgpt/main/youtube-chatgpt.user.js)**

1. Abre el enlace de instalación y confirma la instalación o actualización en tu gestor de userscripts.
2. Recarga YouTube.
3. Pulsa **ChatGPT ↗** junto a los datos de una tarjeta o en la barra de acciones del vídeo abierto, junto a **Compartir**.

La versión 1.1.0 añade los permisos `GM_openInTab` y `GM_audio`; si el gestor solicita confirmar esos permisos al actualizar, acepta para habilitar la apertura y el silenciado de las pestañas.

Si el navegador muestra el código, cópialo en un script nuevo de tu gestor y guárdalo. También puedes usar la [copia en texto (.txt)](https://raw.githubusercontent.com/alexx-ftw/youtube-chatgpt/main/youtube-chatgpt.txt), con el mismo contenido y las mismas direcciones de actualización automática.

## Funcionamiento

- Abre `https://chatgpt.com/?q=Resume%20URL_DEL_VIDEO`, con todo el texto codificado correctamente.
- Envía como valor de `q` el texto `Resume https://www.youtube.com/watch?v=ID`, usando la URL canónica del vídeo.
- Abre también la página normal del vídeo en una pestaña de YouTube en segundo plano. ChatGPT queda seleccionado; con Ctrl/Cmd + clic o clic central, ambas pestañas se abren en segundo plano.
- Silencia la nueva pestaña mediante `GM_audio` cuando el gestor ofrece esa API. Puedes volver a activar el sonido desde el menú de la pestaña del navegador.
- Si no existe esa API o falla, silencia el reproductor. En ese caso puedes activar el sonido con el control de volumen de YouTube o la tecla **M**; el script deja de imponer el silencio al usar esos controles o al navegar a otro vídeo.
- La marca de silenciado se consume al abrir el vídeo y se retira de la URL. El texto enviado a ChatGPT utiliza siempre la URL limpia.
- Añade el botón a las tarjetas `ytd-rich-item-renderer` y a los `yt-lockup-view-model` independientes, incluidas las recomendaciones horizontales y compactas.
- Sitúa el botón compacto en la misma fila que los metadatos y conserva todo el ancho del título.
- En la página del vídeo, añade la acción a la misma barra que **Me gusta** y **Compartir**.
- Mantiene la barra de acciones en una sola fila, también con el botón de copiar transcripción. Si los controles no caben, permite desplazarlos horizontalmente.
- Usa la URL de cada tarjeta para sus botones y la URL actual de la página para la acción del vídeo abierto.
- Detecta los vídeos que se cargan al hacer scroll, las tarjetas reutilizadas y la navegación interna de YouTube.
- Evita duplicar el botón cuando un lockup está dentro de una tarjeta rich o cuando YouTube reconstruye la barra de acciones.
- Toma los colores del tema de YouTube. El menú contextual y «Copiar enlace» conservan el enlace directo a ChatGPT; la apertura de ambas pestañas ocurre al activar el botón con clic, clic central o teclado.

## Actualizaciones automáticas

La versión publicada incluye `@updateURL` y `@downloadURL` apuntando al archivo de la rama `main`. El gestor comprueba las actualizaciones según su configuración y utiliza `@version` para detectar las nuevas versiones.

Si instalaste la versión `1.0.0` pegando el código, instala una vez desde el enlace de arriba para incorporar las direcciones de actualización. El nombre y el namespace se conservan para que el gestor pueda reconocer el script existente.

Para publicar una actualización:

1. Modifica `youtube-chatgpt.user.js` y sincroniza la copia `youtube-chatgpt.txt`.
2. Aumenta `@version`.
3. Publica el cambio en `main`.

Documentación: [Tampermonkey](https://www.tampermonkey.net/documentation.php#meta:updateURL) · [GM_audio](https://www.tampermonkey.net/documentation.php?locale=en&q=GM_audio) · [Violentmonkey](https://violentmonkey.github.io/api/metadata-block/)

## Historial

### 1.1.0

- Abre el vídeo en una pestaña adicional silenciada y en segundo plano al abrir ChatGPT.
- Silenciado nativo de la pestaña en gestores compatibles y alternativa mediante el reproductor de YouTube.
- Arranque del silenciado en `document-start`; los botones esperan a que el DOM esté disponible.
- Respeta la activación manual del sonido y evita duplicar aperturas entre eventos de ratón.

### 1.0.5

- Evita que el botón de copiar transcripción baje a una segunda fila al añadir ChatGPT a la barra de acciones.
- Mantiene todos los controles accesibles mediante desplazamiento horizontal cuando falta espacio.
- Aplica el ajuste únicamente a la barra que contiene el botón de ChatGPT.

### 1.0.4

- Soporte para tarjetas horizontales y compactas `yt-lockup-view-model` que no están dentro de un `ytd-rich-item-renderer`.
- Botón en la barra de acciones del vídeo abierto, junto a **Compartir**.
- Actualización de la URL al cambiar de vídeo mediante la navegación interna o el historial.
- Un solo botón por tarjeta y por barra de acciones.

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


