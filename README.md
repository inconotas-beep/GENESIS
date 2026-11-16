# GENESIS

Sistema académico del Instituto Nacional de Comercio (INCO). Este repositorio contiene el código del sistema local y su adaptación para Google Apps Script.

Incluye matrículas, asignaciones de docentes, evaluación por materia o módulo, cierres, bloqueos, importación y exportación de notas en Excel, consolidados, boletas y auditoría.

## Desarrollo local

Instalá Node.js 22 o posterior. Desde la raíz del repositorio:

```powershell
npm ci
$env:GENESIS_INITIAL_PASSWORD = Read-Host 'Contraseña inicial de Rocio' -MaskInput
node tools/server.mjs
```

Abrí [GENESIS local](http://127.0.0.1:3000) e ingresá como `Rocio` con la contraseña inicial. Una instalación nueva contiene registros de demostración. Para habilitar también las cuentas docentes de ejemplo, definí `GENESIS_TEST_ACCOUNTS=1` antes del primer inicio. Los cambios se guardan en `data/local/`.

## Compilación y pruebas

```powershell
npm run build
npm test
```

La compilación genera el código de Apps Script en `dist/apps-script/`. Las pruebas que requieren el archivo institucional o informes privados se omiten si esos archivos faltan.

## Trabajar por sección

- En **Consolidados y boletas**, elegí el año, la sección y un período para descargar el Excel de notas. Cada pestaña corresponde a una asignatura o módulo. Los docentes solo reciben sus asignaturas.
- En **Importaciones → Importar notas por sección**, administración puede descargar la plantilla, revisar un XLSX de GENESIS y cargar sus notas nuevas. Las notas idénticas se conservan y los conflictos bloquean toda la carga. El libro admite hasta 1000 registros de calificación en una operación.
- En **Materias y módulos que aparecen en la boleta**, administración puede guardar una selección por año, sección y período o volver a la selección automática. La boleta muestra `Modulo sin llenar` cuando ningún estudiante de esa sección tiene una nota para ese módulo y período.
- Consultá el consolidado para elegir un alumno y descargar su boleta PDF. También podés imprimir toda la sección o elegir varios estudiantes. Se usa una página tamaño carta por boleta.
- Al imprimir o descargar se incluyen todas las materias y módulos del período por defecto. Desmarcá esa opción para usar la selección guardada de la boleta y el cuadro elegido.

## Retomar en otra máquina

Cloná el repositorio y ejecutá `npm ci`, `npm run build` y `npm test`. Después podés arrancar con los datos de demostración siguiendo la sección Desarrollo local.

La entrega privada de Inconotas contiene una copia de la hoja de datos de Google y el archivo `GENESIS-datos-privados-2026-11-15.zip`. Para trabajar localmente con datos reales desde un equipo autorizado, copiá `local-institucional/database.json` del ZIP a `data/privado/institucional/database.json` y arrancá con una nueva contraseña inicial. Los libros y los informes en `originales/` permiten volver a correr las tres pruebas que se omiten en una instalación limpia. Ubicá el ZIP de libros en la raíz y los informes JSON en `docs/`.

La configuración para Google está en [README-MIGRACION.md](README-MIGRACION.md). En la otra máquina, vinculá el proyecto existente e iniciá una sesión nueva con la cuenta administradora autorizada. Las propiedades del despliegue activo se consultan en Apps Script.
