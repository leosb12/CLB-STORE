# Probador fotográfico de CLB Store

El worker CatVTON pertenece al microservicio IA y conserva CLEAR: contratos en
`fuente/dominio/probador.py`, identidad de inferencia en `fuente/aplicacion/probador.py`,
adaptadores en `fuente/infraestructura/{catvton,mascara_vton,modelos_vton,trabajos_vton}.py`
y entrada REST en `fuente/puertos/probador.py`. No accede a las bases de otros servicios.

Angular conserva el Web Component React y su evento v1. Inyecta una función de sesión,
sin acoplar React a OIDC. Flutter recibe el puerto `ProbadorFotografico` desde `main.dart`.
La vista TensorFlow.js/TFLite permanece disponible para IA local (R7/R11) y uso sin servidor.
La generación fotográfica usa PyTorch en un servidor GPU; no se ejecuta dentro del teléfono.
La APK compilada es `aplicaciones/android/build/app/outputs/flutter-apk/app-release.apk`, versión 1.0.7+8.
No se instala automáticamente en un dispositivo. Para la laptop local conserva el `adb reverse` del proyecto;
para otro servidor se compila con el `CLB_PASARELA` correspondiente.

## Preparación con Internet, una vez

Requisitos: Docker Compose con soporte `gpus`, controlador NVIDIA compatible con CUDA 12.8,
espacio para imagen CUDA y checkpoints, y memoria RAM suficiente para el stack y el worker.
Los 8 GB del requisito son **VRAM**, no RAM del sistema. DensePose, SCHP, el detector de objetos y CatVTON permanecen residentes en CUDA. La difusión usa fp16 y los parsers AMP. U²-Net solo separa fotografías de catálogo opacas y conserva su adaptador ONNX CPU; no existe fallback CPU para los modelos del probador.
En Docker Desktop debe haber RAM disponible para el worker además de los servicios existentes.
El worker limita RAM a 4 GB y RAM+swap a 5 GB por defecto para proteger el resto del stack.
`CLB_VTON_RAM`/`CLB_VTON_RAM_SWAP` permiten ampliarlo en servidores con más memoria;
estos valores no aumentan el límite global de WSL/Docker Desktop.

Desde este directorio:

```powershell
python setup_weights.py
python setup_weights.py --verificar
```

En Windows, `./setup_weights.ps1` automatiza descarga, construcción, exportación local
a safetensors fp16 y verificación. La exportación se hace sin red, con límite de 4 GB de RAM,
usando `torch.load(mmap=True, weights_only=True)`. Conserva los originales y registra los nuevos
SHA-256 en el manifiesto. Reduce el pico de RAM de cargar los `.bin` originales FP32.

Para el aprovisionamiento nativo se requiere `huggingface-hub`.
Alternativamente se puede ejecutar el script con la imagen VTON y un montaje escribible en `/weights`.
El script fija revisiones, verifica tamaño y SHA-256 LFS contra Hugging Face y exporta archivos
ordinarios a `weights/{base,catvton,vae,rembg}` para evitar problemas de enlaces Windows/Linux.
DensePose y SCHP se incluyen en CatVTON. Se genera un manifiesto SHA-256 local.
No ejecutar dos aprovisionamientos simultáneos sobre el mismo directorio.

Desde `infraestructura/bases-de-datos`:

```powershell
docker compose --profile vton build ia-vton
docker compose --profile vton up -d ia-vton
docker compose build inventario web probador ia-prendas
docker compose --profile prendas up -d inventario web probador ia-prendas
docker compose exec pasarela nginx -t
docker compose exec pasarela nginx -s reload
```

Las credenciales y bases siguen en el `.env` existente. No se borran volúmenes ni se cambian claves.
El gateway resuelve `ia-vton` por DNS en cada intervalo; si está apagado devuelve 503 controlado.
La imagen fija CatVTON `7818397f25613beedb3d861a34769f607cfcf3b1` y Detectron2
`b0fe2f0a5bb6496f65246ef35687a386a9f19202`. `adaptar_catvton.py` aplica un único parche
verificado: cargar el VAE desde un directorio local explícito y el UNet directamente en fp16
con `low_cpu_mem_usage`. No se reemplaza el algoritmo oficial.
El VAE y el UNet son residentes; no se instalan hooks de offload ni se modifican utilidades de dispositivo. El checker de CatVTON se desactiva mediante su interruptor nativo y sus referencias quedan nulas.

## Operación y límites

- El administrador sube la fotografía e indica color en el panel existente. El worker U²-Net
  prepara, el administrador revisa y publica. La categoría comercial etiqueta superior/inferior/completo;
  no se afirma que exista un clasificador visual autónomo.
