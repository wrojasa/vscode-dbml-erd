# Port a Visual Studio Code — análisis base

Fecha: 2026-11-10. Estado: análisis, sin código. Base analizada: plugin de Obsidian "DBML ER Diagrams" versión 0.3.0 (commit `3e98d7b`).

Este documento es el punto de partida para una sesión nueva que construya la extensión de VS Code a partir de una copia de este repositorio. Describe qué hace el plugin, qué partes del código se reutilizan sin cambios, dónde está acoplado a Obsidian, cómo se mapea cada pieza a la API de VS Code y una estructura propuesta para el proyecto nuevo. Las decisiones marcadas como pendientes las toma quien construya la extensión.

## 1. Qué hace el plugin hoy

El plugin renderiza bloques ```` ```dbml ```` dentro de notas Markdown como diagramas entidad-relación interactivos en SVG. El bloque de texto es la única fuente de verdad: toda edición hecha desde el diagrama se escribe de vuelta en el bloque como DBML o como comentarios de anotación.

Render y layout:

- Parser de un subconjunto de DBML: `Table`, columnas con `pk`, `not null`, `note`, `ref` inline, `headercolor`; relaciones `Ref:`, `Ref name:`, `Ref { }`, forma directa `a.col > b.col`; operadores `>`, `<`, `<>`, `-`; `TableGroup` con `color` y miembros. Ignora `enum`, `Project`, `Note`, `indexes`, comentarios `//` y `/* */`.
- Layout automático con elkjs (`elk.layered`, dirección derecha, ruteo ortogonal, puertos fijos en la fila de cada columna). Las áreas son contenedores ELK con `INCLUDE_CHILDREN`.
- Caché de layout por estructura del bloque: las líneas `@pos`, `@view`, `@size`, `@edge` y `@group` no entran en la clave, así guardar el estado visual no recalcula ELK ni parpadea.
- Ruteo ortogonal propio (Manhattan con esquinas redondeadas) para aristas cuando el usuario movió tablas o editó vértices; ELK solo da la primera disposición.
- Notación: pata de gallo en el lado "muchos"; barra si el FK es `not null` o PK, círculo si es anulable. Iconos 🔑 y 🔗, badge `NN`, color de encabezado por tabla con contraste automático del texto.
- Ancho de tabla medido con un canvas 2D según el texto real de nombres y tipos, mínimo 216 px.

Canvas:

- Pan arrastrando el fondo, zoom con rueda, botones `+`, `−`, ajustar a la vista, y botón de nueva tabla.
- Canvas redimensionable; alto por directiva `// height: N`.
- Estado persistido dentro del bloque: `// @pos tabla x y`, `// @view x y zoom`, `// @size w h`, `// @edge from fromCol to toCol x1 y1 …`, `// @group área collapsed`.

Edición desde el diagrama, todo reescribe el bloque:

- Tabla: renombrar (actualiza referencias), color de encabezado, eliminar con confirmación (borra relaciones que la referencian), mover a un área existente, a una nueva o sacarla de su área.
- Columna: renombrar (actualiza `tabla.col` en refs), cambiar tipo.
- Relación: seleccionar, cambiar cardinalidad, agregar, mover y borrar vértices de ruta, restablecer ruta.
- Área: arrastrar por la barra, colapsar y expandir, renombrar, color, nueva tabla dentro, quitar el área conservando sus tablas.
- Crear tabla nueva en el centro de la vista con una columna `id integer [pk, not null]`.
- Los cambios estructurales fijan las posiciones de todas las tablas en el mismo guardado para que nada se reacomode.

Interfaz:

- Idioma en inglés y español, elegido en los ajustes del plugin. Diccionario plano en `src/i18n.ts` con `t(clave, vars)`.
- Menús contextuales, modales de texto y confirmación, selector difuso de áreas y avisos, todos con componentes de Obsidian.
- Estilos con variables de tema de Obsidian, modo claro y oscuro automáticos.

Fuera del plugin pero relacionado: la skill `sql-to-dbml` de Claude Code genera DBML compatible con este subconjunto a partir de scripts `CREATE TABLE`. La extensión de VS Code debe aceptar exactamente el mismo subconjunto para que la skill siga sirviendo.

## 2. Mapa de módulos y portabilidad

