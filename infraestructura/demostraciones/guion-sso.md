# Guion de demostración — SSO entre tienda web, panel y Android (R16)

Una cuenta y una contraseña para las tres aplicaciones. Keycloak (realm `clb`) es el proveedor y cada aplicación es un
cliente OIDC con PKCE: `clb-web` (Angular, tienda y panel) y `clb-android` (AppAuth). La sesión SSO es una cookie de
Keycloak que vive **en el navegador**. Por eso dos aplicaciones comparten la sesión cuando abren Keycloak en el mismo
navegador.

## Preparación
- Stack levantado y `python infraestructura/identidad/preparar-identidad.py` ejecutado (crea `admin.demo` y `cliente.demo`).
- Celular con la APK instalada y `adb reverse tcp:18000 tcp:18000` y `adb reverse tcp:14200 tcp:14200`.
- En el celular, la app y la tienda web sin sesión iniciada.

## Pasos
1. **Tienda web → panel (mismo navegador).** Abrir `http://127.0.0.1:14200`, «Iniciar sesión», entrar con `admin.demo`.
   Abrir `/gestion`: carga sin pedir otra vez la contraseña. El token trae los roles y el panel verifica `admin`.
2. **App → web (mismo teléfono).** En la app: Cuenta → «Iniciar sesión». AppAuth abre Keycloak en el **navegador
   predeterminado** del teléfono (Custom Tab) y se escribe la contraseña una vez. Después, abrir la tienda en ese mismo
   navegador y pulsar «Iniciar sesión»: entra sin pedir la contraseña.
3. **Misma identidad.** El `sub` del token es el mismo en web y Android. Un pedido hecho en la app aparece en `/pedidos`
   de la web, porque Ventas toma el cliente del `sub`.
4. **Roles.** Con `cliente.demo` el panel `/gestion` responde «sin permiso»: la sesión es única, pero la autorización
   depende del rol.

## Resultado comprobado (27-oct-2026, Galaxy S23, Android 16)
- Paso 1: ✅ automatizado con Playwright sobre el Chrome del teléfono. Keycloak pidió la clave una vez y `/gestion`
  abrió sin volver a autenticar.
- Paso 2: ✅ confirmado por el usuario. Inició sesión en la app y luego entró desde Brave, su navegador predeterminado,
  sin poner otra vez la contraseña.
- Hallazgo: la Custom Tab se abre en el navegador **predeterminado** (Brave), no en Chrome. Una sesión iniciada en otro
  navegador no se comparte. Es el comportamiento estándar de OIDC en Android (RFC 8252), no un error. Para la demo, iniciar
  sesión en el navegador predeterminado del teléfono.

## Qué no se afirma
- No hay SSO entre navegadores distintos ni entre dispositivos distintos: cada uno inicia su propia sesión SSO con la
  misma cuenta y la misma contraseña.
- Cerrar sesión en la app termina la sesión de Keycloak (`end_session`). La web conserva su token vigente hasta que vence:
  el cierre global inmediato (back-channel logout) no está implementado.