- Los recursos anteriores de poleras/camisas conservan su esquema 1 y anclas.
  Todas las nuevas preparaciones, incluidas poleras y camisas de manga larga, usan esquema 2,
  PNG RGBA 768×1024, sin exigir anclas 2D. Así una silueta válida para CatVTON no queda
  bloqueada por la geometría del modo local anterior.
- REST: `POST /api/v1/probador/trabajos` multipart con `persona`, `prenda`, `identificador`,
  `categoria`, `force_regenerate` opcional; GET del identificador para estado y GET `/imagen` para PNG. DELETE de la colección borra resultados del titular, y DELETE de un identificador retira solo ese trabajo. JWT cliente/admin obligatorio.
- Máximo 8 MB por imagen, 16 megapíxeles, mínimo 256 px por lado, una sola persona detectable,
  torso y segmentos necesarios. Las poses ocultas o insuficientes se rechazan con `{mensaje,código}`.
- DensePose + dos parsers SCHP + AutoMasker oficial. En superiores se incluyen torso, mangas previas,
  brazos y antebrazos. Se dilata y se excluyen cara, cabello, manos y prendas inferiores.
  La difusión regenera la zona; las regiones excluidas conservan los píxeles de la foto normalizada.
- CUDA fp16/AMP, atención SDPA oficial, DDIM de 24 pasos, cuDNN benchmark y VAE slicing/tiling. Un proceso GPU precargado antes de aceptar HTTP,
  cuatro solicitudes como máximo y plazo de 600 segundos por inferencia. Un proceso fallido se reinicia.
  Los estados sobreviven en SQLite; un reinicio marca los trabajos inconclusos como ERROR y permite reintentar.
  Las fotos originales solo están en memoria/temporales privados durante procesamiento.
- Caché por titular + contenido de ambas imágenes + identificador + categoría + versión del pipeline.
  Cambiar prenda o foto invalida el resultado. Acceso a resultados ajenos responde 404.
- Resultados del servidor en volumen `clb_resultados_vton`, con vencimiento de 24 h y limpieza periódica
  cada minuto mientras el worker está activo. Hasta 20 resultados locales en Cache Storage/archivos privados.
  El usuario puede borrar copias, solicitudes y resultados remotos propios. Los borrados offline quedan pendientes de sincronizar; no se regenera antes de invalidarlos. Las respuestas HTTP llevan `no-store`.
- `HF_HUB_OFFLINE=1` y `TRANSFORMERS_OFFLINE=1` durante operación. Sin Internet público funciona
  con servidor GPU local y Keycloak local. Sin conexión **al servidor**, solo se generan vistas locales
  aproximadas o se recuperan resultados fotográficos ya guardados; no se promete difusión nueva offline en móvil.
- En Azure se despliega el mismo worker con volumen persistente, GPU y pasarela HTTPS. No se han creado recursos cloud.
  Para ahorrar cómputo, Azure requiere desasignar la VM cuando termina su uso; los discos se facturan por separado.

## Validación

`python -m pytest -q pruebas/test_probador_vton.py` verifica máscara, validaciones, aislamiento,
deduplicación, recuperación y cola. Los dobles de contrato de esas pruebas **no** son evidencia de CatVTON.
`node investigacion/probador-vton/verificar-interfaz.mjs` desde la raíz prueba el bundle compilado
en escritorio/móvil y comprueba que no se envían fotos sin sesión.
Con `--generar`, ese script utiliza una sesión real de `cliente.demo`, la pasarela y el worker
para generar una fotografía y recuperarla con el navegador sin conexión; nunca imprime tokens.
`python investigacion/probador-vton/verificar-api.py` comprueba Keycloak y errores reales sin consumir GPU.

`comprobar_vton_gpu.py` ejecuta el motor real y escribe PNG y métricas; debe correrse dentro de
la imagen con `--gpus all --network none`, pesos de solo lectura, fotos de prueba y salida separada.
Se debe revisar manga larga→corta, brazos, rostro/cabello/manos, inferiores, vestidos y estampados
antes de afirmar calidad aceptable. No existe garantía de anatomía, tono de piel o diseños perfectos en toda foto.
La máscara guía el inpainting; CatVTON no recibe un condicionamiento UV 3D adicional que garantice anatomía.

## Licencias