| Archivo | Líneas | Depende de Obsidian | Depende del DOM | Portable |
| --- | --- | --- | --- | --- |
| `src/parser.ts` | 918 | No | No | Sí, sin cambios |
| `src/edits.ts` | 293 | No | No | Sí, sin cambios |
| `src/areas.ts` | 176 | No | No | Sí, sin cambios |
| `src/layout.ts` | 295 | Solo el global `activeDocument` | Canvas 2D para medir texto | Sí, con un cambio de una línea |
| `src/i18n.ts` | 165 | No | No | Sí, sin cambios |
| `src/main.ts` | 2288 | Sí, en toda la clase | Sí, SVG y HTML | Se porta la lógica; se reemplaza la capa de integración |
| `styles.css` | — | Variables de tema | — | Se porta cambiando variables |
| `test/*.test.cjs`, `test/run.mjs` | — | No | No | Sí, sin cambios |

Detalle de `src/layout.ts`: la función `getMeasureCtx` lee el global `activeDocument` dentro de un `try/catch`. En un webview de VS Code ese global no existe, el `catch` devuelve `null` y el ancho se estima a 7 px por carácter, lo que desalinea iconos y tipos. Cambiar a `typeof activeDocument !== "undefined" ? activeDocument : document` resuelve ambos entornos.

Los cuatro módulos puros ya se prueban con `npm test` (runner integrado de Node, empaquetado con esbuild en `test/.build/`). Ese esquema de pruebas se copia tal cual al proyecto nuevo.

## 3. Inventario de acoplamiento en `src/main.ts`

Conteo aproximado de puntos de uso en la versión 0.3.0:

| API de Obsidian | Usos | Para qué |
| --- | --- | --- |
| `Plugin`, `registerMarkdownCodeBlockProcessor`, `addSettingTab`, `loadData`, `saveData` | 1 clase | Entrada del plugin, ajustes |
| `MarkdownRenderChild` | 1 clase (`Diagram`) | Ciclo de vida del bloque renderizado, `registerDomEvent` (8), `onunload` |
| `MarkdownPostProcessorContext.getSectionInfo` | 4 | Ubicar la línea del fence dentro del archivo |
| `app.vault.getAbstractFileByPath`, `vault.read`, `vault.process`, `TFile` | 9 + 4 | Lectura y escritura atómica del archivo de la nota |
| `Menu` | 5 | Menús de tabla, columna, relación, vértice y área |
| `Modal` (`EditModal`, `ConfirmModal`) | 3 | Pedir texto, confirmar borrado |
| `FuzzySuggestModal` (`AreaSuggestModal`) | 1 | Elegir área con búsqueda |
| `Notice` | 10 | Avisos de error |
| `PluginSettingTab`, `Setting` | 1 clase | Selector de idioma |
| `setIcon` | 1 | Ícono del botón de nueva tabla |
| Helpers de DOM de Obsidian: `createDiv` (9), `createEl` (10), `empty` (8), `setText` (4) | 31 | Construcción de HTML |
| Globales `activeDocument` (21), `activeWindow` (6) | 27 | `createElementNS`, `requestAnimationFrame`, `setTimeout`, canvas de medición |

Todo lo demás en `Diagram` es SVG y geometría estándar: dibujo de nodos, áreas, aristas y marcadores; arrastre; pan y zoom; ruteo Manhattan; ortogonalización de vértices; mapeo afín de rutas manuales al mover tablas. Esa parte, cerca de 1800 líneas, se porta sin cambios de lógica.

## 4. Mapeo a la API de VS Code

