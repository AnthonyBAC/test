# Pruebas de Atlas

Esta carpeta integra las pruebas y evidencias realizadas para la evaluación EP3 del 18 y 19 de octubre de 2026. La aplicación conserva los fallos evaluados: agregar este material no significa corregirlos ni aprobar los casos fallidos. Los resultados históricos revisados están en `evidencias/2026-10-19/resumen-revisado.json` y su detalle en [CASOS.md](CASOS.md).

## Contenido

| Carpeta | Contenido |
| --- | --- |
| `scripts` | Ejecución por API/PostgreSQL, navegador Chromium, análisis estático, JMeter y comprobación del entorno. |
| `tests` | Validaciones de las herramientas, ocultación de credenciales e integridad del resumen histórico. |
| `jmeter` | Plan CP-26 editable: 200 usuarios virtuales y cinco rondas. |
| `semgrep` | Tres reglas específicas de Atlas, complementarias a las reglas oficiales. |
| `sonarqube` | Configuración del escáner y servidor opcional independiente. |
| `evidencias/2026-10-19` | Registros, métricas y capturas de las ejecuciones originales; no se sobrescriben. |
| `results` | Salidas de nuevas ejecuciones; ignoradas por Git. |
| `.private` | Contextos temporales con sesiones y perfil de navegador; ignorados por Git. |

## Preparación

Se requiere Node.js 22.9 o superior (verificado con Node.js 24), Docker Desktop y el entorno Atlas de evaluación. No se necesitan dependencias npm adicionales para estos scripts.

Desde la raíz del repositorio:

```powershell
docker compose --env-file .env.local up -d
Copy-Item qa/.env.example qa/.env.local
# Editar qa/.env.local con las credenciales reales del entorno local.
npm run qa:comprobar
npm run qa:validar
```

`qa:comprobar` consulta frontend/API y comprueba la salud de PostgreSQL. `qa:validar` prueba las herramientas y los archivos históricos, sin ejecutar los 30 casos contra la aplicación ni cambiar sus resultados.

## API, base de datos y navegador

Los scripts proceden de las ejecuciones originales y se adaptaron para eliminar rutas personales, configurar credenciales y guardar cada repetición aparte. Para la fase dinámica, establecer `QA_ALLOW_MUTATIONS=true` en `qa/.env.local`.

```powershell
npm run qa:api
powershell -NoProfile -ExecutionPolicy Bypass -File qa/scripts/iniciar-navegador.ps1
npm run qa:navegador
```

La fase API crea usuarios, empresas, clientes y contratos ficticios con un prefijo QA único. Las pruebas de eliminación utilizan clientes creados por la propia ejecución. CP-22 realiza la simulación de pérdida únicamente en una base temporal `atlas_qa_restore_*`, la restaura y elimina esa base temporal; no restaura ni borra la base Atlas principal. Permanecen registros ficticios en Atlas para que el navegador pueda revisarlos.

La fase de navegador reutiliza la última ejecución indicada en `qa/results/ultima-ejecucion.json`; también se puede fijar `QA_RUN_ID`. Requiere conservar el contexto privado generado por la fase API y mantener disponible la misma instancia de Atlas. El perfil de Edge es independiente del perfil personal. Para Chrome u otro Chromium, usar un perfil QA y exponer su puerto de depuración exclusivamente en localhost; configurar `QA_CDP_URL`.

Las fechas de los contratos se calculan en relación con el día de la nueva ejecución. Las capturas históricas mantienen sus fechas originales. Cada fase guarda resúmenes y registros nuevos bajo `qa/results/<id>/`; las credenciales permanecen bajo `qa/.private/<id>/`. Los resúmenes públicos ocultan tokens, contraseñas y hashes de contraseña.

La automatización no cubre todas las precondiciones del ERS. CP-05 requiere cinco participantes representativos; CP-06 requiere completar la matriz de navegadores; CP-19 requiere evidencia del cifrado del almacenamiento; CP-28 necesita registros de un mes y CP-29 una actualización real durante una ventana de mantenimiento. En CP-20, un HTTP 401 sin token solo demuestra autenticación: CSRF queda parcial hasta probar una operación desde otro origen con sesión válida. Los resultados nuevos se deben revisar antes de incorporarlos a un informe.

## Apache JMeter

Instalar Apache JMeter 5.6.3 y Java 21, definir `JMETER_HOME` y, si hace falta, `JAVA_HOME` en `qa/.env.local`.

```powershell
npm run qa:jmeter
npm run qa:jmeter:resumen -- qa/evidencias/2026-10-19/jmeter/CP-26.jtl
npm run qa:jmeter:reporte
```

