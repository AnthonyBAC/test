# Casos e incidentes de la evaluación

Resultados históricos revisados del 18 y 19 de octubre de 2026. La incorporación al repositorio conserva estos resultados y no constituye una corrección ni una nueva ejecución.

| Caso | Nombre | Estado histórico | Aplicación de la prueba |
| --- | --- | --- | --- |
| CP-01 | Inicio de sesión exitoso | Aprobado | API/PostgreSQL y navegador |
| CP-02 | Restricción de escritura para usuario Editor | Fallido | API/PostgreSQL |
| CP-03 | Eliminación lógica de cliente | Fallido | API/PostgreSQL |
| CP-04 | Tiempo de respuesta al consultar clientes | Fallido | API/PostgreSQL |
| CP-05 | Validación de usabilidad con usuarios representativos | Bloqueado | Precondiciones y revisión manual |
| CP-06 | Compatibilidad entre navegadores y dispositivos | Fallido | API/PostgreSQL y navegador |
| CP-07 | Registro de usuario y creación de empresa | Aprobado | API/PostgreSQL y navegador |
| CP-08 | Carga y descarga de documento asociado a contrato | Aprobado | API/PostgreSQL |
| CP-09 | Registro de acciones críticas en auditoría | Aprobado | API/PostgreSQL |
| CP-10 | Protección de contraseñas mediante hashing | Fallido | API/PostgreSQL |
| CP-11 | Restricción de acceso a documentos entre empresas | Fallido | API/PostgreSQL |
| CP-12 | Cierre de sesión y revocación del token | Fallido | API/PostgreSQL y navegador |
| CP-13 | Creación, asignación de rol y administración de usuarios | Aprobado | API/PostgreSQL |
| CP-14 | Creación de cliente y validación de campos | Fallido | API/PostgreSQL |
| CP-15 | Creación de contrato asociado a un único cliente | Aprobado | API/PostgreSQL |
| CP-16 | Cálculo del estado de contrato | Fallido | API/PostgreSQL y navegador |
| CP-17 | Generación de enlace de acceso a documento | Fallido | API/PostgreSQL y navegador |
| CP-18 | Protección de comunicaciones mediante TLS | Fallido | API/PostgreSQL |
| CP-19 | Protección de datos sensibles almacenados | Bloqueado | Precondiciones y revisión manual |
| CP-20 | Protección frente a XSS, SQL Injection y solicitudes no válidas | Parcial | API/PostgreSQL y navegador |
| CP-21 | Validación de registros de log seguros | Fallido | API/PostgreSQL |
| CP-22 | Recuperación de información mediante respaldo | Aprobado | API/PostgreSQL |
| CP-23 | Validación de controles aplicados a datos personales | Fallido | API/PostgreSQL |
| CP-24 | Validación de token de acceso JWT | Aprobado | API/PostgreSQL |
| CP-25 | Tiempo de carga de página principal | Fallido | API/PostgreSQL y navegador |
| CP-26 | Concurrencia de usuarios | Aprobado | JMeter (API disponible como referencia) |
| CP-27 | Flujo de acceso desde clientes hacia contratos | Fallido | API/PostgreSQL y navegador |
| CP-28 | Verificación de disponibilidad del servicio | Bloqueado | Precondiciones y revisión manual |
| CP-29 | Actualización durante ventana de mantenimiento | Bloqueado | Precondiciones y revisión manual |
| CP-30 | Restricción de correo principal entre empresas | Aprobado | API/PostgreSQL |

CP-06 tuvo una revisión parcial en Edge y emulación móvil que evidenció un fallo; la matriz completa sigue pendiente. CP-20 es parcial porque CSRF no se validó de forma concluyente. CP-19 no permite concluir el cifrado del almacenamiento. CP-30 aprobó la unicidad del correo; el error devuelto originó un incidente separado.

## Incidentes abiertos

| ID | Caso | Hallazgo | Criticidad | Responsable |
| --- | --- | --- | --- | --- |
| INC-01 | CP-02 | Editor realiza operaciones de escritura sin restricción. | Grave | Anthony Adasme |
| INC-02 | CP-03 | Borrado físico en lugar de eliminación lógica. | Grave | Juanjose Soto |
| INC-03 | CP-04 | Consulta de clientes supera 300 ms. | Moderado | Juanjose Soto |
| INC-04 | CP-06 | Dashboard recortado en pantalla móvil. | Moderado | Anthony Adasme |
| INC-05 | CP-10 | Contraseña sin el hashing esperado. | Grave | Anthony Adasme |
| INC-06 | CP-11 | Documento accesible desde otra empresa. | Grave | Anthony Adasme |
| INC-07 | CP-12 | Token reutilizable después de cerrar sesión. | Grave | Anthony Adasme |
| INC-08 | CP-14 | Correo inválido aceptado y almacenado. | Moderado | Juanjose Soto |
| INC-09 | CP-16 | Fechas de contratos mostradas un día antes. | Moderado | Juanjose Soto |
| INC-10 | CP-17 | Archivo descargable sin autenticación. | Grave | Juanjose Soto |
| INC-11 | CP-18 | HTTP sin TLS en el entorno local. | Grave | Juanjose Soto |
| INC-12 | CP-21 | Auditoría accesible sin autenticación. | Grave | Anthony Adasme |
| INC-13 | CP-23 | Datos de usuario ajeno accesibles sin control. | Grave | Juanjose Soto |
| INC-14 | CP-25 | Carga móvil supera el límite de 2 s. | Moderado | Juanjose Soto |
| INC-15 | CP-27 | Flujo Cliente → Contratos no disponible. | Moderado | Anthony Adasme |
| INC-16 | CP-30 | Correo duplicado devuelve 500 y detalle SQL. | Moderado | Juanjose Soto |

El detalle de resultados, evidencias y ejecutores se conserva en [resumen-revisado.json](evidencias/2026-10-19/resumen-revisado.json). Las pruebas dinámicas no sustituyen una evaluación legal completa, el monitoreo mensual ni las pruebas con usuarios representativos.