| Obsidian | VS Code |
| --- | --- |
| `Plugin.onload` | `activate(context)` en el extension host |
| `registerMarkdownCodeBlockProcessor("dbml")` | Dos entradas: `CustomTextEditorProvider` para archivos `.dbml`, y un comando "DBML ERD: Open preview" que abre un `WebviewPanel` al lado del editor con el fence ```` ```dbml ```` bajo el cursor de un archivo `.md` |
| `MarkdownRenderChild` + `Diagram` | Mismo código de `Diagram` corriendo en el script del webview, con `document.createElement` y `createElementNS` en lugar de los helpers de Obsidian |
| `createDiv`, `createEl`, `empty`, `setText` | Funciones pequeñas propias (`el(tag, cls, text)`, `clear(el)`) o DOM directo |
| `activeDocument`, `activeWindow` | `document`, `window` |
| `Menu.showAtMouseEvent` | Menú HTML propio dentro del webview, posicionado en el evento, con variables `--vscode-menu-*`. Mantiene la apertura con clic izquierdo. Alternativa nativa: `contributes.menus["webview/context"]` con atributos `data-vscode-context`, pero solo responde al clic derecho |
| `EditModal` | `postMessage` al host y `vscode.window.showInputBox` con `validateInput` usando `NAME_RE`; la respuesta vuelve por `postMessage` |
| `ConfirmModal` | `vscode.window.showWarningMessage(texto, { modal: true }, botón)` |
| `FuzzySuggestModal` | `vscode.window.showQuickPick` con las áreas más la opción "New area…" |
| `Notice` | `vscode.window.showErrorMessage` o `showInformationMessage` |
| `getSectionInfo` + `vault.process` | `TextDocument` + `WorkspaceEdit.replace(uri, range, texto)`. Para `.dbml` el rango es el documento entero; para `.md` el rango es el fence localizado con la misma lógica de `blockRange` sobre `document.getText()` |
| Evento `modify` que re-renderiza el bloque | `workspace.onDidChangeTextDocument`; el host manda `postMessage({ type: "update", text })` al webview |
| `PluginSettingTab` | `contributes.configuration` con `dbmlErd.language` (`en` / `es`); el host lee `workspace.getConfiguration` y manda el idioma al webview |
| `loadData`, `saveData` | No hacen falta; el único ajuste es el idioma |
| `setIcon` | Codicon `$(table)` o SVG inline en el toolbar del webview |
| Import dinámico de ELK | ELK va empaquetado en el script del webview; el costo de arranque recae solo en el webview, no en VS Code. Opcional: correr ELK en un `Worker` dentro del webview |
| Caché `layoutCache` y `selByBlock` en la instancia del plugin | Estado del webview; con `retainContextWhenHidden: true` sobrevive al cambiar de pestaña, y `getState`/`setState` lo restauran tras recargar la ventana |
| CSS con variables de Obsidian | Variables de VS Code, ver sección 6 |

## 5. Arquitectura propuesta

Dos procesos, como en toda extensión con webview:

1. Extension host (Node): registra el editor personalizado y los comandos, crea webviews, localiza el fence, aplica `WorkspaceEdit`, muestra prompts nativos y lee la configuración. No sabe nada de SVG.
2. Webview (navegador): parsea el DBML, calcula el layout con ELK, dibuja y maneja la interacción. Cuando necesita escribir, manda al host un mensaje con el texto nuevo del bloque o con la mutación a aplicar.

Protocolo de mensajes sugerido, en ambos sentidos:

```ts
// host -> webview
{ type: "init", text: string, lang: "en" | "es", uri: string }
{ type: "update", text: string }            // el documento cambió fuera del webview
{ type: "promptResult", id: number, value?: string }
{ type: "confirmResult", id: number, ok: boolean }
{ type: "pickResult", id: number, value?: string }

