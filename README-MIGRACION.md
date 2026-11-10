# GENESIS en Google Apps Script

## Preparar la copia local

Ejecutá `npm ci` y `npm run build`. Usá el proyecto de Apps Script autorizado por administración y habilitá el servicio avanzado de Google Sheets.

Usá [clasp.example.json](migration/config/clasp.example.json) como plantilla para `.clasp.json`. Vinculá el ID del proyecto autorizado y mantené `dist/apps-script` como directorio de carga.

La herramienta `node tools/clasp.mjs` usa una sesión local guardada en `migration/private/clasp-auth.json`. Configurá esa sesión con la cuenta autorizada. El comando de subida requiere `GENESIS_GOOGLE_AUTHORIZED=YES` y el de publicación requiere además `GENESIS_PUBLISH_AUTHORIZED=YES`.

## Configurar el almacenamiento y la identidad

En la configuración del proyecto de Apps Script, completá las propiedades privadas según [script-properties.example.json](migration/config/script-properties.example.json). Mantené `ACCESS_ENABLED=NO` durante la importación y las verificaciones. Configurá los identificadores de la hoja y las carpetas privadas, el paquete institucional y su SHA-256, y las credenciales OAuth autorizadas.

Para las funciones del editor `configurarDriveInconotas` y `recuperarImportacionInconotas`, guardá en `PERSONAL_STORAGE_CONNECTION_JSON` el contenido del plan privado `personal-storage-connection.json`. El asistente de almacenamiento puede generar ese plan en `migration/private/`. Las funciones verifican la identidad, los permisos del destino y el archivo antes de escribir.

La recuperación verifica que cada fila existente coincida con el paquete de referencia, guarda un respaldo y agrega las filas faltantes. Luego compara todas las tablas con el paquete original.

Verificá el despliegue privado, el ingreso, el aislamiento de docentes por asignación, las notas bloqueadas y la integridad de las tablas antes de habilitar el acceso académico.