`qa:jmeter` obtiene una sesión usando las credenciales locales, genera temporalmente una propiedad privada con el token y la elimina al terminar. Ejecuta el plan de 200 hilos, diez segundos de arranque y cinco iteraciones de `GET /clientes`, con aserciones HTTP 200 y lista JSON. El JTL, el log y el dashboard se guardan en resultados nuevos. Se comparte una sesión; no son 200 cuentas diferentes ni una prueba sostenida.

`qa:jmeter:resumen` calcula métricas desde un JTL. `qa:jmeter:reporte` regenera el dashboard del JTL histórico sin repetir la carga; se puede pasar otro JTL después de `--`. Los valores de hilos activos no deben describirse como un conteo exacto de solicitudes HTTP simultáneamente en vuelo.

La ejecución histórica obtuvo 1.000 consultas correctas, cero errores y promedio 4.335,58 ms. Eso respalda la concurrencia de CP-26 en el escenario probado y conserva el fallo del límite de 300 ms de CP-04.

## Semgrep

```powershell
npm run qa:semgrep
```

Se utiliza la imagen oficial por digest y se monta el repositorio en modo de solo lectura. Se ejecutan `p/javascript`, `p/react`, `p/secrets` y las tres reglas de Atlas. Se excluyen dependencias, compilados, `.git`, `.env*`, SQL y `qa`. Las reglas del registro pueden cambiar; una nueva ejecución puede diferir del registro histórico aunque se use el mismo motor. Las alertas se guardan en JSON y requieren revisión contextual.

En el análisis histórico, Semgrep CE 1.180.0 ejecutó 105 reglas oficiales sobre 69 archivos sin coincidencias. Las reglas específicas produjeron 43 coincidencias sobre 44 JS/JSX, incluido un falso positivo. No equivalen a 43 vulnerabilidades independientes.

## SonarQube

Para reutilizar el servidor local existente en el puerto 9000, definir `SONAR_TOKEN` en `qa/.env.local` y mantener `SONAR_HOST_URL=http://host.docker.internal:9000`. El proyecto debe existir y el token debe tener permiso para analizarlo.

Para crear una instancia de evaluación independiente:

```powershell
docker compose -p atlas-qa-repo -f qa/sonarqube/compose.yml up -d
```

Abrir `http://localhost:9001`, configurar el acceso, crear un proyecto privado y un token de análisis. Asignar los perfiles `Sonar way comprehensive` para JavaScript y CSS; establecer `SONAR_PROJECT_KEY` y `SONAR_HOST_URL=http://host.docker.internal:9001` en el archivo local. Esta instancia utiliza volúmenes propios y no cambia el Docker Compose de Atlas.

```powershell
npm run qa:sonarqube
```

El escáner monta las fuentes en modo de solo lectura y escribe su estado en resultados nuevos. No se incluye token ni contraseña del servidor en Git. La configuración analiza `BACKEND/src` y `FRONTEND/src` y excluye recursos gráficos, OpenAPI, dependencias, compilados, SQL y variables de entorno.

El análisis histórico de SonarQube Community Build 26.10.0.133078 abarcó 42 archivos y registró 72 incidencias únicas: 10 BUG, 3 VULNERABILITY y 59 CODE_SMELL. Los impactos MQR pueden solaparse. La cobertura de código de 0 % indica que no se importaron informes de pruebas unitarias y difiere de la cobertura del ERS de 42/42. El Quality Gate inicial devolvió OK sin condiciones evaluadas y no aprueba globalmente el sistema.

## Resultados históricos y límites

El resumen vigente tiene 30 casos: 10 aprobados, 15 fallidos, uno parcial y cuatro bloqueados; 26 tuvieron ejecución completa o parcial. Los 16 incidentes permanecen abiertos: nueve Graves y siete Moderados. CP-30 aprueba la unicidad del correo, pero su HTTP 500 con detalle SQL genera INC-16.

Los JSON de cada caso conservan observaciones originales. El resumen revisado incorpora las correcciones de interpretación posteriores, especialmente CP-19, CP-20, CP-21, CP-26 y CP-30. No se incluye el resumen intermedio que indicaba 11 aprobados. Las capturas, CSV, JTL y logs publicados no contienen archivos privados de sesión. Los JSON se formatearon y se ocultaron valores de credenciales para su publicación.

Los archivos `.log` históricos se conservan como `.log.txt` para distinguirlos de logs locales ignorados. Los dashboards HTML de JMeter se regeneran desde el JTL, evitando incorporar bibliotecas y archivos generados duplicados. El Word se entrega por separado; esta carpeta contiene el material técnico para reproducir y revisar el trabajo.