// webview -> host
{ type: "writeBlock", text: string }         // texto completo del bloque ya mutado
{ type: "prompt", id: number, title: string, initial: string, kind: "name" | "type" }
{ type: "confirm", id: number, title: string, body: string, okLabel: string }
{ type: "pick", id: number, title: string, items: string[] }
{ type: "notice", level: "info" | "error", message: string }
```

Con este protocolo la mutación del bloque sigue viviendo en el webview, que ya tiene las líneas y las funciones puras de `parser.ts` y `edits.ts`. El host solo reemplaza el rango. Esto evita duplicar la lógica de localización de tablas en dos procesos.

Interfaz `Host` dentro de `Diagram`. Hoy `Diagram` llama directo a `Menu`, `Modal`, `Notice` y `vault`. La forma más limpia de portar es extraer esas llamadas a una interfaz:

```ts
interface Host {
  menu(items: { label: string; checked?: boolean; danger?: boolean; onClick: () => void }[], at: { x: number; y: number }): void;
  prompt(title: string, initial: string): Promise<string | undefined>;
  confirm(title: string, body: string, okLabel: string): Promise<boolean>;
  pick(title: string, items: string[]): Promise<string | undefined>;
  notice(message: string, level?: "info" | "error"): void;
  readBlock(): Promise<string[]>;                 // líneas actuales del bloque
  writeBlock(lines: string[]): Promise<boolean>;  // reemplaza el bloque completo
  schedule(fn: () => void, ms: number): () => void;
  raf(fn: () => void): void;
}
```

Con `Host`, `Diagram` deja de importar `obsidian` y pasa a ser código compartido. El plugin de Obsidian implementa `Host` con `Menu`, `Modal`, `Notice` y `vault.process`; la extensión de VS Code lo implementa con `postMessage`. La spec de edición visual (`docs/specs/2026-11-10-edicion-visual.md`) dejó esta interfaz explícitamente fuera de alcance, pero preparó el terreno al mover toda escritura a funciones puras en `edits.ts` y `parser.ts`.

Decisión pendiente: hacer el refactor de `Host` primero en el plugin de Obsidian y publicar `Diagram` como módulo compartido, o copiar `main.ts` al proyecto nuevo y adaptarlo ahí. La primera opción cuesta más al inicio y evita que los dos productos diverjan; la segunda arranca más rápido y deja dos copias de 1800 líneas que habrá que mantener a mano.

## 6. Estilos

Variables de Obsidian usadas en `styles.css` y su equivalente en un webview de VS Code:

| Obsidian | VS Code |
| --- | --- |
| `--background-primary` | `--vscode-editor-background` |
| `--background-primary-alt` | `--vscode-editorWidget-background` o `--vscode-sideBar-background` |
| `--background-secondary` | `--vscode-editorWidget-background` |
| `--background-modifier-border` | `--vscode-panel-border` o `--vscode-editorWidget-border` |
| `--interactive-accent` | `--vscode-focusBorder` o `--vscode-button-background` |
| `--text-normal` | `--vscode-editor-foreground` |
| `--text-muted` | `--vscode-descriptionForeground` |
| `--text-on-accent` | `--vscode-button-foreground` |
| Clases `mod-cta`, `mod-warning` de botones | Estilos propios con `--vscode-button-*` y `--vscode-inputValidation-errorBorder` |

Los menús HTML propios usan `--vscode-menu-background`, `--vscode-menu-foreground`, `--vscode-menu-selectionBackground` y `--vscode-menu-border`. El `body` del webview ya trae `data-vscode-theme-kind` para distinguir claro, oscuro y alto contraste.

El `<input type="color">` oculto que usa `pickColor` funciona en webviews de VS Code. Alternativa nativa: `showInputBox` con validación `HEX_COLOR_RE`, o `showQuickPick` con la paleta `AREA_PALETTE`.

## 7. Estructura propuesta del proyecto nuevo

```
vscode-dbml-erd/
  package.json              contributes: customEditors, commands, configuration, languages, menus
  package.nls.json          títulos de comandos en inglés; package.nls.es.json en español
  esbuild.config.mjs        dos bundles: extension host y webview
  tsconfig.json
  src/
    extension.ts            activate, registro de comandos y del editor personalizado
    editorProvider.ts       CustomTextEditorProvider para .dbml
    previewPanel.ts         WebviewPanel para fences dbml en .md
    blockLocator.ts         encuentra el fence bajo el cursor; mismo criterio que blockRange
    hostBridge.ts           implementa prompt, confirm, pick, notice, writeBlock con la API de VS Code
    webview/
      main.ts               punto de entrada del webview: Host por postMessage, instancia Diagram
      diagram.ts            Diagram portado desde src/main.ts
      menu.ts               menú HTML contextual
      dom.ts                helpers el(), clear()
    shared/
      parser.ts             copiado sin cambios
      edits.ts              copiado sin cambios
      areas.ts              copiado sin cambios
      layout.ts             copiado con el cambio de activeDocument
      i18n.ts               copiado sin cambios; se agregan claves de comandos
  media/
    styles.css              portado con variables --vscode-*
    icons/                  ícono de la extensión y de la tabla
  syntaxes/
    dbml.tmLanguage.json    gramática mínima: palabras clave, tipos, settings, comentarios
  test/
    run.mjs y *.test.cjs    copiados; los paths de src/ pasan a src/shared/
```

Configuración de esbuild: el bundle del host con `platform: "node"`, `format: "cjs"`, `external: ["vscode"]`, salida `dist/extension.js`; el bundle del webview con `platform: "browser"`, `format: "iife"`, salida `dist/webview.js`, con ELK incluido. El `tsconfig` del webview necesita `lib: ["DOM", "ES2020"]`; el del host, `types: ["node", "vscode"]`.

Contribuciones mínimas en `package.json`:

- `languages`: id `dbml`, extensiones `.dbml`, configuración de comentarios `//` y `/* */`.
- `customEditors`: `dbmlErd.editor` para `*.dbml`, `priority: "option"` para que el editor de texto siga siendo el predeterminado y el usuario abra el diagrama con "Open With".
- `commands`: `dbmlErd.openPreview` (abrir a un lado), `dbmlErd.openPreviewToSide`.
- `menus`: `editor/title` con el comando de preview cuando el lenguaje es `markdown` o `dbml`.
- `configuration`: `dbmlErd.language` con enum `en`, `es`, por defecto `en`.
- `activationEvents` quedan implícitos por las contribuciones desde VS Code 1.74.

