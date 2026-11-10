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

La configuración para Google está en [README-MIGRACION.md](README-MIGRACION.md). Los expedientes, respaldos, archivos académicos, credenciales y ajustes de producción se guardan por separado.
