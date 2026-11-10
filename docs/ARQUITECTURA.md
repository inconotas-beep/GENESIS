# Arquitectura y permisos

## Componentes

`src/core.js` es el único motor de reglas. El servidor local y Apps Script ejecutan las mismas operaciones. La UI envía identificadores y datos, nunca una identidad confiable. Apps Script obtiene el correo en el servidor. El modo local emite una sesión HttpOnly y SameSite=Strict a partir de una cuenta ficticia; no está destinado a producción. Se rechazan solicitudes locales sin el encabezado de la instancia. No hay dependencias de aplicación externas.

El repositorio Google utiliza una pestaña por entidad, con filas `id` y `record_json`. Los identificadores y relaciones son explícitos; el JSON permite incorporar metadatos/procedencia sin replicar cuadros. Este MVP lee las entidades en lotes y crea índices lógicos por búsqueda en memoria. La siguiente optimización será usar mapas y limitar lecturas por entidad: todavía no existen índices físicos ni una garantía de rendimiento para todo el centro.

## Entidades y claves

| Entidad (pestaña) | Identidad / relación |
| --- | --- |
| Año lectivo (`years`) | ID del año |
| Estudiante (`students`) | ID estable, NIE textual único |
| Matrícula (`enrollments`) | Estudiante + año; referencia sección |
| Sección (`sections`) | ID estable |
| Docente (`teachers`) | ID vinculado a usuario |
| Usuario / Rol (`users`, `roles`) | ID, correo verificado, rol y estado activo |
| Asignación (`assignments`) | Docente + año + sección + materia; revocación lógica |
| Asignatura/módulo (`subjects`) | Tipo de cálculo, decimales de visualización |
| Período (`periods`) | ID de período + año |
| Bloque / Actividad / Ponderación (`blocks`, `activities`, `weights`) | Bloque de evaluación por materia y actividades ordenadas; pesos configurados |
| Calificación (`grades`) | Estudiante + año + sección + materia + período, vector de actividades con `null` para ausente |
| Recuperación (`recoveries`) | Reservada; no se aplica una regla académica no confirmada |
| Estado de período (`periodStates`) | Año + período; cierre global para ese año |
| Auditoría (`audit`) | Usuario, fecha UTC, operación y antes/después |
| Lote / Incidencia (`batches`, `incidents`) | Hash de origen, grupo autorizado, estado y ubicaciones para revisión |

La clave de calificación usa la relación académica y no el ID de asignación. De ese modo revocar/reasignar un docente no borra ni duplica el historial. Los valores por actividad se guardan juntos por estudiante/período para una escritura por lote; no constituyen una copia de la hoja original. Hay una sola matrícula del estudiante por año en este MVP: traslados durante el año necesitan un flujo adicional, todavía no implementado.

## Autorización

| Operación | Docente | Dirección | Administración de Rocío |
| --- | --- | --- | --- |
| Consultar / exportar | Solo asignación activa propia | Asignaciones activas | Asignaciones activas |
| Guardar notas | Grupo propio, período abierto | No | Período abierto |
| Crear / revocar asignaciones | No | No | Sí |
| Registrar docentes / matrículas / catálogos | No | No | Sí |
| Cerrar período | No | Sí | Sí |
| Reabrir | No | No | Sí, con motivo |
| Previsualizar importación | Grupo propio, abierto | No | Grupo autorizado, abierto |
| Aprobar / revertir importación | No | No | Sí, abierto y con validaciones |
| Configurar pesos, decimales y roles | No | No | Sí |

Se deniega cualquier cuenta vacía, no registrada, inactiva o con rol desconocido. Los roles actuales son códigos estables ADMIN/DIRECTION/TEACHER; se pueden reasignar desde administración. Rocío es la única administradora inicial. Crear más administradores es una decisión institucional auditada, nunca un permiso de un docente.

## Concurrencia y recuperación

Cada mutación requiere la versión leída previamente. Dos usuarios con versiones distintas no sobrescriben silenciosamente cambios. El servidor local opera de forma sincrónica sobre una copia de la base y guarda con archivo temporal y renombrado. Apps Script usa `LockService` durante lectura, validación y escritura, con una operación por rango y entidad.

Google Sheets no aporta transacciones entre pestañas: se realiza un respaldo privado antes de cada escritura y se marca `WRITE_FAILED` mientras está en curso. Si falla o vence la ejecución, los siguientes accesos quedan bloqueados. Restaurar la copia completa y retirar la marca requiere administración, según DESPLIEGUE.md. Esta medida prioriza coherencia y recuperación; copiar el libro completo en cada guardado consume tiempo y almacenamiento. Debe medirse y mejorarse antes de un uso intensivo.

## Reglas académicas

General: 35/35/30 sobre tres actividades; anual solo con cuatro resultados completos. Módulo: tres notas por fase y pesos 25/50/25. Las ponderaciones son configurables por materia antes de que exista historial. Si alguna actividad falta, se conserva `null` como resultado pendiente, sin penalizarla ni renormalizar pesos. No hay un estado aprobado/reprobado inventado ni recuperación automática. El promedio anual de módulos permanece por validar.

La precisión interna se conserva como número JavaScript; la UI formatea decimales de manera configurable. Los cálculos usan números de coma flotante, no aritmética decimal financiera. La comparación con ejemplos representativos se probó para las dos reglas observadas; la validación institucional del redondeo sigue pendiente.

## Límites funcionales actuales

Las consultas de Dirección se limitan al listado de asignaciones, notas, exportación JSON, cierres y auditoría. No se entregó aún un boletín oficial imprimible, reproducción exacta de Excel, análisis estadístico institucional o asistente visual completo de importación. No hay envío de correos, formularios estudiantiles ni publicación externa. Los respaldos se gestionan en Drive por administración, sin acceso directo de docentes a las hojas maestras.
