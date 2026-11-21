# YouTube → ChatGPT

Userscript que añade un botón **ChatGPT ↗** a las tarjetas de vídeo de YouTube y a la barra de acciones del vídeo abierto. Al pulsarlo, reproduce el vídeo en una pestaña silenciada y abre ChatGPT con el texto `Resume URL_DEL_VIDEO` en el parámetro `q`. Con el complemento incluido, ambas pestañas se abren dentro de un **grupo nuevo con el título del vídeo**.

## Instalación

Necesitas Tampermonkey o Violentmonkey.

**[Instalar o actualizar el userscript](https://raw.githubusercontent.com/alexx-ftw/youtube-chatgpt/main/youtube-chatgpt.user.js)**

1. Abre el enlace de instalación y confirma la instalación o actualización en tu gestor de userscripts.
2. Recarga YouTube.
3. Pulsa **ChatGPT ↗** junto a los datos de una tarjeta o en la barra de acciones del vídeo abierto, junto a **Compartir**.

La versión 1.1.0 añade los permisos `GM_openInTab` y `GM_audio`; si el gestor solicita confirmar esos permisos al actualizar, acepta para habilitar la apertura y el silenciado de las pestañas.

Si el navegador muestra el código, cópialo en un script nuevo de tu gestor y guárdalo. También puedes usar la [copia en texto (.txt)](https://raw.githubusercontent.com/alexx-ftw/youtube-chatgpt/main/youtube-chatgpt.txt), con el mismo contenido y las mismas direcciones de actualización automática.

## Abrir las dos pestañas dentro de un grupo

La agrupación nativa requiere el complemento de la carpeta [`extension`](extension). Tampermonkey y Violentmonkey pueden abrir pestañas, pero no ofrecen una API para crear grupos.

Instalación del complemento en Chrome, Brave o Edge compatibles:

1. [Descarga el ZIP específico del complemento 1.1.0](https://raw.githubusercontent.com/alexx-ftw/youtube-chatgpt/main/dist/youtube-chatgpt-grupos-1.1.0.zip) y extrae los archivos en una carpeta que vayas a conservar.
2. Abre la página de extensiones de tu navegador (`chrome://extensions`, `brave://extensions` o `edge://extensions`) y activa **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida** y selecciona la carpeta que contiene directamente `manifest.json` y los archivos JavaScript del complemento.
4. Actualiza el userscript a la versión **1.3.0** o posterior y recarga YouTube.

Selecciona la carpeta extraída, no el archivo ZIP ni una carpeta superior. Si aparece **Manifest file is missing or unreadable**, abre la carpeta elegida y comprueba que `manifest.json` está directamente dentro. El paquete específico coloca todos sus archivos en la raíz. El ZIP completo del repositorio también incluye un manifiesto en su carpeta principal.

Al activar el botón, el complemento crea un grupo nuevo en la misma ventana con únicamente la pestaña del vídeo y la de ChatGPT. Usa el título del vídeo como nombre del grupo y silencia la pestaña de YouTube antes de cargarla. **Con un clic normal, muestra primero el vídeo y pasa a ChatGPT cuando comprueba que el vídeo está avanzando.** ChatGPT carga mientras tanto. Si seleccionas otra pestaña durante el arranque, el complemento deja de cambiar el foco por su cuenta.

Ctrl/Cmd + clic y clic central mantienen ambas pestañas en segundo plano. También intentan iniciar el vídeo silenciado; si el navegador bloquea la reproducción de pestañas ocultas, tendrás que activar la pestaña del vídeo. Si el arranque no se confirma en 90 segundos, se muestra un aviso para pulsar Reproducir.

El complemento solo se ejecuta en YouTube y utiliza los permisos `tabGroups` y `storage`. Guarda temporalmente en `storage.session` qué dos pestañas pertenecen al arranque, para conservar esa relación si el navegador suspende el proceso del complemento. No necesita el permiso general de lectura de todas las pestañas ni ejecuta código descargado. Solo atiende una solicitud después de una activación real del botón.

El userscript conserva sus actualizaciones automáticas. La copia del complemento cargada como extensión descomprimida se actualiza sustituyendo sus archivos y pulsando **Recargar** en la página de extensiones. Si el complemento no está instalado, el botón conserva la apertura de las dos pestañas sin agrupar.

Para actualizar desde el complemento 1.0.1, extrae el ZIP nuevo sobre la misma carpeta, pulsa **Recargar** y recarga YouTube. Conserva una sola copia del complemento instalada.

## Funcionamiento

- Abre `https://chatgpt.com/?q=Resume%20URL_DEL_VIDEO`, con todo el texto codificado correctamente.
- Envía como valor de `q` el texto `Resume https://www.youtube.com/watch?v=ID`, usando la URL canónica del vídeo.
- Abre también la página normal del vídeo. Con el complemento, un clic normal inicia el vídeo en primer plano y selecciona ChatGPT al confirmar reproducción; sin complemento, conserva la apertura del vídeo en segundo plano. Con Ctrl/Cmd + clic o clic central, ambas pestañas se abren en segundo plano.
- Con el complemento instalado, cada activación crea un grupo nuevo para el vídeo y su resumen. La pestaña de origen permanece donde estaba.
- Llama a `video.play()` cuando está disponible el reproductor principal. Comprueba que el tiempo avanza, sin confundir una promesa resuelta, un salto de posición o un anuncio con el vídeo solicitado.
- Reintenta el arranque durante un plazo limitado mientras YouTube carga o reemplaza el reproductor. Deja de intervenir al confirmar reproducción, navegar a otro vídeo o detectar una acción manual sobre los controles; no vuelve a reproducir un vídeo que pauses después.
- Silencia la nueva pestaña mediante `GM_audio` cuando el gestor ofrece esa API. Puedes volver a activar el sonido desde el menú de la pestaña del navegador.
- Si no existe esa API o falla, silencia el reproductor. En ese caso puedes activar el sonido con el control de volumen de YouTube o la tecla **M**; el script deja de imponer el silencio al usar esos controles o al navegar a otro vídeo.
- Si el navegador exige que el propio reproductor esté silenciado para permitir autoplay, también lo silencia antes de reintentar. En ese caso, para oírlo tendrás que activar el sonido del reproductor y de la pestaña.
- Las marcas de silenciado y arranque se consumen al abrir el vídeo y se retiran de la URL. El texto enviado a ChatGPT utiliza siempre la URL limpia.
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

1. Modifica `youtube-chatgpt.user.js`; el controlador de reproducción compartido se edita en `extension/playback.js`.
2. Aumenta `@version`.
3. Ejecuta `python3 scripts/sync_userscript.py` para incrustar el controlador y sincronizar `youtube-chatgpt.txt`.
4. Publica el cambio en `main`.

Documentación: [Tampermonkey](https://www.tampermonkey.net/documentation.php#meta:updateURL) · [GM_audio](https://www.tampermonkey.net/documentation.php?locale=en&q=GM_audio) · [Violentmonkey](https://violentmonkey.github.io/api/metadata-block/) · [Grupos nativos](https://developer.chrome.com/docs/extensions/reference/api/tabGroups) · [Autoplay en Chrome](https://developer.chrome.com/blog/autoplay) · [HTMLMediaElement.play](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play)

## Verificación del complemento

Para regenerar el paquete dedicado y el manifiesto de la raíz del repositorio:

```sh
python3 scripts/sync_userscript.py
python3 scripts/package_extension.py
```

Con Node.js, sin dependencias adicionales:

```sh
node --test tests/*.test.mjs
```

Las pruebas verifican los mensajes, la autorización por clic, el orden de silenciado y navegación, la agrupación, el arranque del reproductor, los cambios de foco y los casos de error con DOM, multimedia y APIs simuladas. No sustituyen una prueba de la extensión instalada en un navegador real.

## Historial

### 1.3.0 / complemento 1.1.0: reproducción

- Arranque explícito del reproductor mediante `play()`, con comprobación de avance y silencio antes del intento.
- Con el complemento y un clic normal, se muestra el vídeo hasta confirmar reproducción y después se selecciona ChatGPT.
- Respeta las pausas manuales, los clics en segundo plano y la selección de otra pestaña durante el arranque.
- Controlador de reproducción compartido entre userscript y complemento; no confunde anuncios ni saltos de posición con reproducción confirmada.
- Mantiene la instalación del complemento con `manifest.json` en la raíz del ZIP.

### Complemento 1.0.1: instalación

- ZIP dedicado con `manifest.json` y todos los archivos del complemento directamente en la raíz.
- Manifiesto adicional en la raíz del repositorio para poder cargar también la carpeta del ZIP completo de GitHub.
- Empaquetado reproducible e instrucciones que identifican la carpeta que debe seleccionarse.

### 1.2.0

- Complemento de navegador para abrir el vídeo y ChatGPT dentro de un grupo nativo nuevo, con el título del vídeo.
- La apertura agrupada silencia la pestaña de YouTube antes de navegar a ella.
- Integración con el userscript sin IDs de extensión fijos; mantiene la apertura anterior si el complemento no está instalado.

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