CatVTON declara **CC BY-NC-SA 4.0**: el despliegue comercial necesita resolver permisos o elegir
un motor con licencia adecuada. También aplican las licencias de SD Inpainting, VAE, Detectron2,
SCHP, U²-Net y de las fotografías del catálogo. Preparado para contenedores no equivale a licencia comercial.
Fuentes: [CatVTON](https://github.com/Zheng-Chong/CatVTON),
[checkpoints](https://huggingface.co/zhengchong/CatVTON),
[U²-Net/rembg](https://github.com/danielgatis/rembg),
[Detectron2](https://github.com/facebookresearch/detectron2).

## Auditoría operativa del 24 de octubre

Estado y evidencias en [estado del probador](../../docs/probador.md).
Para actualizar pesos ya aprovisionados ejecutar `python preparar_objetos_vton.py` una vez con red,
y después `python setup_weights.py --verificar`. El setup completo también prepara ese detector.
Faster R-CNN MobileNetV3 FPN se carga sin descargar backbone, con SHA-256 fijado; usa vistas de persona
y tronco para objetos pequeños. Los parsers no tienen una clase teléfono.
La máscara elimina torso/prenda/brazos y protege manos, rostro LIP, cabello y objetos detectados.
La ropa LIP prevalece cuando ATR confunde cuello o camiseta con Face. El fondo exterior conserva
la entrada normalizada. No se promete segmentación perfecta en toda selfie.
La carga completa puede tardar unos minutos y se hace al arrancar; `/salud` no anuncia ACTIVO
antes de prepararla y devuelve 503 si el hijo GPU ha muerto. No se inicia un proceso por petición normal.

La revisión de aquella auditoría utiliza `catvton-7818397-residente-v8-24-2.5-768x1024`. La revisión v8 corrige el redondeo de padding impar; los ensayos de tiempo completos registrados corresponden a v7. El ensayo caliente
con todas las redes del worker retiradas completó en28,31s; la restauración del enlace
es parte del script `verificar-offline-caliente.py`. Las personas pequeñas se amplían
para difusión y el resultado se devuelve a su región original, sin interpolar las
oclusiones protegidas. La fotografía generativa y el SVG local se entregan por campos
distintos del contrato v1; no se cambia el evento de talla.

## Revisión de color y composición del 26 de octubre

La versión vigente es `catvton-7818397-residente-v11-24-2.5-768x1024`, sincronizada
con web y fuente Android. Convierte perfiles ICC a sRGB, compone una sola vez en
resolución original y conserva las zonas protegidas. Precarga: 900 s; inferencia: 600 s.
La [evaluación de color](../../docs/probador.md)
separa pruebas automáticas, inferencia real y aceptación visual.

## Revisión v12 del 26 de octubre (halo, dobladillo y colas)

Vigente: `catvton-7818397-residente-v12-24-2.5-768x1024` (servidor, web y APK 1.0.8+9).
- **Halo**: el resultado se parsea con SCHP LIP+ATR (+0,5 s) y se restaura la foto original donde original y resultado
  son fondo (`alfa_composicion`, rampa 3 px); el fondo regenerado se iguala al tono local. Medido en la foto pública de
  prueba (u2net como referencia de persona): fondo repintado 18 % → 2,5–3,0 % del área editada, anillo máx. 47 → 19 px,
  salto de costura |ΔL*| 1,9 → ≤0,9. Lo que queda es sobre todo la silueta de la prenda nueva, más ancha que la anterior.
- **Dobladillo**: la protección de pantalón/falda solo se aplica si ningún parser ve ropa superior; sin restos de la
  camiseta blanca en camisa negra, polera roja ni gris.
- **Cuello**: el «cuello blanco» de v11 no era un resto (0 píxeles coinciden con el original): era una alucinación del
  modelo. En v12 no aparece; con camisa abierta CatVTON inventa piel algo rojiza en el escote.
- **Color (ΔE00 de medianas, prenda del catálogo vs. torso generado)**: roja 4,8 (≤5, aceptable), gris 8,8 (revisión),
  negra 10,7 (falla: L* 19 → 33). El A/B sin *tiling* del VAE no lo corrige y sube la VRAM 3,9 → 5,8 GB: es un límite de
  CatVTON en prendas oscuras/grises, no del pipeline; no se recolorea globalmente.
- `torch.manual_seed` fija la semilla (reproducible) y el redimensionado usa BICUBIC (sin *ringing* de LANCZOS).
- Colas: el servidor marca `reintentable` en `ERROR` por fallos propios (`CODIGOS_REINTENTABLES`) y limita 2 trabajos
  activos por titular (4 globales). Web (IndexedDB `clb_probador_vton`) y Android guardan la foto antes de enviar; red caída,
  sesión vencida, 502/503/504 y 408/425/429 se reintentan sin tope (no gastan GPU); un `ERROR` reintentable cuenta hasta 5.
  Ambos verifican `X-Contenido-SHA256` al descargar. Ensayos: `verificar-shell.mjs` (3 prendas, 31–35 s, 0 violaciones CSP),
  `cola-fotografica.spec.ts` (web) y `integration_test/cola_vton_local_test.dart` en el celular físico.
No se promete fidelidad universal: la aceptación visual sigue siendo por muestra.