## 8. Puntos delicados conocidos

- Bucle de re-render: en Obsidian cada `vault.process` dispara `modify` y el bloque se vuelve a renderizar, lo que obligó a la caché de layout y a `selByBlock`. En VS Code, `onDidChangeTextDocument` también dispara con las ediciones propias. El host debe marcar la versión del documento que acaba de escribir y no reenviar `update` al webview para esa versión; así el webview conserva selección, vista y layout sin reconstruirse.
- Localización del fence en `.md`: `getSectionInfo` daba la línea del fence aunque el bloque hubiera crecido. En VS Code hay que guardar la línea de apertura del fence al abrir el preview y reubicarla con `blockRange` en cada escritura, igual que hace `blockRange` hoy desde `lineStart`. Si hay varios fences dbml en el mismo archivo, cada preview sigue al suyo.
- Escrituras atómicas: `vault.process` garantiza lectura-modificación-escritura sin pisar cambios concurrentes. `WorkspaceEdit` aplica sobre la versión actual del `TextDocument`; conviene leer `document.getText()` justo antes de calcular el reemplazo y aplicar un solo `replace` por operación.
- Guardado diferido de posiciones: hoy `scheduleSaveLayout` espera 600 ms tras el último arrastre. En VS Code se conserva; cada guardado es un `WorkspaceEdit`, que deja el documento sucio hasta que el usuario guarda. Decisión pendiente: guardar el archivo automáticamente tras la edición (`document.save()`) o dejarlo sucio como cualquier edición.
- Tamaño del bundle: ELK pesa 1.6 MB. Dentro del webview no afecta el arranque de VS Code. Si el primer render se siente lento, mover ELK a un `Worker` del webview mantiene la interfaz fluida.
- Content Security Policy: el webview necesita `script-src` con nonce para `dist/webview.js` y `style-src` para `media/styles.css`. Sin `unsafe-inline` los estilos inline que hoy se asignan por JS (`style.setProperty` de `--dbml-erd-height`, `style.width`) siguen funcionando porque son propiedades, no atributos `style` en HTML.
- Medición de texto: el canvas 2D de medición debe usar las mismas fuentes que el CSS del webview. Hoy `layout.ts` mide con `sans-serif` genérico; en VS Code la fuente del editor es `--vscode-editor-font-family`, pero el diagrama puede seguir usando `sans-serif` con tal de que el CSS del SVG use la misma.
- `touch-action: none` y eventos `pointer` ya son estándar; no cambian.
- Pop-out windows de Obsidian motivaron `activeDocument`; en VS Code cada webview tiene su propio `document`, así que basta con el global.

## 9. Plan de trabajo sugerido

1. Crear el repositorio `vscode-dbml-erd` con `yo code` o a mano con la estructura de la sección 7, y copiar `parser.ts`, `edits.ts`, `areas.ts`, `layout.ts`, `i18n.ts` y `test/`. Verificar que `npm test` pasa sin cambios.
2. Portar `Diagram` al webview con un `Host` de prueba que solo haga `console.log`. Primer hito: abrir un `.dbml` con el editor personalizado y ver el diagrama con pan, zoom y arrastre, sin escritura.
3. Implementar `writeBlock` y el filtro de versión para las ediciones propias. Segundo hito: mover una tabla y ver aparecer `// @pos` en el texto sin parpadeo.
4. Implementar `prompt`, `confirm`, `pick` y `notice` con la API nativa y el menú HTML. Tercer hito: paridad de edición con 0.3.0.
5. Preview de fences en `.md` con el comando y `blockLocator`.
6. Gramática TextMate mínima, íconos, `package.nls`, README, CHANGELOG, `vsce package`, GitHub Action que publique en Marketplace y Open VSX al crear un tag.
7. Decidir si el `Host` vuelve al plugin de Obsidian para compartir `Diagram` o si se mantienen dos copias.

