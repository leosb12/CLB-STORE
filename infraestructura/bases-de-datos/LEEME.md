# Stack local de CLB Store

La instalación completa está en [inicio-equipo](../../docs/inicio-equipo.md); el catálogo limpio y reinicio de operaciones en [datos-equipo](../datos-equipo/LEEME.md).

Compose incluye PostgreSQL (Ventas y Analítica con bases/usuarios separados), MongoDB, DynamoDB Local, cuatro backends, Keycloak, pasarela, Angular, React y n8n. Perfiles opcionales: prendas y vton. Ver [despliegue](../../docs/arquitectura/despliegue.md).

Desde esta carpeta:

```powershell
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
docker compose logs --tail=50 inventario ventas clientes ia
```

Accesos predeterminados: tienda 127.0.0.1:14200, gateway 127.0.0.1:18000, n8n 127.0.0.1:15678. Los backends se consumen por la pasarela; no usar los puertos históricos 18080/18090/18091. PostgreSQL 5432 (configurable), MongoDB 27017 y DynamoDB 8000 se publican solo en loopback.

Copiar .env.example a .env y definir claves propias. Cambiar variables no rota credenciales de volúmenes existentes. Keycloak autentica y cada servicio verifica JWT/roles. La configuración incluida sigue siendo local: Keycloak usa start-dev y no hay HTTPS público.

Los volúmenes preservan cuentas, prendas, bases, configuración y modelos. **No usar down -v para limpiar pruebas.** docker compose stop conserva los datos; up -d --wait reinicia. El reinicio coordinado de datos elimina operaciones y conserva usuarios/modelos.

comprobar-bases.py verifica conectividad y persistencia con recursos temporales; revisar sus requisitos antes de ejecutarlo. No ejecutar pruebas que reinician MongoDB mientras otras pruebas dependan de él.