## 10. Fuera de alcance de este análisis

- Mobile: VS Code no aplica.
- Export a SVG o PNG, búsqueda de tabla, niveles de detalle: ideas listadas en la spec de áreas como fases posteriores, aplican por igual a los dos productos.
- Soporte de DBML completo (enums, claves compuestas, índices dibujados): sigue siendo el mismo subconjunto deliberado.

## 11. Decisiones tomadas al construir (2026-11-10)

Estado: implementado como `vscode-dbml-erd` 0.1.0 a partir de una copia del plugin 0.3.0. Falta la prueba manual en VS Code (F5).

- **Copia, no refactor del plugin.** `Diagram` se portó a `src/webview/diagram.ts` con una interfaz `Host` (`src/webview/host.ts`: menu, prompt, confirm, pick, notice, edit). El plugin de Obsidian sigue intacto; llevar `Host` de vuelta al plugin para compartir `Diagram` queda como paso 7 del plan.
- **La mutación vive en el host, no en el webview.** A diferencia de la sección 5, el webview no manda el texto del bloque ya mutado: manda una operación serializable (`src/shared/ops.ts`, `EditOp`) y el extension host la aplica sobre el documento recién leído con las mismas funciones puras de `parser.ts` y `edits.ts`. Motivo: el webview recibe los cambios con un debounce y puede estar desactualizado; con texto completo, una acción del diagrama pisaría lo tecleado en el editor. Así se conserva la garantía de `vault.process`. El guardado de posiciones es la op `layout` con el estado visual; el host reescribe solo las líneas `@…` y omite la escritura si el texto no cambia.
- **Escritura mínima.** `lineDiff` recorta prefijo y sufijo comunes y el `WorkspaceEdit` reemplaza solo el tramo central, con el EOL del documento (`\r\n` o `\n`). Cada acción es un paso de deshacer; el documento queda sucio y el usuario guarda (no hay guardado automático).
- **Re-render tras cada escritura, como en Obsidian.** El host reenvía cada cambio del documento (incluidos los propios) con 150 ms de debounce; el webview reconstruye el SVG reutilizando el caché de layout por estructura. La selección de arista sobrevive en el estado del webview. Un update que llega durante un arrastre espera al `pointerup`.
- **Texto a medio escribir.** Si el texto no parsea o el parser no ve tablas (llave sin cerrar), el último diagrama válido sigue en pantalla con un aviso al pie, en vez de vaciarse a cada tecla.
- **Selector de color del host**, no `<input type="color">`: quick pick con la paleta de áreas más "Color personalizado (hex)…" con validación. Evita depender de que el diálogo nativo abra dentro del webview.
- **Lienzo a pantalla completa.** No hay `resize: both` ni directiva `// height:`; `@size` se conserva si existe (lo escribe Obsidian) y nunca se escribe desde VS Code.
- **Fuente de medición = fuente del webview.** `layout.ts` expone `setMeasureFont()`; el webview la fija con la familia de `--vscode-font-family`, y el CSS del SVG usa la misma. `activeDocument` se resuelve con `typeof` para servir en ambos entornos.
- **Seguimiento del fence en Markdown.** La sesión guarda la línea de apertura y la desplaza con cada `contentChanges` fuera del bloque; si un cambio toca la cerca, la reubica con la ```dbml más cercana. Si no hay ninguna, el panel muestra "el bloque ya no está".
- **Idioma** `dbmlErd.language`: `auto` (idioma de VS Code), `en`, `es`. Cambiarlo actualiza las sesiones abiertas.
- **Colapsar tablas (nuevo, no está en el plugin).** Una tabla se colapsa a su encabezado con ▾/▸ a la derecha del encabezado o desde su menú; las aristas llegan al centro del encabezado y la posición no cambia. Se persiste como `// @table <nombre> collapsed` (misma forma que `@group`); `renameTable`/`deleteTable` la mantienen. El plugin 0.3.0 conserva esa línea como comentario (su reescritura solo toca `@pos|view|size|edge|group`) y dibuja la tabla expandida. `tableWidth` reserva 20 px para el triángulo. El menú del área también ofrece colapsar/expandir.
- **Extras incluidos:** gramática TextMate para `.dbml` e inyección en fences de Markdown, íconos, `package.nls` en/es, `samples/`, prueba de humo del webview con jsdom (única dependencia nueva de desarrollo, junto con `@types/vscode` y `@vscode/vsce`).
